/* Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd */

#ifndef _DTACHCTX_H_
#define _DTACHCTX_H_

#include "outstreams.h"
#include "third_party/dtach/dtach.h"
#include <unistd.h>

struct client;
struct subproc_args;

typedef struct dtach_ctx {
	struct client *cls;
	char *sockpath;
	struct subproc_args *spargs;

	struct pty the_pty;

	/* Indicates a client has attached at some point. */
	unsigned firstatch	: 1;

	/* Indicates the controlled process should be killed as soon as the
	   connection is terminated. */
	unsigned isephem	: 1;
} *Dtachctx;

/* Prints attached client information as a Javascript value. It is an array of
   strings, one string for each client. The string is the endpoint ID of the
   client. Only clients which are receiving terminal output are included in the
   array. */
void print_atch_clis(Dtachctx dc, struct fdbuf *b);

#endif
