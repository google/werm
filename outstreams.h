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

/* Flushes the buffer if it is not empty and `de` is set. Then frees the
 * buffer. */
void fdb_finsh(struct fdbuf *b);

/* Writes an entire buffer to the given file descriptor. If len is -1, prints
 * buf_ as a null-terminated string. */
void full_write(struct wrides *de, const void *buf_, ssize_t len);

void test_outstreams(void);

#endif
