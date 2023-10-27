// Copyright 2013 The Gorilla WebSocket Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package gorillaws

import (
	"bufio"
	"errors"
	"io"
	"net"
	"net/http"
	"time"
)

// HandshakeError describes an error with the handshake from the peer.
type HandshakeError struct {
	message string
}

func (e HandshakeError) Error() string { return e.message }

// Upgrader specifies parameters for upgrading an HTTP connection to a
// WebSocket connection.
//
// It is safe to call Upgrader's methods concurrently.
type Upgrader struct {
	// HandshakeTimeout specifies the duration for the handshake to complete.
	HandshakeTimeout time.Duration

	// ReadBufferSize and WriteBufferSize specify I/O buffer sizes in bytes. If a buffer
	// size is zero, then buffers allocated by the HTTP server are used. The
	// I/O buffer sizes do not limit the size of the messages that can be sent
	// or received.
	ReadBufferSize, WriteBufferSize int

	// Error specifies the function for generating HTTP error responses. If Error
	// is nil, then http.Error is used to generate the HTTP response.
	Error func(w http.ResponseWriter, r *http.Request, status int, reason error)
}

func (u *Upgrader) returnError(w http.ResponseWriter, r *http.Request, status int, reason string) (net.Conn, error) {
	err := HandshakeError{reason}
	if u.Error != nil {
		u.Error(w, r, status, err)
	} else {
		w.Header().Set("Sec-Websocket-Version", "13")
		http.Error(w, http.StatusText(status), status)
	}
	return nil, err
}

// Upgrade upgrades the HTTP server connection to the WebSocket protocol.
//
// The responseHeader is included in the response to the client's upgrade
// request. Use the responseHeader to specify cookies (Set-Cookie).
//
// If the upgrade fails, then Upgrade replies to the client with an HTTP error
// response.
func (u *Upgrader) Upgrade(w http.ResponseWriter, r *http.Request) (net.Conn, error) {
	const badHandshake = "websocket: the client is not using the websocket protocol: "

	if !tokenListContainsValue(r.Header, "Connection", "upgrade") {
		return u.returnError(w, r, http.StatusBadRequest, badHandshake+"'upgrade' token not found in 'Connection' header")
	}

	if !tokenListContainsValue(r.Header, "Upgrade", "websocket") {
		return u.returnError(w, r, http.StatusBadRequest, badHandshake+"'websocket' token not found in 'Upgrade' header")
	}

	if r.Method != http.MethodGet {
		return u.returnError(w, r, http.StatusMethodNotAllowed, badHandshake+"request method is not GET")
	}

	if !tokenListContainsValue(r.Header, "Sec-Websocket-Version", "13") {
		return u.returnError(w, r, http.StatusBadRequest, "websocket: unsupported version: 13 not found in 'Sec-Websocket-Version' header")
	}

	challengeKey := r.Header.Get("Sec-Websocket-Key")
	if !isValidChallengeKey(challengeKey) {
		return u.returnError(w, r, http.StatusBadRequest, "websocket: not a websocket handshake: 'Sec-WebSocket-Key' header must be Base64 encoded value of 16-byte in length")
	}

	h, ok := w.(http.Hijacker)
	if !ok {
		return u.returnError(w, r, http.StatusInternalServerError, "websocket: response does not implement http.Hijacker")
	}
	var brw *bufio.ReadWriter
	netConn, brw, err := h.Hijack()
	if err != nil {
		return u.returnError(w, r, http.StatusInternalServerError, err.Error())
	}

	if brw.Reader.Buffered() > 0 {
		netConn.Close()
		return nil, errors.New("websocket: client sent data before handshake is complete")
	}

	p := bufioWriterBuffer(netConn, brw.Writer)

	p = p[:0]

	p = append(p, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: "...)
	p = append(p, computeAcceptKey(challengeKey)...)
	p = append(p, "\r\n\r\n"...)

	// Clear deadlines set by HTTP server.
	netConn.SetDeadline(time.Time{})

	if u.HandshakeTimeout > 0 {
		netConn.SetWriteDeadline(time.Now().Add(u.HandshakeTimeout))
	}
	if _, err = netConn.Write(p); err != nil {
		netConn.Close()
		return nil, err
	}
	if u.HandshakeTimeout > 0 {
		netConn.SetWriteDeadline(time.Time{})
	}

	return netConn, nil
}

// writeHook is an io.Writer that records the last slice passed to it vio
// io.Writer.Write.
type writeHook struct {
	p []byte
}

func (wh *writeHook) Write(p []byte) (int, error) {
	wh.p = p
	return len(p), nil
}

// bufioWriterBuffer grabs the buffer from a bufio.Writer.
func bufioWriterBuffer(originalWriter io.Writer, bw *bufio.Writer) []byte {
	// This code assumes that bufio.Writer.buf[:1] is passed to the
	// bufio.Writer's underlying writer.
	var wh writeHook
	bw.Reset(&wh)
	bw.WriteByte(0)
	bw.Flush()

	bw.Reset(originalWriter)

	return wh.p[:cap(wh.p)]
}
