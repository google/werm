/* Copyright 2023 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd */

#ifndef _SHARED_H_
#define _SHARED_H_

#include <stddef.h>
#include <stdio.h>
#include <unistd.h>
#include <stdint.h>

#include "dtachctx.h"
#include "outstreams.h"

/* Connects to a UNIX socket as a client and returns the stream fd, or -1 on
   error, setting errno. */
int connect_uds_as_client(const char *name);

/* State of a client connected to the dtach socket. */
struct clistate {
	/* An opaque endpoint ID. This is chosen at random by the client and
	   persisted indefinitely. */
	char endpnt[8];

	/* Whether the client wants to receive terminal output and state
	   updates. */
	unsigned wantsoutput : 1;
};

/* Whether the dtach component is logging. */
int dtach_logging(void);

void _Noreturn subproc_main(Dtachctx dc);

/* Processes output from the subprocess and writes the client output into rout.
 * "client output" should be sent to each attach process. */
void process_tty_out(struct fdbuf *rout, const void *buf, ssize_t len);

/* ptyfd is the pseudo-terminal that controls the terminal-enabled process.
 * There is only one per master. vt100 keyboard input data is sent to this fd.
 * clioutfd is where output is sent to the attached client. This is used for
 * status updates (like the title) if needed. */
void process_kbd(int clioutfd, Dtachctx dc, struct clistate *cls,
		 unsigned char *buf, size_t bufsz);

/* role is a single character that identifies the role (e.g. master or
 * attacher). */
void set_argv0(Dtachctx dc, char role);

/* Called if the process was attached to for the first time. */
void send_pream(int fd);

/* Called by master process. This must only be called by master, and never by
 * the attaching process, as the attaching process may have a later date on it
 * and thus create a new log file that doesn't get written to. */
void open_logs(void);

/* Allocates a new string of sufficient size and prints a formatted string to
 * it. Returns the length of the new string. */
int xasprintf(char **strp, const char *format, ...)
	__attribute__((format (printf, 2, 3)));

/* Returns a directory used to store state the persists across reboots and
 * server instances. */
const char *state_dir(void);

/* Returns the next unique terminal ID suffix to use, not including the first
 * dot, e.g. "abc" */
char *next_uniqid(void);

/* Serves http over stdin/stdout. Returns 1 if the connection can be used to
   continue serving requests. */
int http_serv(void);

#endif
