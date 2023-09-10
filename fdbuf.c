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
#include <string.h>
#include <stdio.h>

#include "shared.h"

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

static void flshannot(struct fdbuf *b)
{
	struct fdbuf eb = { .fd = b->fd };
	int i, c;
	char esc[5];

	FULL_WRITE(b->fd, b->escannot, -1);
	fdb_apnd(&eb, "[", -1);

	for (i = 0; i < b->len; i++) {
		esc[0] = b->bf[i];
		esc[1] = 0;

		if (*esc < ' ' || *esc == '\\') sprintf(esc, "\\%03o", *esc);

		fdb_apnd(&eb, esc, -1);
	}

	fdb_apnd(&eb, "]\n", -1);
	fdb_flsh(&eb);
}

void fdb_flsh(struct fdbuf *b)
{
	unsigned bi;

	if (!b->len) return;

	if (!b->escannot) FULL_WRITE(b->fd, b->bf, b->len);
	else flshannot(b);

	b->len = 0;
}
