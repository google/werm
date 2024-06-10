/* Copyright 2023 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd */

#include <limits.h>
#include <err.h>
#include <errno.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <sys/uio.h>
#include <arpa/inet.h>

#include "outstreams.h"
#include "shared.h"

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

void fdb_apnc(struct fdbuf *b, int c_)
{
	char c = c_;

	fdb_apnd(b, &c, 1);
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

char hexdig_lc(int v)
{
	v &= 0x0f;
	return v + (v < 10 ? '0' : 'W');
}

void fdb_hexb(struct fdbuf *b, int byt)
{
	fdb_apnc(b, hexdig_lc(byt >> 4));
	fdb_apnc(b, hexdig_lc(byt));
}

void fdb_routc(struct fdbuf *b, int c)
{
	char ebf[3];

	c &= 0xff;
	if (c == '\\' || c < ' ' || c > '~') {
		ebf[0] = '\\';
		ebf[1] = hexdig_lc(c >> 4);
		ebf[2] = hexdig_lc(c);
		fdb_apnd(b, ebf, 3);
	}
	else {
		fdb_apnc(b, c);
	}
}

void fdb_routs(struct fdbuf *b, const char *s, ssize_t len)
{
	if (len < 0) len = strlen(s);

	while (len--) fdb_routc(b, *s++);
}

void fdb_json(struct fdbuf *b, const char *s, ssize_t len)
{
	int c;

	if (len < 0) len = strlen(s);

	fdb_apnc(b, '"');
	while (len--) {
		c = *s++ & 0xff;
		if (c < ' ' || c == '"' || c == '\\') {
			fdb_apnd(b, "\\u00", -1);
			fdb_apnc(b, hexdig_lc(c >> 4));
			fdb_apnc(b, hexdig_lc(c));
		}
		else
			fdb_apnc(b, c);
	}
	fdb_apnc(b, '"');
}

void fdb_itoa(struct fdbuf *b, long long i)
{
	char bf[sizeof(long long) * 4], *bc = bf;

	if (i == LLONG_MIN) {
		fdb_itoa(b, LLONG_MIN/10);
		fdb_itoa(b, LLONG_MAX%10 + 1);
		return;
	}
	if (i < 0) {
		fdb_apnc(b, '-');
		fdb_itoa(b, -i);
		return;
	}

	do {
		*bc++ = (i % 10) + '0';
		i /= 10;
	}
	while (i);

	do fdb_apnc(b, *--bc);
	while (bc != bf);
}

void fdb_hexs(struct fdbuf *b, void *dat_, unsigned bsz)
{
	unsigned char *d = dat_;

	while (bsz--) fdb_hexb(b, *d++);
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
			if (	errno != EINTR
			&&	errno != EAGAIN
			&&	errno != EWOULDBLOCK
			)
				return;
		}
	} while (sz);
}

void write_wbsoc_frame(const void *buf, ssize_t len)
{
	unsigned char headr[14];
	struct iovec v[2], *vc;
	uint16_t len2;
	uint32_t len4;
	ssize_t writn;

	if (len < 0) len = strlen(buf);

	/* Perhaps send a ping if len is 0? */
	if (!len) return;

	/* Send as a single text data frame. */
	headr[0] = 0x81;

	v[0].iov_base = headr;
	if (len <= 125) {
		headr[1] = len;
		v[0].iov_len = 2;
	}
	else if (len <= 0xffff) {
		headr[1] = 126;
		len2 = htons(len);
		memcpy(headr + 2, &len2, 2);
		v[0].iov_len = 4;
	}
	else {
		headr[2] = 127;
		len4 = htonl(len >> 32);
		memcpy(headr + 2, &len4, 4);
		len4 = htonl(len);
		memcpy(headr + 6, &len4, 4);
		v[0].iov_len = 10;
	}

	v[1].iov_base = (void *) buf;
	v[1].iov_len = len;

	vc = v;

	writn = 0;
	for (;;) {
		vc->iov_len -= writn;

		writn = writev(1, vc, v+2 - vc);
		if (writn < 0) {
			if (writn == EINTR) continue;
			perror("writev websocket frame");
			abort();
		}
		if (!writn) abort();

		while (writn >= vc->iov_len) {
			writn -= vc->iov_len;
			if (++vc == v + 2) return;
		}
	}
}

void _Noreturn exit_msg(const char *flags, const char *msg, int code)
{
	struct fdbuf b = {0};
	char iserr = !!strchr(flags, 'e');

	/* Show white text on red (error) or black text on cyan (notice). */
	fdb_routs(&b, "\033[", -1);
	if (iserr)	fdb_routs(&b, "97;48;2;200;0;0", -1);
	else		fdb_routs(&b, "30;48;2;0;255;255", -1);
	fdb_routs(&b, ";1m ", -1);

	fdb_routs(&b, msg, -1);
	if (code != -1) fdb_itoa(&b, code);

	/* Reset colors in case a new master process is started in the same
	 * browser window. */
	fdb_routs(&b, " \033[0m\r\n", -1);
	fdb_apnc(&b, '\n');

	write_wbsoc_frame(b.bf, b.len);
	exit(iserr);
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

	fdb_itoa(&b, -19);
	fdb_apnc(&b, ' ');
	fdb_itoa(&b, -10);
	fdb_apnc(&b, ' ');
	fdb_itoa(&b, -1);
	fdb_apnc(&b, ' ');
	fdb_itoa(&b, 0);
	fdb_apnc(&b, ' ');
	fdb_itoa(&b, 1234);
	fdb_apnc(&b, ' ');
	fdb_itoa(&b, 9);
	fdb_apnc(&b, '\n');
	fdb_itoa(&b, 56789);
	fdb_apnc(&b, '\n');
	fdb_itoa(&b, 100000);
	fdb_apnc(&b, '\n');
	fdb_itoa(&b, INT_MIN);
	fdb_apnc(&b, '\n');
	fdb_itoa(&b, INT_MAX);
	fdb_apnc(&b, '\n');

	fdb_itoa(&b, LLONG_MIN);
	fdb_apnc(&b, ' ');
	fdb_itoa(&b, LLONG_MAX);
	fdb_apnc(&b, '\n');
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
