/* Copyright 2023 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd */

/* Name is based on Write To Subproc but this contains process_kbd state too.
 * We put this in a single struct so all logic state can be reset with a single
 * memset call. */
typedef struct {
	unsigned short swrow, swcol;
	/* chars read into either winsize, ttl, or client_state's endpnt,
	   depending on value of escp */
	unsigned altbufsz;
	char winsize[8];

	int t;

	/* 0: reading raw characters
	 * '1': next char is escaped
	 * 'w': reading window size
	 * 't': reading title into ttl
	 * 'i': reading endpoint ID int client_state's endpnt
	 */
	char escp;

	/* title set by client */
	char ttl[128];

	unsigned allowtmstate	: 1;
	unsigned sendsigwin	: 1;
	unsigned writelg	: 1;
	unsigned writerawlg	: 1;

	/* True if the ttl contents were set by the client, false if the ttl
	   was populated automatically with line contents. */
	unsigned clnttl		: 1;

	/* Logs (either text only, or raw subproc output) are written to these
	 * fd's if writelg,writerawlg are 1. */
	struct wrides logde, rawlogde;
} Wts;

extern Wts wts;

void dump_wts(void);
unsigned ttl_len(void);
