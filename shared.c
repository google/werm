/* Copyright 2023 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd */

#include <err.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <sys/stat.h>
#include <errno.h>
#include <string.h>

#include "shared.h"

int xasprintf(char **strp, const char *format, ...)
{
	int res;

	va_list argp;

	va_start(argp, format);
	res = vsnprintf(NULL, 0, format, argp);
	va_end(argp);
	if (res < 0) errx(1, "vsnprintf: failed to calc str length");

	*strp = malloc(res+1);

	va_start(argp, format);
	res = vsnprintf(*strp, res+1, format, argp);
	va_end(argp);
	if (res < 0) errx(1, "vsnprintf");

	return res;
}

const char *state_dir(void)
{
	static char *rd;
	const char *wermdir, *envd;

	if (rd) return rd;

	envd = getenv("WERMVARDIR");
	if (envd) { rd = strdup(envd); goto prepare; }

	wermdir = getenv("WERMSRCDIR");
	if (!wermdir) errx(1, "$WERMSRCDIR is unset");
	xasprintf(&rd, "%s/var", wermdir);

prepare:
	if (mkdir(rd, 0700) && errno != EEXIST) err(1, "cannot create %s", rd);

	setenv("WERMVARDIR", rd, 1);
	return rd;
}
