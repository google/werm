// Copyright 2013 Joe Walnes and the websocketd team.
// All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.


package main

import (
	"fmt"
	"os"
	"sync"
	"time"
)

type LogLevel int

const (
	LogDebug = iota
	LogTrace
	LogAccess
	LogInfo
	LogError
	LogFatal

	LogNone    = 126
	LogUnknown = 127
)

func logfunc(l *LogScope, level LogLevel, levelName string, msg string, args ...interface{}) {
	if level < l.MinLevel {
		return
	}
	fullMsg := fmt.Sprintf(msg, args...)

	l.Mutex.Lock()
	fmt.Fprintln(os.Stderr, Timestamp(), levelName, fullMsg)
	l.Mutex.Unlock()
}

type LogScope struct {
	MinLevel   LogLevel    // Minimum log level to write out.
	Mutex      *sync.Mutex // Should be shared across all LogScopes that write to the same destination.
}

func (l *LogScope) Debug(msg string, args ...interface{}) {
	logfunc(l, LogDebug, "D", msg, args...)
}

func (l *LogScope) Trace(msg string, args ...interface{}) {
	logfunc(l, LogTrace, "T", msg, args...)
}

func (l *LogScope) Access(msg string, args ...interface{}) {
	logfunc(l, LogAccess, "A", msg, args...)
}

func (l *LogScope) Info(msg string, args ...interface{}) {
	logfunc(l, LogInfo, "I", msg, args...)
}

func (l *LogScope) Error(msg string, args ...interface{}) {
	logfunc(l, LogError, "E", msg, args...)
}

func (l *LogScope) Fatal(msg string, args ...interface{}) {
	logfunc(l, LogFatal, "F", msg, args...)
}

func RootLogScope(minLevel LogLevel) *LogScope {
	return &LogScope{
		MinLevel:   minLevel,
		Mutex:      &sync.Mutex{},
	}
}

func Timestamp() string {
	return time.Now().Format(time.RFC3339)
}

func LevelFromString(s string) LogLevel {
	switch s {
	case "debug":
		return LogDebug
	case "trace":
		return LogTrace
	case "access":
		return LogAccess
	case "info":
		return LogInfo
	case "error":
		return LogError
	case "fatal":
		return LogFatal
	case "none":
		return LogNone
	default:
		return LogUnknown
	}
}
