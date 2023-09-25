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
	unsigned thissz;

	if (!b->bf) {
		if (!b->cap) b->cap = 64;
		b->bf = malloc(b->cap);
	}

	if (len == -1) len = strlen(buf_);

	while (len) {
		if (b->cap == b->len) {
			if (b->de) {
				full_write(b->de, b->bf, b->len);
				b->len = 0;
				continue;
			}

			if (b->cap > 20) b->cap >>= 1;
			b->cap *= 3;

			b->bf = realloc(b->bf, b->cap);
		}

		thissz = b->cap - b->len;
		if (thissz > len) thissz = len;

		memcpy(b->bf + b->len, buf, thissz);
		b->len += thissz;
		len -= thissz;
		buf += thissz;
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
	fdb_finsh(&eb);
}

void fdb_finsh(struct fdbuf *b)
{
	if (b->len && b->de) full_write(b->de, b->bf, b->len);

	free(b->bf);
	b->bf = 0;
	b->len = b->cap = 0;
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

void test_outstreams(void)
{
	struct wrides de = {1};
	struct fdbuf b = {&de, 32};
	int i;

	printf("TEST OUTSTREAMS\n");
	fdb_apnd(&b, "hello\n", -1);
	fdb_apnd(&b, "goodbye\n do not print this part", 8);
	fdb_finsh(&b);

	de.escannot = "customcap";
	b.cap = 7;
	fdb_apnd(&b, "abcdefghijklmnopqrstuvwxyz....0123456789", -1);
	printf("about to flush: ");
	fdb_finsh(&b);

	/* no wrides */
	b.cap = 1;
	b.de = 0;
	de.escannot = "grow unboundedly";
	fdb_apnd(&b, "abcdefghijklmnopqrstuvwxyz....0123456789", -1);
	printf("grow unboundedly: %u,%u ", b.len, b.cap);
	fdb_apnd(&b, "ABCDEFGHIJKLMNOPQRSTUVWXYZ....!@#$!@#$!?", -1);
	printf("%u,%u\n", b.len, b.cap);
	full_write(&de, b.bf, b.len);
	printf("finishing capacity: %u\n", b.cap);
	fdb_finsh(&b);

	de.escannot = "customcap+multipleapnd";
	b.de = &de;
	b.cap = 16;
	for (i = 0; i < 50; i++) fdb_apnd(&b, i & 1 ? "abc" : "123", i % 3);
	fdb_finsh(&b);
}
