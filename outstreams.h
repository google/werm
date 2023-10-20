/* Copyright 2023 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd */

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
	/* If unset, bf will grow unboundedly as writes accumulate. */
	struct wrides *de;
	unsigned cap, len;

	/* Automatically allocated on any append operation if unset. */
	unsigned char *bf;
};

/* Appends bytes to the end of the buffer and flushes it if it becomes full.
 * If len is -1, treats buf_ as a null-terminated string and appends the non-
 * null portion of it. */
void fdb_apnd(struct fdbuf *b, const void *buf_, ssize_t len);

/* Puts a literal byte at the end of the buffer, growing or flushing if needed.
 */
void fdb_apnc(struct fdbuf *b, int c_);

/* Flushes the buffer if it is not empty and `de` is set. Then frees the
 * buffer. */
void fdb_finsh(struct fdbuf *b);

/* Copies a byte to the buffer if it can be sent raw to the client for output.
 * If it needs escaping, puts the escaped value instead. */
void fdb_routc(struct fdbuf *b, int c);

/* Copies a string to the buffer so it can be sent to the client for output.
 * Will escape as needed like fdb_routc does. */
void fdb_routs(struct fdbuf *b, const char *s, ssize_t len);

/* Converts an int to a string and appends it to b. Escaping is not necessary if
 * this is used for terminal output to the client. */
void fdb_itoa(struct fdbuf *b, int i);

/* Writes an entire buffer to the given file descriptor. If len is -1, prints
 * buf_ as a null-terminated string. */
void full_write(struct wrides *de, const void *buf_, ssize_t len);

/* Writes data in buffer as a websocket data frame to stdout. */
void write_wbsoc_frame(const void *buf, ssize_t len);

/* Formats and escapes a message for output to stdout as websocket data.
 * code is concatenated on the end of the message, if it is not -1.
 * flags can be any number of these characters in a string:
 * "s" - include dtach_socket value
 * "e" - treat and format as error rather than neutral termination notice
 */
void _Noreturn exit_msg(const char *flags, const char *msg, int code);

void test_outstreams(void);

#endif
