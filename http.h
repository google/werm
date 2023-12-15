/* Copyright 2023 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd */

#include "outstreams.h"

#include <stdio.h>

typedef struct {
	char resource[32];
	char query[512];

	/* Set if sec-fetch-site header is present and is something other than a
	   trusted value. */
	unsigned restrictfetchsite : 1;

	/* Set if this is a websocket upgrade request, and the response header
	   has been written */
	unsigned validws : 1;

	/* Set if an error was printed. */
	unsigned error : 1;

	/* Indicates a HEAD rather than a GET request. */
	unsigned head : 1;

	/* Indicates the client added keep-alive to the Connection header. */
	unsigned keepaliv : 1;
} Httpreq;

/* Process request header from |src|.
   respout - where HTTP errors and websocket upgrade responses are printed */
void http_read_req(FILE *src, Httpreq *rq, struct wrides *errresp);

/* resp_static sends a full http response to the given fd. path is relative to
   WERMSRCDIR.

   resp_dynamc writes an http response to fd from a block of memory with the
   given status code.

   Types of headers (hdr):
	t - plain text
	h - html
	c - css
	j - js
	f - ttf */
void resp_static(struct wrides *de, char hdr, const char *path);
void resp_dynamc(struct wrides *de, char hdr, int code, void *b, size_t sz);

/* Exercises http functionality and writes test output to stdout, to be compared
   with golden test data. */
void test_http(void);
