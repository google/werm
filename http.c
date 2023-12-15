/* Copyright 2023 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd */

#include "http.h"
#include "outstreams.h"
#include "shared.h"

#include <sys/stat.h>
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <openssl/pem.h>
#include <openssl/sha.h>
#include <openssl/evp.h>
#include <openssl/err.h>

static char reqln[512], *reqcr;
static unsigned llen;

static int readreqln(FILE *f)
{
	fgets(reqln, sizeof(reqln), f);
	llen = strnlen(reqln, sizeof(reqln));
	if (llen == sizeof(reqln) || llen < 2) return 0;

	if (reqln[--llen] != '\n' || reqln[--llen] != '\r') return 0;
	reqln[llen] = 0;
	reqcr = reqln;

	return 1;
}

static void lcase(char *c) { if (*c >= 'A' && *c <= 'Z') *c |= 0x20; }

static int isws(char c) { return c==9 || c==0xa || c==0xc || c==0xd || c==0x20; }

static int consumereqln(const char *pref)
{
	size_t plen = strlen(pref);
	char *hdrc;

	if (strncmp(reqcr, pref, plen)) return 0;
	reqcr += plen;
	llen -= plen;

	while (isws(*reqcr)) { reqcr++; llen--; }

	if (strcmp("connection:", pref) && strcmp("upgrade:", pref)) return 1;

	for (hdrc = reqcr; *hdrc; hdrc++) lcase(hdrc);

	return 1;
}

static int hastok(const char *tk)
{
	char *c = reqcr, after;

	ssize_t tkl = strlen(tk);

	for (;;) {
		while (isws(*c) || *c == ',') c++;
		if (!*c) return 0;
		if (!strncmp(c, tk, tkl)) {
			after = c[tkl];
			if (after == ',' || after == ' ' || !after) return 1;
		}
		c++;
	}
}

#define CHALLKEYLEN 16
#define SHA1SZ 20

/* Length is the expected length of base64-encoding the raw bytes of a
   sha1 hash, including '=' padding, plus a null terminator. */
static char acceptkey[29];

static int procwskeyhdr(const char *wskeyhdr, struct wrides *errout)
{
	const char *salt = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
	unsigned char binhasho[EVP_MAX_MD_SIZE];
	unsigned char challkey[CHALLKEYLEN + 1];
	unsigned binhashl;
	char sslerrbuf[256];
	long sslerr;
	struct fdbuf respbuf = {0};
	size_t redn, writn;
	int ers = 0;

	EVP_MD_CTX	*s1ctx	= EVP_MD_CTX_create();
	BIO		*b64	= BIO_new(BIO_f_base64());
	BIO		*bmem	= BIO_new(BIO_s_mem());

	if (!b64 || !bmem || !s1ctx || !BIO_push(b64, bmem)) goto dumperr;

	if (!BIO_write_ex(bmem, wskeyhdr, strlen(wskeyhdr), &writn))
		goto dumperr;
	if (writn != strlen(wskeyhdr)) goto dumperr;
	if (!BIO_write_ex(bmem, "\n", 1, &writn)) goto dumperr;
	if (writn != 1) goto dumperr;
	if (!BIO_read_ex(b64, challkey, sizeof(challkey), &redn)) goto dumperr;
	if (redn != CHALLKEYLEN) {
		fdb_apnd(&respbuf, "challenge key wrong size\n", -1);
		fdb_apnd(&respbuf, "  expected: ", -1);
		fdb_itoa(&respbuf, CHALLKEYLEN);
		fdb_apnd(&respbuf, "\n  actual: ", -1);
		fdb_itoa(&respbuf, redn);
		fdb_apnc(&respbuf, '\n');
		ers = 400;
		goto dumperr;
	}

	/* Switch to EVP_MD_fetch if EVP_sha1 is called multiple times in a
	   process. */
	if (!EVP_DigestInit_ex(s1ctx, EVP_sha1(), 0))		goto dumperr;
	if (!EVP_DigestUpdate(s1ctx, wskeyhdr, strlen(wskeyhdr))) goto dumperr;
	if (!EVP_DigestUpdate(s1ctx, salt, strlen(salt)))	goto dumperr;
	if (!EVP_DigestFinal_ex(s1ctx, binhasho, &binhashl))	goto dumperr;

	if (binhashl != SHA1SZ) goto dumperr;

	if (!BIO_write_ex(b64, binhasho, binhashl, &writn)) goto dumperr;
	if (writn != binhashl || 1 > BIO_flush(b64)) goto dumperr;
	if (!BIO_read_ex(bmem, acceptkey, sizeof(acceptkey), &redn))
		goto dumperr;
	if (redn != sizeof(acceptkey)) goto dumperr;

	/* Replace b64's guaranteed newline with null terminator */
	acceptkey[sizeof(acceptkey)-1] = 0;

	goto cleanup;

dumperr:
	for (;;) {
		sslerr = ERR_get_error();
		if (!sslerr) break;
		ERR_error_string_n(sslerr, sslerrbuf, sizeof(sslerrbuf));
		fdb_apnd(&respbuf, "openssl error: ", -1);
		fdb_apnd(&respbuf, sslerrbuf, -1);
		fdb_apnc(&respbuf, '\n');
	}
	/* default error is internal server error */
	resp_dynamc(errout, 't', ers ? ers : 500, respbuf.bf, respbuf.len);
	fdb_finsh(&respbuf);

cleanup:
	if (s1ctx)	EVP_MD_CTX_destroy(s1ctx);
	if (b64)	BIO_free(b64);
	if (bmem)	BIO_free(bmem);

	return !ers;
}

void http_read_req(FILE *src, Httpreq *rq, struct wrides *respout)
{
	char *rc, *qstart;
	int connectionupgr = 0, goodwsver = 0, upgradews = 0, wsconds = -1;
	struct fdbuf respbuf = {0};

	if (!readreqln(src)) goto badreq;

	if (	consumereqln("PUT ")
	    ||	consumereqln("POST ")
	    ||	consumereqln("DELETE ")
	    ||	consumereqln("CONNECT ")
	    ||	consumereqln("OPTIONS ")
	    ||	consumereqln("TRACE ")
	    ||	consumereqln("PATCH ")) goto methoderr;

	if (!consumereqln("GET ")) {
		if (!consumereqln("HEAD ")) goto badreq;
		rq->head = 1;
	}

	if (llen < 9) goto badreq;
	if (strcmp(" HTTP/1.1", reqcr + llen - 9)) goto badreq;
	llen -= 9;
	reqcr[llen] = 0;

	qstart = strchr(reqcr, '?');
	if (!qstart)
		qstart = reqcr + llen;
	else {
		*qstart = 0;
		strncpy(rq->query, qstart+1, sizeof(rq->query));
	}

	if (qstart - reqcr > sizeof(rq->resource) - 1) goto badreq;
	strcpy(rq->resource, reqcr);

	for (;;) {
		readreqln(src);
		if (!llen) break;

		for (rc = reqln; *rc && *rc != ':'; rc++) lcase(rc);

		if (consumereqln("sec-fetch-site:")) {
			if (strcmp("same-origin",	reqcr) &&
			    strcmp("same-site",		reqcr) &&
			    strcmp("none",		reqcr) &&
			    strcmp("",			reqcr))
				rq->restrictfetchsite = 1;
		}

		if (consumereqln("upgrade:")) {
			if (!strcmp(reqcr, "websocket")) upgradews = 1;
			continue;
		}
		if (consumereqln("connection:")) {
			if (hastok("upgrade")) connectionupgr = 1;
			continue;
		}
		if (consumereqln("sec-websocket-version:")) {
			if (hastok("13")) goodwsver = 1;
			continue;
		}
		if (consumereqln("sec-websocket-key:")) {
			if (!procwskeyhdr(reqcr, respout)) goto seterr;
			continue;
		}
	}

	wsconds = (upgradews		? 1 : 0)
		| (connectionupgr	? 2 : 0)
		| (goodwsver		? 4 : 0)
		| (*acceptkey		? 8 : 0);

	if (!wsconds)		goto cleanup;
	if (wsconds != 15)	goto badreq;
	if (rq->head)		goto methoderr;

	rq->validws = 1;
	fdb_apnd(&respbuf,	"HTTP/1.1 101 Switching Protocols\r\n"
				"Upgrade: websocket\r\n"
				"Connection: Upgrade\r\n"
				"Sec-WebSocket-Accept: ", -1);

	fdb_apnd(&respbuf, acceptkey, -1);
	fdb_apnd(&respbuf, "\r\n\r\n", -1);
	full_write(respout, respbuf.bf, respbuf.len);
	goto cleanup;

methoderr:
	resp_dynamc(respout, 't', 405, 0, 0);
	goto seterr;

badreq:
	fdb_apnd(&respbuf, "bad request\n", -1);
	fdb_apnd(&respbuf, "websocket upgrade conditions: ", -1);
	fdb_itoa(&respbuf, wsconds);
	fdb_apnc(&respbuf, '\n');
	resp_dynamc(respout, 't', 400, respbuf.bf, respbuf.len);

seterr:
	rq->error = 1;

cleanup:
	fdb_finsh(&respbuf);
}

static void dumpreq(Httpreq *rq)
{
	if (rq->error) { puts("rq.error is yes"); return; }

	printf("resource: %s\n", rq->resource);
	if (*rq->query) printf("query: %s\n", rq->query);
	printf("restrict fetch site: %u valid ws: %u head: %u\n",
	       rq->restrictfetchsite, rq->validws, rq->head);
}

static void resettmpfile(FILE **f)
{
	if (*f) {
		if (ferror(*f)) { perror("test temp file"); exit(1); }
		fclose(*f);
	}
	*f = tmpfile();
}

static void resphdr(struct wrides *de, int code, char hdr, size_t contlength)
{
	struct fdbuf b = {de, 512};
	const char *codest, *contype;
	int utf8, xfdeny;

	switch (code) {
	default: abort();
		case 200: xfdeny=1; codest="200 OK";
	break;	case 400: xfdeny=0; codest="400 Bad Request";
	break;	case 403: xfdeny=0; codest="403 Forbidden";
	break;	case 404: xfdeny=0; codest="404 Not Found";
	break;	case 405: xfdeny=0; codest="405 Method Not Allowed";
	break;	case 500: xfdeny=0; codest="500 Internal Server Error";
	}

	switch (hdr) {
	default: abort();
		case 't': utf8=1; contype="text/plain";
	break;	case 'h': utf8=1; contype="text/html";
	break;	case 'c': utf8=1; contype="text/css";
	break;	case 'j': utf8=1; contype="application/javascript";
	break;	case 'f': utf8=0; contype="font/ttf";
	}

	fdb_apnd(&b, "HTTP/1.1 ", -1);
	fdb_apnd(&b, codest, -1);
	fdb_apnd(&b, "\r\n", 2);
	if (xfdeny) fdb_apnd(&b, "X-Frame-Options: DENY\r\n", -1);

	fdb_apnd(&b, "Connection: keep-alive\r\n", -1);
	fdb_apnd(&b, "Content-Type: ", -1);
	fdb_apnd(&b, contype, -1);
	if (utf8) fdb_apnd(&b, "; charset=utf-8", -1);
	fdb_apnd(&b, "\r\n", -1);
	fdb_apnd(&b, "Content-Length: ", -1);
	fdb_itoa(&b, contlength);
	fdb_apnd(&b, "\r\n\r\n", -1);

	fdb_finsh(&b);
}

void resp_static(struct wrides *de, char hdr, const char *path)
{
	int sfd, ern, redn;
	char *fullp=0, buf[4096];
	const char *eop;
	struct stat sb;
	struct fdbuf erb = {0};

	/* We are not checking for "/../" in path because path should be part of
	   a hard-coded whitelist, and if not, it will not be able to access any
	   file not already accessible with `cat <path>` in a shell. */
	xasprintf(&fullp, "%s/%s", getenv("WERMSRCDIR"), path);

	sfd = open(fullp, O_RDONLY);
	if (0>sfd)		{ eop = "op: open\n"; goto dumperr; }
	if (0>fstat(sfd, &sb))	{ eop = "op: stat\n"; goto dumperr; }

	resphdr(de, 200, hdr, sb.st_size);

	for (;;) {
		redn = read(sfd, buf, sizeof(buf));

		if (!redn)	goto cleanup;
		if (0<redn)	full_write(de, buf, redn);
		if (0>redn && errno!=EINTR) { perror("read static"); exit(1); }
	}

dumperr:
	ern = errno;

	fdb_apnd(&erb, eop, -1);
	fdb_apnd(&erb, "errno: ", -1);
	fdb_itoa(&erb, ern);
	fdb_apnc(&erb, '\n');
	fdb_apnd(&erb, "fullp: ", -1);
	fdb_apnd(&erb, fullp, -1);
	fdb_apnc(&erb, '\n');

	resp_dynamc(de, 't', 500, erb.bf, erb.len);

	fdb_finsh(&erb);

cleanup:
	if (sfd >= 0) close(sfd);
}

void resp_dynamc(struct wrides *de, char hdr, int code, void *b, size_t sz)
{
	resphdr(de, code, hdr, sz);
	full_write(de, b, sz);
}

void test_http(void)
{
	struct wrides de = {1, "httpresp"};
	FILE *src = tmpfile();
	Httpreq rq;

	puts("TRIVIAL RESOURCE AND BLANK QUERY");
	memset(&rq, 0, sizeof(rq));
	fputs("GET / HTTP/1.1\r\n", src);
	fputs("\r\n", src);
	fseek(src, 0, SEEK_SET);
	http_read_req(src, &rq, &de);
	dumpreq(&rq);
	resettmpfile(&src);

	puts("INTERESTING PATH+QUERY");
	memset(&rq, 0, sizeof(rq));
	fputs("GET /asdf?xyz=a%3fb%20c HTTP/1.1\r\n", src);
	fputs("\r\n", src);
	fseek(src, 0, SEEK_SET);
	http_read_req(src, &rq, &de);
	dumpreq(&rq);
	resettmpfile(&src);

	puts("TEST ACCEPT-KEY CALCULATION");
	memset(&rq, 0, sizeof(rq));
	fputs("GET / HTTP/1.1\r\nHost: localhost:8090\r\nConnection: Upgrade\r\nPragma: no-cache\r\nCache-Control: no-cache\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0\r\nUpgrade: websocket\r\nOrigin: http://localhost:8090\r\nSec-WebSocket-Version: 13\r\nAccept-Encoding: gzip, deflate, br\r\nAccept-Language: en-US,en;q=0.9,ja;q=0.8,zh-TW;q=0.7,zh;q=0.6\r\nSec-WebSocket-Key: WTh9rpWlwlBcMRUQqbXuFg==\r\nSec-WebSocket-Extensions: permessage-deflate; client_max_window_bits\r\n\r\n", src);
	fseek(src, 0, SEEK_SET);
	http_read_req(src, &rq, &de);
	dumpreq(&rq);
	resettmpfile(&src);

	puts("TEST ACCEPT-KEY AGAIN");
	memset(&rq, 0, sizeof(rq));
	fputs("GET / HTTP/1.1\r\nHost: localhost:8090\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nOrigin: http://localhost:8090\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: j/26SYgMGzb8gVdanOs/2A==\r\n\r\n", src);
	fseek(src, 0, SEEK_SET);
	http_read_req(src, &rq, &de);
	dumpreq(&rq);
	resettmpfile(&src);

	puts("EXAMPLE FROM RFC-6455");
	memset(&rq, 0, sizeof(rq));
	fputs("GET / HTTP/1.1\r\nHost: localhost:8090\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nOrigin: http://localhost:8090\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n", src);
	fseek(src, 0, SEEK_SET);
	http_read_req(src, &rq, &de);
	dumpreq(&rq);
	resettmpfile(&src);

	puts("UNSUPPORTED METHOD POST");
	memset(&rq, 0, sizeof(rq));
	fputs("POST /?termid=x.y HTTP/1.1\r\n\r\n", src);
	fseek(src, 0, SEEK_SET);
	http_read_req(src, &rq, &de);
	dumpreq(&rq);
	resettmpfile(&src);

	puts("WEBSOCKET UPGRADE: KEY TOO SHORT");
	memset(&rq, 0, sizeof(rq));
	fputs("GET / HTTP/1.1\r\nHost: localhost:8090\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nOrigin: http://localhost:8090\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25j\r\n\r\n", src);
	fseek(src, 0, SEEK_SET);
	http_read_req(src, &rq, &de);
	dumpreq(&rq);
	resettmpfile(&src);

	puts("WEBSOCKET UPGRADE: INVALID VERSION");
	memset(&rq, 0, sizeof(rq));
	fputs("GET / HTTP/1.1\r\nHost: localhost:8090\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nOrigin: http://localhost:8090\r\nSec-WebSocket-Version: 14\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n", src);
	fseek(src, 0, SEEK_SET);
	http_read_req(src, &rq, &de);
	dumpreq(&rq);
	resettmpfile(&src);

	puts("WEBSOCKET UPGRADE: INVALID CONNECTION HDR");
	memset(&rq, 0, sizeof(rq));
	fputs("GET / HTTP/1.1\r\nHost: localhost:8090\r\nConnection: Oopgrade\r\nUpgrade: websocket\r\nOrigin: http://localhost:8090\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: j/26SYgMGzb8gVdanOs/2A==\r\n\r\n", src);
	fseek(src, 0, SEEK_SET);
	http_read_req(src, &rq, &de);
	dumpreq(&rq);
	resettmpfile(&src);

	fclose(src);
}
