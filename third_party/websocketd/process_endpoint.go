// Copyright 2013 Joe Walnes and the websocketd team.
// All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.


package main

import (
	"bufio"
	"io"
	"syscall"
	"time"
)

type ProcessEndpoint struct {
	process   *LaunchedProcess
	closetime time.Duration
	log       *LogScope
}

func NewProcessEndpoint(process *LaunchedProcess, log *LogScope) *ProcessEndpoint {
	pe := &ProcessEndpoint{
		process: process,
		log:     log,
	}
	go pe.log_stderr()
	return pe
}

func (pe *ProcessEndpoint) Terminate() {
	terminated := make(chan struct{})
	go func() { pe.process.cmd.Wait(); terminated <- struct{}{} }()

	// for some processes this is enough to finish them...
	pe.process.stdin.Close()

	// a bit verbose to create good debugging trail
	select {
	case <-terminated:
		pe.log.Debug("process", "Process %v terminated after stdin was closed", pe.process.cmd.Process.Pid)
		return // means process finished
	case <-time.After(100*time.Millisecond + pe.closetime):
	}

	err := pe.process.cmd.Process.Signal(syscall.SIGINT)
	if err != nil {
		// process is done without this, great!
		pe.log.Error("process", "SIGINT unsuccessful to %v: %s", pe.process.cmd.Process.Pid, err)
	}

	select {
	case <-terminated:
		pe.log.Debug("process", "Process %v terminated after SIGINT", pe.process.cmd.Process.Pid)
		return // means process finished
	case <-time.After(250*time.Millisecond + pe.closetime):
	}

	err = pe.process.cmd.Process.Signal(syscall.SIGTERM)
	if err != nil {
		// process is done without this, great!
		pe.log.Error("process", "SIGTERM unsuccessful to %v: %s", pe.process.cmd.Process.Pid, err)
	}

	select {
	case <-terminated:
		pe.log.Debug("process", "Process %v terminated after SIGTERM", pe.process.cmd.Process.Pid)
		return // means process finished
	case <-time.After(500*time.Millisecond + pe.closetime):
	}

	err = pe.process.cmd.Process.Kill()
	if err != nil {
		pe.log.Error("process", "SIGKILL unsuccessful to %v: %s", pe.process.cmd.Process.Pid, err)
		return
	}

	select {
	case <-terminated:
		pe.log.Debug("process", "Process %v terminated after SIGKILL", pe.process.cmd.Process.Pid)
		return // means process finished
	case <-time.After(1000 * time.Millisecond):
	}

	pe.log.Error("process", "SIGKILL did not terminate %v!", pe.process.cmd.Process.Pid)
}

func (pe *ProcessEndpoint) log_stderr() {
	bufstderr := bufio.NewReader(pe.process.stderr)
	for {
		buf, err := bufstderr.ReadSlice('\n')
		if err != nil {
			if err != io.EOF {
				pe.log.Error("process", "Unexpected error while reading STDERR from process: %s", err)
			} else {
				pe.log.Debug("process", "Process STDERR closed")
			}
			break
		}
		pe.log.Error("stderr", "%s", string(trimEOL(buf)))
	}
}

// trimEOL cuts unixy style \n and windowsy style \r\n suffix from the string
func trimEOL(b []byte) []byte {
	lns := len(b)
	if lns > 0 && b[lns-1] == '\n' {
		lns--
		if lns > 0 && b[lns-1] == '\r' {
			lns--
		}
	}
	return b[:lns]
}
