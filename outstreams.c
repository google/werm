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

#include <err.h>
#include <errno.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>

#include "outstreams.h"

void fdb_apnd(struct fdbuf *b, const void *buf_, ssize_t len)
{
	const unsigned char *buf = buf_;

	if (len == -1) len = strlen(buf_);

	if (b->len >= sizeof(b->bf))
		errx(1, "buffer should be flushed already");

	while (len--) {
		b->bf[b->len++] = *buf++;
		if (b->len == sizeof(b->bf)) fdb_flsh(b);
	}
}

static void fullwriannot(struct wrides *de, const unsigned char *br, size_t sz)
{
	struct wrides basde = {de->fd};
	struct fdbuf eb = {&basde};
	char esc[5];

	fdb_apnd(&eb, de->escannot, -1);
	fdb_apnd(&eb, "[", -1);

	while (sz--) {
		esc[0] = *br++;
		esc[1] = 0;

		if (*esc == '\\') strcpy(esc, "\\\\");
		else if (*esc < ' ') sprintf(esc, "\\%03o", *esc);

		fdb_apnd(&eb, esc, -1);
	}

	fdb_apnd(&eb, "]\n", -1);
	fdb_flsh(&eb);
}

void fdb_flsh(struct fdbuf *b)
{
	if (b->len) full_write(b->de, b->bf, b->len);

	b->len = 0;
}

void full_write(struct wrides *de, const void *buf_, ssize_t sz)
{
	ssize_t writn;
	const unsigned char *buf = buf_;

	if (sz == -1) sz = strlen(buf_);
	if (sz < 0) abort();
	if (!sz) return;

	if (de->escannot) {
		fullwriannot(de, buf_, sz);
		return;
	}

	do {
		writn = write(de->fd, buf, sz);
		if (!writn) errx(1, "should be blocking");

		if (writn > 0) {
			sz -= writn;
			buf += writn;
		}
		else {
			perror("full_write");
			if (errno != EINTR) return;
		}
	} while (sz);
}
