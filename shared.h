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

extern char *dtach_sock;

/* Indicates a client has attached at some point. */
extern int first_attach;

/* If true, will terminate process when last client disconnects. */
extern int dtach_ephem;

void _Noreturn dtach_main(void);
int dtach_master(void);
void _Noreturn subproc_main(void);

void clear_rout(void);
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

#include "outstreams.h"

/* Puts terminal state in fd to send to a client, such as whether using
 * alternate screen. */
void recount_state(struct wrides *de);
void process_tty_out(const void *buf, ssize_t len);
void get_rout_for_attached(const unsigned char **buf, size_t *len);

void forward_stdin(int sock);

/* ptyfd is the pseudo-terminal that controls the terminal-enabled process.
 * There is only one per master.
 * clioutfd is where output is sent to the attached client. */
void process_kbd(int ptyfd, int clioutfd, unsigned char *buf, size_t bufsz);

void set_argv0(const char *role);

/* Called if the process was attached to for the first time. */
void send_pream(int fd);

/* Called by master process. This must only be called by master, and never by
 * the attaching process, as the attaching process may have a later date on it
 * and thus create a new log file that doesn't get written to. */
void maybe_open_logs(void);
