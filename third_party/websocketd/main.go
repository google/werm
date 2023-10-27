// Copyright 2013 Joe Walnes and the websocketd team.
// All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package main

import (
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
)

func main() {
	config := parseCommandLine()

	log := RootLogScope(config.LogLevel)

	handler := NewWebsocketdServer(config, log)
	http.Handle("/", handler)

	log.Info("Serving using application   : %s %s", config.CommandName, strings.Join(config.CommandArgs, " "))
	log.Info("Serving static content from : %s", config.StaticDir)
	log.Info("Serving CGI scripts from    : %s", config.CgiDir)

	rejects := make(chan error, 1)

	// Serve, called by the serve function below, does not return
	// except on error. Let's run serve in a go routine, reporting result to
	// control channel. This allows us to have multiple serve addresses.
	serve := func(network, address string) {
		if listener, err := net.Listen(network, address); err != nil {
			rejects <- err
		} else {
			rejects <- http.Serve(listener, nil)
		}
	}

	for _, addrSingle := range config.Addr {
		log.Info("Starting WebSocket server: %s", addrSingle)
		go serve("tcp", addrSingle)

		if config.RedirPort != 0 {
			go func(addr string) {
				pos := strings.IndexByte(addr, ':')
				rediraddr := addr[:pos] + ":" + strconv.Itoa(config.RedirPort) // it would be silly to optimize this one
				redir := &http.Server{Addr: rediraddr, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					// redirect to same hostname as in request but different port and probably schema
					uri := "http://"
					if cpos := strings.IndexByte(r.Host, ':'); cpos > 0 {
						uri += r.Host[:strings.IndexByte(r.Host, ':')] + addr[pos:] + "/"
					} else {
						uri += r.Host + addr[pos:] + "/"
					}

					http.Redirect(w, r, uri, http.StatusMovedPermanently)
				})}
				log.Info("Starting redirect server   : http://%s/", rediraddr)
				rejects <- redir.ListenAndServe()
			}(addrSingle)
		}
	}
	if config.Uds != "" {
		log.Info("Starting WebSocket server on Unix Domain Socket: %s", config.Uds)
		go serve("unix", config.Uds)
	}
	err := <-rejects
	if err != nil {
		log.Fatal("Can't start server: %s", err)
		os.Exit(3)
	}
}
