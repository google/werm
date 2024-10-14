/* Copyright 2023 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd */

#include "outstreams.h"
#include "tmconst"

#include <stdio.h>

/* Base64-length encoding of given number of |byts|, including '=' padding. */
#define B64LEN(byts) (((byts) + 2) / 3 * 4)
#define SHA1SZ 20

typedef struct {
	char resource[32], query[2048], sescook[32];

	unsigned char chal[CHALLN_BYTESZ];

	/* one of G H or P for GET HEAD or POST */
	char rqtype;

	/* Set if sec-fetch-site header is present and is something other than a
	   trusted value. */
	unsigned restrictfetchsite : 1;

	/* Set if this is a websocket upgrade request, and the response header
	   has been written */
	unsigned validws : 1;

	/* Set if an error was printed. */
	unsigned error : 1;

	/* Indicates the client added keep-alive to the Connection header. */
	unsigned keepaliv : 1;

	/* Authorization is required but not complete, so redirect to an auth
	page is required */
	unsigned pendauth : 1;
} Httpreq;

/* Process request header from |src|.
   respout - where HTTP errors and websocket upgrade responses are printed */
void http_read_req(FILE *src, Httpreq *rq, struct wrides *errresp);

/* resp_dynamc writes an http response to fd from a block of memory with the
   given status code.

   Types of headers (hdr):
	t - plain text
	h - html
	c - css
	j - js
	f - ttf */
void resp_dynamc(struct wrides *de, char hdr, int code, void *b, size_t sz);

/* Exercises http functionality and writes test output to stdout, to be compared
   with golden test data. */
void test_http(void);

/* Whether this server requires authentication. */
int require_auth(void);

/* Fills in the rq->pendauth and rq->chal fields based on authentication state
of the session ID'd by rq->sesshdr. If doallow is true, then it clears
rq->pendauth and rq->chal, if they are set, and updates authn state. */
void authn_state(Httpreq *rq, int doallow);

/* Removes old authentication files. Should be called periodically to delete
accumulating auth files. */
void auth_maint(void);
