// Copyright 2013 Joe Walnes and the websocketd team.
// All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.


package main

import (
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cgi"
	"net/textproto"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"strings"

	"gorillaws"
)

var ForkNotAllowedError = errors.New("too many forks active")

// WebsocketdServer presents http.Handler interface for requests libwebsocketd is handling.
type WebsocketdServer struct {
	Config *Config
	Log    *LogScope
	forks  chan byte
}

// NewWebsocketdServer creates WebsocketdServer struct with pre-determined config, logscope and maxforks limit
func NewWebsocketdServer(config *Config, log *LogScope, maxforks int) *WebsocketdServer {
	mux := &WebsocketdServer{
		Config: config,
		Log:    log,
	}
	if maxforks > 0 {
		mux.forks = make(chan byte, maxforks)
	}
	return mux
}

func splitMimeHeader(s string) (string, string) {
	p := strings.IndexByte(s, ':')
	if p < 0 {
		return s, ""
	}
	key := textproto.CanonicalMIMEHeaderKey(s[:p])

	for p = p + 1; p < len(s); p++ {
		if s[p] != ' ' {
			break
		}
	}
	return key, s[p:]
}

func pushHeaders(h http.Header, hdrs []string) {
	for _, hstr := range hdrs {
		h.Add(splitMimeHeader(hstr))
	}
}

func xsiteForbid(secFetcher string, uri string) string {
	if (strings.HasPrefix(uri, "/index.html")) {
		// Make later checks easier by forbidding this alias.
		return "cannot access /index.html directly"
	}

	if (uri == "/" || uri == "/attach") {
		// Allow basic terminal or attach page to be opened by a link
		// from any site, though we don't allow embedding because of
		// X-Frame-Options.
		return ""
	}

	if (secFetcher == "same-origin" || secFetcher == "same-site" || secFetcher == "none" || secFetcher == "") {
		return ""
	}

	return "possible cross-site access of " + uri + ": " + secFetcher
}

// ServeHTTP muxes between WebSocket handler, CGI handler, Static HTML or 404.
func (h *WebsocketdServer) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	log := h.Log.NewLevel(h.Log.LogFunc)
	log.Associate("url", h.TellURL("http", req.Host, req.RequestURI))

	hdrs := req.Header
	if errm := xsiteForbid(hdrs.Get("Sec-fetch-site"), req.RequestURI); errm != "" {
		http.Error(w, "403 FORBIDDEN: " + errm + " from referrer: " + req.Referer(), 403);
		log.Access("session", "FORBIDDEN: %s", errm)
		return
	}

	// Do not allow index.html or similar to be in an iframe.
	w.Header().Set("X-Frame-Options", "DENY");

	if h.Config.CommandName != "" || h.Config.UsingScriptDir {
		upgradeRe := regexp.MustCompile(`(?i)(^|[,\s])Upgrade($|[,\s])`)
		// WebSocket, limited to size of h.forks
		if strings.ToLower(hdrs.Get("Upgrade")) == "websocket" && upgradeRe.MatchString(hdrs.Get("Connection")) {
			if h.noteForkCreated(w, log) {
				defer h.noteForkCompled()

				// start figuring out if we even need to upgrade
				handler, err := NewWebsocketdHandler(h, req, log)
				if err != nil {
					if err == ScriptNotFoundError {
						log.Access("session", "NOT FOUND: %s", err)
						http.Error(w, "404 Not Found", 404)
					} else {
						log.Access("session", "INTERNAL ERROR: %s", err)
						http.Error(w, "500 Internal Server Error", 500)
					}
					return
				}

				var headers http.Header
				if len(h.Config.Headers)+len(h.Config.HeadersWs) > 0 {
					headers = http.Header(make(map[string][]string))
					pushHeaders(headers, h.Config.Headers)
					pushHeaders(headers, h.Config.HeadersWs)
				}

				upgrader := &gorillaws.Upgrader{
					HandshakeTimeout: h.Config.HandshakeTimeout,
					CheckOrigin: func(r *http.Request) bool {
						// backporting previous checkorigin for use in gorilla/websocket for now
						err := checkOrigin(req, h.Config, log)
						return err == nil
					},
				}
				conn, err := upgrader.Upgrade(w, req, headers)
				if err != nil {
					log.Access("session", "Unable to Upgrade: %s", err)
					http.Error(w, "500 Internal Error", 500)
					return
				}

				// old func was used in x/net/websocket style, we reuse it here for gorilla/websocket
				handler.accept(conn, log)
				return

			}
			return
		}
	}

	pushHeaders(w.Header(), h.Config.HeadersHTTP)

	if req.URL.Path == "/showenv" {
		upth := req.URL.Path

		if ! h.noteForkCreated(w, log) { return }
		defer h.noteForkCompled()

		log.Access("http", upth);

		sess := &exec.Cmd{
			Path:	h.Config.CommandName,
			Args:	[]string{ h.Config.CommandName, upth },
		}

		soutr, err := sess.StdoutPipe()
		if err != nil {
			log.Access(upth, "cannot make pipe: %s", err)
			return
		}
		defer soutr.Close()

		if err = sess.Start(); err != nil {
			log.Access(upth, "err starting handler: %s", err)
			return
		}
		defer sess.Wait()

		if _, err := io.Copy(w, soutr); err != nil {
			log.Access(upth, "err sending handler output: %s", err)
		}

		return
	}

	// CGI scripts, limited to size of h.forks
	if h.Config.CgiDir != "" {
		filePath := path.Join(h.Config.CgiDir, fmt.Sprintf(".%s", filepath.FromSlash(req.URL.Path)))
		if fi, err := os.Stat(filePath); err == nil && !fi.IsDir() {

			log.Associate("cgiscript", filePath)
			if h.noteForkCreated(w, log) {
				defer h.noteForkCompled()

				cgiHandler := &cgi.Handler{
					Path: filePath,
					Env: os.Environ(),
				}
				log.Access("http", "CGI")
				cgiHandler.ServeHTTP(w, req)
			}
			return
		}
	}

	// Static files
	if h.Config.StaticDir != "" {
		handler := http.FileServer(http.Dir(h.Config.StaticDir))
		log.Access("http", "STATIC")

		// We are not serving anything big, and we want index.html to
		// be re-read to verify the Sec-fetch-site header each time.
		w.Header().Set("Cache-Control", "no-cache");

		handler.ServeHTTP(w, req)
		return
	}

	// 404
	log.Access("http", "NOT FOUND")
	http.NotFound(w, req)
}

var canonicalHostname string

// TellURL is a helper function that changes http to https or ws to wss in case if SSL is used
func (h *WebsocketdServer) TellURL(scheme, host, path string) string {
	if len(host) > 0 && host[0] == ':' {
		if canonicalHostname == "" {
			var err error
			canonicalHostname, err = os.Hostname()
			if err != nil {
				canonicalHostname = "UNKNOWN"
			}
		}
		host = canonicalHostname + host
	}
	if h.Config.Ssl {
		return scheme + "s://" + host + path
	}
	return scheme + "://" + host + path
}

func (h *WebsocketdServer) noteForkCreated(w http.ResponseWriter, log *LogScope) bool {
	// note that forks can be nil since the construct could've been created by
	// someone who is not using NewWebsocketdServer
	if h.forks != nil {
		select {
		case h.forks <- 1:
			return true
		default:
			log.Error("http", "Max of possible forks already active, upgrade rejected")
			http.Error(w, "429 Too Many Requests", http.StatusTooManyRequests)
			return false
		}
	} else {
		return true
	}
}

func (h *WebsocketdServer) noteForkCompled() {
	if h.forks != nil { // see comment in noteForkCreated
		select {
		case <-h.forks:
			return
		default:
			// This could only happen if the completion handler called more times than creation handler above
			// Code should be audited to not allow this to happen, it's desired to have test that would
			// make sure this is impossible but it is not exist yet.
			panic("Cannot deplet number of allowed forks, something is not right in code!")
		}
	}
}

func checkOrigin(req *http.Request, config *Config, log *LogScope) (err error) {
	// CONVERT GORILLA:
	// this is origin checking function, it's called from wshandshake which is from ServeHTTP main handler
	// should be trivial to reuse in gorilla's upgrader.CheckOrigin function.
	// Only difference is to parse request and fetching passed Origin header out of it instead of using
	// pre-parsed wsconf.Origin

	// check for origin to be correct in future
	// handshaker triggers answering with 403 if error was returned
	// We keep behavior of original handshaker that populates this field
	origin := req.Header.Get("Origin")
	if origin == "" || (origin == "null" && config.AllowOrigins == nil) {
		// we don't want to trust string "null" if there is any
		// enforcements are active
		origin = "file:"
	}

	originParsed, err := url.ParseRequestURI(origin)
	if err != nil {
		log.Access("session", "Origin parsing error: %s", err)
		return err
	}

	log.Associate("origin", originParsed.String())

	// If some origin restrictions are present:
	if config.SameOrigin || config.AllowOrigins != nil {
		originServer, originPort, err := tellHostPort(originParsed.Host, originParsed.Scheme == "https")
		if err != nil {
			log.Access("session", "Origin hostname parsing error: %s", err)
			return err
		}
		if config.SameOrigin {
			localServer, localPort, err := tellHostPort(req.Host, req.TLS != nil)
			if err != nil {
				log.Access("session", "Request hostname parsing error: %s", err)
				return err
			}
			if originServer != localServer || originPort != localPort {
				log.Access("session", "Same origin policy mismatch")
				return fmt.Errorf("same origin policy violated")
			}
		}
		if config.AllowOrigins != nil {
			matchFound := false
			for _, allowed := range config.AllowOrigins {
				if pos := strings.Index(allowed, "://"); pos > 0 {
					// allowed schema has to match
					allowedURL, err := url.Parse(allowed)
					if err != nil {
						continue // pass bad URLs in origin list
					}
					if allowedURL.Scheme != originParsed.Scheme {
						continue // mismatch
					}
					allowed = allowed[pos+3:]
				}
				allowServer, allowPort, err := tellHostPort(allowed, false)
				if err != nil {
					continue // unparseable
				}
				if allowPort == "80" && allowed[len(allowed)-3:] != ":80" {
					// any port is allowed, host names need to match
					matchFound = allowServer == originServer
				} else {
					// exact match of host names and ports
					matchFound = allowServer == originServer && allowPort == originPort
				}
				if matchFound {
					break
				}
			}
			if !matchFound {
				log.Access("session", "Origin is not listed in allowed list")
				return fmt.Errorf("origin list matches were not found")
			}
		}
	}
	return nil
}

func tellHostPort(host string, ssl bool) (server, port string, err error) {
	server, port, err = net.SplitHostPort(host)
	if err != nil {
		if addrerr, ok := err.(*net.AddrError); ok && strings.Contains(addrerr.Err, "missing port") {
			server = host
			if ssl {
				port = "443"
			} else {
				port = "80"
			}
			err = nil
		}
	}
	return server, port, err
}
