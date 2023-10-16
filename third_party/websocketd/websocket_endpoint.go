// Copyright 2013 Joe Walnes and the websocketd team.
// All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.


package main

import (
	"io"
	"io/ioutil"

	"gorillaws"
)

// CONVERT GORILLA
// This file should be altered to use gorilla's websocket connection type and proper
// message dispatching methods

type WebSocketEndpoint struct {
	ws     *gorillaws.Conn
	output chan []byte
	log    *LogScope
	mtype  int
}

func NewWebSocketEndpoint(ws *gorillaws.Conn, log *LogScope) *WebSocketEndpoint {
	endpoint := &WebSocketEndpoint{
		ws:     ws,
		output: make(chan []byte),
		log:    log,
		mtype:  gorillaws.TextMessage,
	}
	return endpoint
}

func (we *WebSocketEndpoint) Terminate() {
	we.log.Trace("websocket", "Terminated websocket connection")
}

func (we *WebSocketEndpoint) Output() chan []byte {
	return we.output
}

func (we *WebSocketEndpoint) Send(msg []byte) bool {
	w, err := we.ws.NextWriter(we.mtype)
	if err == nil {
		_, err = w.Write(msg)
	}
	w.Close() // could need error handling

	if err != nil {
		we.log.Trace("websocket", "Cannot send: %s", err)
		return false
	}

	return true
}

func (we *WebSocketEndpoint) StartReading() {
	go we.read_frames()
}

func (we *WebSocketEndpoint) read_frames() {
	for {
		_, rd, err := we.ws.NextReader()
		if err != nil {
			we.log.Debug("websocket", "Cannot receive: %s", err)
			break
		}

		p, err := ioutil.ReadAll(rd)
		if err != nil && err != io.EOF {
			we.log.Debug("websocket", "Cannot read received message: %s", err)
			break
		}

		we.output <- append(p, '\n')
	}
	close(we.output)
}
