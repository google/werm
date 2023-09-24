/* Copyright 2023 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License. */

#include <stddef.h>
#include <unistd.h>

#include "outstreams.h"

extern char *dtach_sock;

/* Indicates a client has attached at some point. */
extern int first_attach;

/* If true, will terminate process when last client disconnects. */
int is_ephem(void);

/* Whether the dtach component is logging. */
int dtach_logging(void);

void _Noreturn dtach_main(void);
int dtach_master(void);
void _Noreturn subproc_main(void);

/* Outputs terminal state to send to a client, such as whether using alternate
 * screen. */
void recount_state(struct wrides *de);

/* Processes output from the subprocess and writes the client output into rout.
 * "client output" should be sent to each attach process. */
void process_tty_out(struct fdbuf *rout, const void *buf, ssize_t len);

void forward_stdin(int sock);

/* ptyfd is the pseudo-terminal that controls the terminal-enabled process.
 * There is only one per master. vt100 keyboard input data is sent to this fd.
 * clioutfd is where output is sent to the attached client. This is used for
 * status updates (like the title) if needed. */
void process_kbd(int ptyfd, int clioutfd, unsigned char *buf, size_t bufsz);

/* role is a single character that identifies the role (e.g. master or
 * attacher). */
void set_argv0(char role);

/* Called if the process was attached to for the first time. */
void send_pream(int fd);

/* Called by master process. This must only be called by master, and never by
 * the attaching process, as the attaching process may have a later date on it
 * and thus create a new log file that doesn't get written to. */
void maybe_open_logs(void);

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
