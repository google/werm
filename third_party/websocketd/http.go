// Copyright 2013 Joe Walnes and the websocketd team.
// All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.


package main

import (
	"fmt"
	"io"
	"net/http"
	"net/http/cgi"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"strings"

	"gorillaws"
)

// WebsocketdServer presents http.Handler interface for requests libwebsocketd is handling.
type WebsocketdServer struct {
	Config *Config
	Log    *LogScope
}

// NewWebsocketdServer creates WebsocketdServer struct with pre-determined config, logscope and maxforks limit
func NewWebsocketdServer(config *Config, log *LogScope) *WebsocketdServer {
	return &WebsocketdServer{
		Config: config,
		Log:    log,
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
	log := h.Log
	hdrs := req.Header

	// TODO(github.com/google/werm/issues/1) will it be more secure to also
	// verify Origin/Host are consistent?
	log.Access("RequestURI:%s Host:%s Origin:%s RemoteAddr:%s", req.RequestURI, req.Host, strings.Join(hdrs["Origin"], ":"), req.RemoteAddr)

	if errm := xsiteForbid(hdrs.Get("Sec-fetch-site"), req.RequestURI); errm != "" {
		http.Error(w, "403 FORBIDDEN: " + errm + " from referrer: " + req.Referer(), 403);
		log.Access("FORBIDDEN: %s", errm)
		return
	}

	// Do not allow index.html or similar to be in an iframe.
	w.Header().Set("X-Frame-Options", "DENY");

	upgradeRe := regexp.MustCompile(`(?i)(^|[,\s])Upgrade($|[,\s])`)
	// WebSocket, limited to size of h.forks
	if strings.ToLower(hdrs.Get("Upgrade")) == "websocket" && upgradeRe.MatchString(hdrs.Get("Connection")) {
		// start figuring out if we even need to upgrade
		handler := NewWebsocketdHandler(h, req, log)

		upgrader := &gorillaws.Upgrader{
			HandshakeTimeout: h.Config.HandshakeTimeout,
		}
		conn, err := upgrader.Upgrade(w, req)
		if err != nil {
			log.Access("Unable to Upgrade: %s", err)
			http.Error(w, "500 Internal Error", 500)
			return
		}

		// old func was used in x/net/websocket style, we reuse it here for gorilla/websocket
		handler.accept(conn, log)
		return
	}

	if req.URL.Path == "/showenv" || req.URL.Path == "/newsess" || req.URL.Path == "/atchses" {
		upth := req.URL.Path

		log.Access("serve subcommand: %s", upth);

		sess := &exec.Cmd{
			Path:	h.Config.CommandName,
			Args:	[]string{ h.Config.CommandName, upth },
		}

		soutr, err := sess.StdoutPipe()
		if err != nil {
			log.Access("cannot make pipe: %s", err)
			return
		}
		defer soutr.Close()

		if err = sess.Start(); err != nil {
			log.Access("err starting handler: %s", err)
			return
		}
		defer sess.Wait()

		if _, err := io.Copy(w, soutr); err != nil {
			log.Access("err sending handler output: %s", err)
		}

		return
	}

	// CGI scripts, limited to size of h.forks
	filePath := path.Join(h.Config.CgiDir, fmt.Sprintf(".%s", filepath.FromSlash(req.URL.Path)))
	if fi, err := os.Stat(filePath); err == nil && !fi.IsDir() {

		log.Access("CGI: " + filePath)

		cgiHandler := &cgi.Handler{
			Path: filePath,
			Env: os.Environ(),
		}
		cgiHandler.ServeHTTP(w, req)
		return
	}

	// Static files
	handler := http.FileServer(http.Dir(h.Config.StaticDir))

	// We are not serving anything big, and we want index.html to
	// be re-read to verify the Sec-fetch-site header each time.
	w.Header().Set("Cache-Control", "no-cache");

	handler.ServeHTTP(w, req)
}
