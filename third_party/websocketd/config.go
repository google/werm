// Copyright 2013 Joe Walnes and the websocketd team.
// All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/exec"
	"time"
)

type Config struct {
	Addr              []string // TCP addresses to listen on. e.g. ":1234", "1.2.3.4:1234" or "[::1]:1234"
	Uds               string   // Unix Domain Socket to listen on
	LogLevel          LogLevel
	RedirPort         int

	// base initiaization fields
	StartupTime    time.Time // Server startup time (used for dev console caching).
	CommandName    string    // Command to execute.
	CommandArgs    []string  // Additional args to pass to command.
	ServerSoftware string    // Value to pass to SERVER_SOFTWARE environment variable (e.g. websocketd/1.2.3).
	CloseMs        uint      // Milliseconds to start sending signals

	HandshakeTimeout time.Duration // time to finish handshake (default 1500ms)

	// settings
	StaticDir      string   // If set, static files will be served from this dir over HTTP.
	CgiDir         string   // If set, CGI scripts will be served from this dir over HTTP.
}

type Arglist []string

func (al *Arglist) String() string {
	return fmt.Sprintf("%v", []string(*al))
}

func (al *Arglist) Set(value string) error {
	*al = append(*al, value)
	return nil
}

func parseCommandLine() *Config {
	var config Config

	flag.CommandLine = flag.NewFlagSet(os.Args[0], flag.ContinueOnError)
	flag.CommandLine.Usage = func() {}

	// If adding new command line options, also update the help text in help.go.
	// The flag library's auto-generate help message isn't pretty enough.

	addrlist := Arglist(make([]string, 0, 1)) // pre-reserve for 1 address
	flag.Var(&addrlist, "address", "Interfaces to bind to (e.g. 127.0.0.1 or [::1]).")

	// server config options
	portFlag := flag.Int("port", 0, "HTTP port to listen on")
	udsFlag := flag.String("uds", "", "Path of the Unix Domain Socket to listen on")
	logLevelFlag := flag.String("loglevel", "access", "Log level, one of: debug, trace, access, info, error, fatal")
	closeMsFlag := flag.Uint("closems", 0, "Time to start sending signals (0 never)")
	redirPortFlag := flag.Int("redirport", 0, "HTTP port to redirect to canonical --port address")

	// lib config options
	staticDirFlag := flag.String("staticdir", "", "Serve static content from this directory over HTTP")
	cgiDirFlag := flag.String("cgidir", "", "Serve CGI scripts from this directory over HTTP")

	if err := flag.CommandLine.Parse(os.Args[1:]); err != nil {
		log.Fatal("invalid command line args: %s", err);
	}

	ipSocknum := len(addrlist)
	port := *portFlag
	udsOnly := *udsFlag != "" && ipSocknum == 0 && port == 0 && *redirPortFlag == 0

	if port == 0 && !udsOnly {
		port = 80
	}

	if ipSocknum != 0 {
		config.Addr = make([]string, ipSocknum)
		for i, addrSingle := range addrlist {
			config.Addr[i] = fmt.Sprintf("%s:%d", addrSingle, port)
		}
	} else if !udsOnly {
		config.Addr = []string{fmt.Sprintf("localhost:%d", port)}
	}
	config.Uds = *udsFlag
	config.RedirPort = *redirPortFlag
	config.LogLevel = LevelFromString(*logLevelFlag)
	if config.LogLevel == LogUnknown {
		log.Fatal("Incorrect loglevel flag '%s'", *logLevelFlag)
	}

	config.CloseMs = *closeMsFlag
	config.StaticDir = *staticDirFlag
	config.CgiDir = *cgiDirFlag
	config.StartupTime = time.Now()
	config.ServerSoftware = "websocketd.werm"
	config.HandshakeTimeout = time.Millisecond * 1500 // only default for now

	if len(os.Args) == 1 {
		log.Fatal("Command line arguments are missing.")
	}

	args := flag.Args()
	if len(args) < 1 && config.StaticDir == "" && config.CgiDir == "" {
		log.Fatal("Please specify COMMAND or provide --dir, --staticdir or --cgidir argument.")
	}

	if len(args) > 0 {
		if path, err := exec.LookPath(args[0]); err == nil {
			config.CommandName = path // This can be command in PATH that we are able to execute
			config.CommandArgs = flag.Args()[1:]
		} else {
			log.Fatal("Unable to locate specified COMMAND '%s' in OS path.", args[0])
		}
	}

	if config.CgiDir != "" {
		if inf, err := os.Stat(config.CgiDir); err != nil || !inf.IsDir() {
			log.Fatal("Your CGI dir '%s' is not pointing to an accessible directory.", config.CgiDir)
		}
	}

	if config.StaticDir != "" {
		if inf, err := os.Stat(config.StaticDir); err != nil || !inf.IsDir() {
			log.Fatal("Your static dir '%s' is not pointing to an accessible directory.", config.StaticDir)
		}
	}

	return &config
}
