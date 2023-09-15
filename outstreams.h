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

#ifndef OUTSTREAMS_H
#define OUTSTREAMS_H

#include <stddef.h>
#include <unistd.h>

/* Encapsulates a file descriptor used for writing, but with an annotation
 * feature. */
struct wrides {
	int fd;

	/* If non-null, indicates flushed buffer contents should be annotated
	 * and escaped into human-readable form as in:
	 *
	 * escannot[buffer contents].
	 *
	 * Intended for more readable test output.
	 */
	const char *escannot;
};

/* Comprises a file descriptor and a buffer which is pending a write to it.
 * This is useful for adhoc and simple buffering of content to an fd. */
struct fdbuf {
	struct wrides *de;
	char bf[64];
	int len;
};

/* Appends bytes to the end of the buffer and flushes it if it becomes full.
 * If len is -1, treats buf_ as a null-terminated string and appends the non-
 * null portion of it. */
void fdb_apnd(struct fdbuf *b, const void *buf_, ssize_t len);

/* Flushes the buffer if it is not empty. */
void fdb_flsh(struct fdbuf *b);

/* Writes an entire buffer to the given file descriptor. If len is -1, prints
 * buf_ as a null-terminated string. */
void full_write(struct wrides *de, const void *buf_, ssize_t len);

void test_outstreams(void);

#endif
