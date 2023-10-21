/* Copyright 2023 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd */

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <dirent.h>
#include <string.h>

#include "shared.h"

#define STATEPREF "nextterid."
#define PREFLEN (sizeof(STATEPREF) - 1)

static char *increm(const char *cnm)
{
	int ci, maxlen = strlen(cnm) + 1;
	char *buf = malloc(maxlen + 1);

	buf[maxlen] = 0;
	strcpy(buf, cnm);

	/* a-z2-9, or base 34 */
	ci = 0;
	for (;;) {
		switch (cnm[ci]) {
		case 0:
			buf[ci] = 'b';
		return buf;

		case '9':
			buf[ci] = 'a';
			ci++;
		break;

		case 'z':
			buf[ci] = '2';
		return buf;

		default:
			buf[ci] = cnm[ci]+1;
		return buf;
		}
	}
}

struct pckd {
	char *next, *oldpath;
};

static void pickcand(struct pckd *c)
{
	DIR *sdfd;
	struct dirent *sdde;

	sdfd = opendir(state_dir());
	if (!sdfd) { perror("opendir"); abort(); }

	c->next = 0;
	c->oldpath = 0;
	while (errno = 0, sdde = readdir(sdfd)) {
		if (strncmp(sdde->d_name, STATEPREF, PREFLEN)) continue;

		if (c->oldpath) {
			fprintf(stderr,
				"There is more than one file named %s/%s*!"
				" Delete the extra ones.\n",
				state_dir(), STATEPREF);
			abort();
		}

		xasprintf(&c->oldpath, "%s/%s", state_dir(), sdde->d_name);
		c->next = increm(sdde->d_name + PREFLEN);
	}
	if (errno) { perror("readdir"); abort(); }

	if (!c->oldpath) {
		fprintf(stderr,
			"did not find curr ID file %s/%s*; will create\n",
			state_dir(), STATEPREF);
		c->next = strdup("a");
	}

	closedir(sdfd);
}

char *next_uniqid(void)
{
	char *newpath;
	struct pckd c;
	char er;
	int raceno;

	pickcand(&c);

	asprintf(&newpath, "%s/%s%s", state_dir(), STATEPREF, c.next);
	if (c.oldpath) {
		er = 0 > rename(c.oldpath, newpath);
		raceno = ENOENT;
	}
	else {
		er = 0 > mknod(newpath, S_IFREG | 0644, 0);
		raceno = EEXIST;
	}

	if (er) {
		if (raceno != errno) { perror("mknod/rename"); abort(); }
		free(c.next);
		c.next = 0;
	}

	free(c.oldpath);
	free(newpath);
	return c.next;
}
