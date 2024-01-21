/* Copyright 2023 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd */

#include "shared.h"
#include "wts.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

Wts wts;

static void logescaped(FILE *f, const void *buf_, size_t sz)
{
	const unsigned char *buf = buf_;

	while (sz--) {
		if (*buf >= ' ' && *buf != 0x7f)
			fputc(*buf, f);
		else
			fprintf(f, "\\%03o", *buf);
		buf++;
	}
	fputc('\n', f);
}

void dump_wts(void)
{
	char *dumpfn;
	FILE *f;
	static unsigned dimp;

	xasprintf(&dumpfn, "/tmp/werm.dump.%lld.%u",
		  (long long)getpid(), dimp++);
	f = fopen(dumpfn, "w");
	if (!f) perror("fopen for dump file");
	free(dumpfn);
	if (!f) return;

	fprintf(f, "escp: %d (%c)\n", wts.escp, wts.escp);
	fprintf(f, "clnttl: %u\n", wts.clnttl);
	fprintf(f, "windim: %u:%u\n", wts.swrow, wts.swcol);
	fprintf(f, "ttl: (sz=%u)\n", ttl_len());
	fprintf(f, "allowtmstate: %u\n", wts.allowtmstate);
	logescaped(f, wts.ttl, ttl_len());

	fclose(f);
}

unsigned ttl_len(void) { return strnlen(wts.ttl, sizeof wts.ttl); }
