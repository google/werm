package main

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

// WebsocketdHandler is a single request information and processing structure, it handles WS requests out of all that daemon can handle (static, cgi, devconsole)
type WebsocketdHandler struct {
	server *WebsocketdServer
	Env      []string
	command string
}

// NewWebsocketdHandler constructs the struct and parses all required things in it...
func NewWebsocketdHandler(s *WebsocketdServer, req *http.Request, log *LogScope) *WebsocketdHandler {
	return &WebsocketdHandler{
		server: s,
		command: s.Config.CommandName,
		Env: createEnv(req),
	}
}

func (wsh *WebsocketdHandler) accept(ws net.Conn, log *LogScope) {
	launched, err := launchCmd(wsh.command, wsh.server.Config.CommandArgs, wsh.Env)
	if err != nil {
		log.Error("Could not launch process %s %s (%s)", wsh.command, strings.Join(wsh.server.Config.CommandArgs, " "), err)
		ws.Close()
		return
	}

	pid := launched.cmd.Process.Pid
	log.Access("new session pid: %d", pid)

	process := NewProcessEndpoint(launched, log)
	if cms := wsh.server.Config.CloseMs; cms != 0 {
		process.closetime += time.Duration(cms) * time.Millisecond
	}

	status := make(chan error)

	go func() {
		_, err := io.Copy(ws, launched.stdout)
		if err != nil {
			err = fmt.Errorf("error copying outbound frames: %w", err)
		}
		// Make opposite Copy call reach its EOF
		ws.Close()
		status <- err
	}()
	go func() {
		_, err := io.Copy(launched.stdin, ws)
		if err != nil {
			err = fmt.Errorf("error copying inbound frames: %w", err)
		}
		process.Terminate()
		status <- err
	}()

	got := 0
	for {
		if err := <-status; err != nil {
			log.Error("copy websock streams error: %s", err)
		}
		got += 1
		if got == 2 { break }
	}
	log.Access("session terminated: %d", pid)
}
