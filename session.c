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

#include "shared.h"
#include "outstreams.h"
#include "test/raw/data.h"

#include <limits.h>
#include <time.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <stdlib.h>
#include <fcntl.h>
#include <sys/ioctl.h>
#include <err.h>
#include <stdarg.h>
#include <dirent.h>

static char *argv0, *termid, *logview, *sblvl, *dtachlog;
static const char *qs;

static size_t argv0sz;

int is_ephem(void) { return !termid; }

/* Name is based on Write To Subproc but this contains process_kbd state too.
 * We put this in a single struct so all logic state can be reset with a single
 * memset call. */
static struct {
	unsigned short swrow, swcol;
	/* chars read into either winsize or ttl, depending on value of escp */
	unsigned altbufsz;
	char winsize[8];

	/* 0: reading raw characters
	 * '1': next char is escaped
	 * 'w': reading window size
	 * 't': reading title into ttl
	 */
	char escp;

	/* title set by client */
	char ttl[128];

	/* Buffers for content about to be written to logs */
	unsigned char linebuf[1024], escbuf[1024];
	unsigned linesz, linepos, escsz;

	unsigned altscren	: 1;
	unsigned appcursor	: 1;
	unsigned sendsigwin	: 1;
	unsigned writelg	: 1;
	unsigned writerawlg	: 1;

	/* Logs (either text only, or raw subproc output) are written to these
	 * fd's if writelg,writerawlg are 1. */
	struct wrides logde, rawlogde;
} wts;

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

static unsigned ttllen(void) { return strnlen(wts.ttl, sizeof wts.ttl); }

static void dump(void)
{
	char *dumpfn;
	FILE *f;
	static unsigned dimp;

	xasprintf(&dumpfn, "/tmp/werm.dump.%lld.%u",
		  (long long)getpid(), dimp++);
	f = fopen(dumpfn, "w");
	if (!f) warn("could not fopen %s for dumping state", dumpfn);
	free(dumpfn);
	if (!f) return;

	fprintf(f, "escp: %d (%c)\n", wts.escp, wts.escp);
	fprintf(f, "linebuf: (pos=%u, sz=%us)\n", wts.linepos, wts.linesz);
	logescaped(f, wts.linebuf, wts.linesz);
	fprintf(f, "escbuf: (%u bytes)\n", wts.escsz);
	logescaped(f, wts.escbuf, wts.escsz);
	fprintf(f, "altscr:  %u\n", wts.altscren);
	fprintf(f, "appcurs: %u\n", wts.appcursor);
	fprintf(f, "windim: %u:%u\n", wts.swrow, wts.swcol);
	fprintf(f, "ttl: (sz=%u)\n", ttllen());
	logescaped(f, wts.ttl, ttllen());

	fclose(f);
}

static int hexdig(int v)
{
	v &= 0x0f;
	return v + (v < 10 ? '0' : 'W');
}

static void routesca(struct fdbuf *rout, int b)
{
	char ebf[3];

	if (b == '\\' || b < ' ' || b > '~') {
		b &= 0xff;

		ebf[0] = '\\';
		ebf[1] = hexdig(b >> 4);
		ebf[2] = hexdig(b);
		fdb_apnd(rout, ebf, 3);
	}
	else fdb_apnd(rout, &b, 1);
}

static _Bool consumeesc(const char *pref, size_t preflen)
{
	if (preflen > sizeof(wts.escbuf))
		errx(1, "preflen too long: %zu", preflen);
	if (wts.escsz != preflen) return 0;
	if (memcmp(pref, wts.escbuf, preflen)) return 0;
	wts.escsz = 0;
	return 1;
}

/* app cursor on: \x1b[?1h
 * app cursor off: \x1b[?1l
 */
#define CONSUMEESC(pref) consumeesc(pref, sizeof(pref)-1)

/* Terminal Machine (TM...) functions are implemented in both Javascript and C.
 * They consider arguments to be untrusted - memory access must be guarded.
 * This means out-of-bounds checking to prevent an uncaught exception in
 * Javascript, and avoiding illegal accesses or UB in C.
 *
 * Code that exists above the VM... layer should be syntax-neutral between C and
 * Javascript. IOW, code that calls it will be executed in Javascript on the
 * client and in C on the server.
 */
#define TMpeek(buf, i) ((buf)[(i) % sizeof(buf)])
#define TMpoke(buf, i, val) do { (buf)[(i) % sizeof(buf)] = (val); } while (0)

static void TMlineresize(int sz)
{
	if (sz < 0 || sz > sizeof(wts.linebuf)) return;

	while (wts.linesz < sz) wts.linebuf[wts.linesz++] = ' ';
	wts.linesz = sz;
	if (wts.linepos > sz) wts.linepos = sz;
}

static void TMlinepos(long pos)
{
	if (pos < 0 || pos > wts.linesz) return;
	wts.linepos = pos;
}

static void linemov(int to, int fr, int step, unsigned sz)
{
	to += wts.linepos;
	fr += wts.linepos;
	while (sz--) {
		TMpoke(wts.linebuf, to, TMpeek(wts.linebuf, fr));
		TMpoke(wts.linebuf, fr, ' ');
		to += step;
		fr += step;
	}
}

static void deletechrahead(void)
{
	char *endptr;
	const char *lesc;
	unsigned long cnt;
	unsigned mvsz;

	lesc = (char *)wts.escbuf + wts.escsz - 1;
	if (wts.escsz < 4 || wts.escbuf[1] != '[') return;

	cnt = strtoul((char *)wts.escbuf+2, &endptr, 10);

	if (endptr != lesc) return;

	mvsz = wts.linesz - wts.linepos;
	switch (*lesc) {
	case 'P':
		linemov(0, cnt, 1, mvsz);
		TMlineresize(wts.linesz - cnt);
		break;
	case 'G':
		wts.linepos = cnt - 1;
		break;
	case '@':
		TMlineresize(wts.linesz + cnt);
		linemov(cnt + mvsz - 1, mvsz - 1, -1, mvsz);
		break;

	default:
		return;
	}

	wts.escsz = 0;
}

/* Obviously this function is a mess. But I'm still planning how to clean it up.
 */
void process_tty_out(struct fdbuf *rout, const void *buf_, ssize_t len)
{
	char lastescbyt;
	const unsigned char *buf = buf_;

	if (len < 0) len = strlen(buf_);

	if (wts.writerawlg) full_write(&wts.rawlogde, buf, len);

	while (len) {
		if (buf[0] == '\r') {
			wts.escsz = 0;
			/* A previous version would move linepos to the start of
			 * a wrapped line rather than the position of the most
			 * recent \n.
			 * That was almost correct, but the boundary condition
			 * was not handled right. When the cursor is at the end
			 * of the line but has not written any char to the next
			 * line yet, it should move to the start of the full
			 * line, not remain stationary.
			 *
			 * TODO make that work correct when I have time to write
			 * tests.
			 */
			wts.linepos = 0;
			goto eol;
		}

		if (buf[0] == '\b') {
			/* move left */
			TMlinepos(wts.linepos-1);
			goto eol;
		}

		/* The bell character (7) is the correct way to
		 * terminate escapes that start with \033] */
		if (*buf == 7) wts.escsz = 0;

		if (*buf >= 'A' && *buf <= 'Z' && CONSUMEESC("\033[")) {
			switch (*buf) {
			/* delete to EOL */
			case 'J':
				/* This clears the screen, either below (0J or
				 * J) above (1J) or all (2J). We just assume 0J
				 * and only change the current line. Some day we
				 * may keep the whole screen in the buffer
				 * rather than the current line, in which case
				 * this has to change. Also, once we see 1J or
				 * 2J in the wild we will implement it.
				 */
			case 'K': TMlineresize(wts.linepos);		break;

			case 'A': TMlinepos(wts.linepos - wts.swcol);	break;

			case 'C': TMlinepos(wts.linepos+1); 		break;
			}
			goto eol;
		}
		if (*buf >= 'a' && *buf <= 'z') {
			if (CONSUMEESC("\033[?1")) {
				wts.appcursor = *buf == 'h';
				goto eol;
			}
			if (CONSUMEESC("\033[?47")
			    || CONSUMEESC("\033[?1047")) {
				wts.altscren = *buf=='h';
				fdb_apnd(rout, *buf == 'h' ? "\\s2" : "\\s1", -1);
				goto eol;
			}
			if (CONSUMEESC("\033[?1049")) {
				wts.altscren = *buf=='h';
				/* on: save cursor+state, set alternate screen,
				 * clear
				 * off: set primary screen, restore
				 * cursor+state
				 */
				fdb_apnd(rout, *buf == 'h' ? "\\ss\\s2\\cl"
							   : "\\s1\\rs",
					 -1);
				goto eol;
			}

			if (wts.escsz > 1 && wts.escbuf[1] == '[') {
				wts.escsz = 0;
				goto eol;
			}
		}
		if (buf[0] == '\033' || wts.escsz) {
			if (buf[0] == '\033') wts.escsz = 0;
			TMpoke(wts.escbuf, wts.escsz, *buf);
			wts.escsz++;
			goto eol;
		}

		if (*buf == 7) goto eol;
		if (wts.altscren) goto eol;

		if (*buf == '\n') TMlinepos(wts.linesz);

		if (wts.linesz == wts.linepos) TMlineresize(wts.linepos+1);
		TMpoke(wts.linebuf, wts.linepos, *buf);
		TMlinepos(wts.linepos+1);

		if (*buf != '\n' && wts.linesz < sizeof(wts.linebuf)) goto eol;

		if (wts.writelg)
			full_write(&wts.logde, wts.linebuf, wts.linesz);
		TMlineresize(0);

	eol:
		deletechrahead();

		routesca(rout, *buf++);
		len--;
	}

	fdb_apnd(rout, "\n", 1);
}

static void recountttl(struct wrides *de)
{
	struct fdbuf b = {.de = de};

	fdb_apnd(&b, "\\@title:", -1);
	fdb_apnd(&b, wts.ttl, ttllen());
	fdb_apnd(&b, "\n", -1);
	fdb_finsh(&b);
}

int extractqueryarg(const char *pref, char **dest)
{
	size_t preflen;
	const char *end;
	char *dscur;
	int byte, bcnt;

	preflen = strlen(pref);
	if (strncmp(qs, pref, preflen)) return 0;
	qs += preflen;

	end = strchrnul(qs, '&');

	free(*dest);
	dscur = *dest = malloc(end - qs + 1);

	while (qs != end) {
		byte = *qs++;

		if (byte == '%') {
			bcnt = 0;
			if (sscanf(qs, "%2x%n", &byte, &bcnt) && bcnt == 2)
				qs += 2;
		}

		*dscur++ = byte;
	}
	*dscur = 0;

	return 1;
}

int dtach_logging(void) { return !!dtachlog; }

static void processquerystr(const char *fullqs)
{
	if (!fullqs) return;
	qs = fullqs;

	while (1) {
		if (*qs == '&') qs++;
		if (!*qs) break;

		if (extractqueryarg("termid=", &termid)) continue;
		if (extractqueryarg("logview=", &logview)) continue;
		if (extractqueryarg("sblvl=", &sblvl)) continue;
		if (extractqueryarg("dtachlog=", &dtachlog)) continue;

		fprintf(stderr,
			"invalid query string arg at char pos %zu in '%s'\n",
			qs - fullqs, fullqs);

		qs = strchrnul(qs, '&');
	}
}

static char **srvargv;

static void cdhome(void)
{
	const char *home;

	home = getenv("HOME");

	if (!home) warnx("HOME is not set");
	else if (-1 == chdir(home)) warn("chdir to home: '%s'", home);
}

void _Noreturn subproc_main(void)
{
	const char *shell;

	if (srvargv) {
		execv(srvargv[0], srvargv);
		err(1, "execv server");
	}

	shell = getenv("SHELL");
	if (!shell) {
		shell = "/bin/sh";
		warnx("$SHELL is not set, defaulting to %s", shell);
	}

	setenv("TERM", "xterm-256color", 1);

	execl(shell, shell, NULL);
	err(1, "execl $SHELL, which is: %s", shell ? shell : "<undef>");
}

static const char *socksdir(void)
{
	static char *sd;
	if (sd) return sd;

	xasprintf(&sd, "%s/socks", state_dir());
	if (mkdir(sd, 0700) && errno != EEXIST) err(1, "cannot create %s", sd);

	return sd;
}

static void appenddir(char **p, int nmb)
{
	char *ch;

	xasprintf(&ch, "%s/%02d", *p, nmb);
	free(*p);
	*p = ch;
	if (mkdir(*p, 0700) && errno != EEXIST) err(1, "cannot create %s", *p);
}

static int opnforlog(const struct tm *tim, const char *suff)
{
	int fd;
	char *dir, *fn;

	dir = strdup(state_dir());
	appenddir(&dir, tim->tm_year+1900);
	appenddir(&dir, tim->tm_mon+1);
	appenddir(&dir, tim->tm_mday);

	xasprintf(&fn, "%s/%s%s", dir, termid, suff);
	free(dir);

	fd = open(fn, O_WRONLY | O_CREAT | O_APPEND, 0600);
	if (fd < 0) {
		warn("open %s", fn);
		fd = 0;
	}
	free(fn);
	return fd;
}

void maybe_open_logs(void)
{
	time_t now;
	struct tm tim;

	/* Do not save scrollbacks for ephemeral terminals, as these are
	 * used for grepping scrollback logs, so they can be very large
	 * and included redundant data that will be confusing to see in
	 * some recursive analysis of scrollbacks. */
	if (is_ephem()) return;

	now = time(NULL);
	if (!localtime_r(&now, &tim)) err(1, "cannot get time");

	/* sblvl configures scrollback logging. If the string has "p" then plain
	 * logging is on, if "r" then raw logging is on. */
	if (!sblvl) sblvl = strdup("p");

	if (strchr(sblvl, 'p')) {
		wts.writelg = 1;
		wts.logde.fd = opnforlog(&tim, "");
	}
	if (strchr(sblvl, 'r')) {
		wts.writerawlg = 1;
		wts.rawlogde.fd = opnforlog(&tim, ".raw");
	}
}

/* This is needed for a predictable string to use in the socket name, or a
 * human-identifiable placeholder. A percent is used in this string to spearate
 * the profile name from the prefix since % is not allowed in profile names. */
static const char *maybetermid(void)
{
	static char *pcpid;

	if (pcpid) return pcpid;

	if (termid)	xasprintf(&pcpid, "prs%%%s", termid);
	else		xasprintf(&pcpid, "eph%%%lld", (long long) getpid());

	return pcpid;
}

static void prepfordtach(void)
{
	char *dtlogfn = 0;
	int lgfd = -1, ok;

	if (dtach_sock) errx(1, "dtach_sock already set: %s", dtach_sock);
	xasprintf(&dtach_sock, "%s/%s", socksdir(), maybetermid());

	if (!dtachlog) return;

	ok = 0;
	xasprintf(&dtlogfn, "/tmp/dtachlog.%lld", (long long) getpid());
	if (0 > (lgfd = open(dtlogfn, O_WRONLY | O_CREAT | O_APPEND, 0600)))
		perror("open");
	else if (0 > dup2(lgfd, 2))
		perror("dup2");
	else ok = 1;

	fprintf(stderr, "opened %s for dtach logging? %d\n", dtlogfn, ok);
	if (lgfd > 0) close(lgfd);
	free(dtlogfn);
}

struct iterprofspec {
	/* where to send any non-log, non-diagnostic output. */
	struct wrides *sigde;

	/* (internal) buffer used for writing to sigde. */
	struct fdbuf *sigb;

	/* output new sessionm link for each profile to sigfd */
	unsigned newsessin	: 1;

	unsigned sendauxjs	: 1;  /* send auxiliary js list to sigfd */
	unsigned sendpream	: 1;  /* send preamble for termid to sigfd */

	/* diagnostic logging, not used during tests as it is not deterministic.
	 * Always sent to stderr
	 */
	unsigned diaglog	: 1;

	/* whether to annotate and escape output sent to sigfd, in order to make
	 * it more human-readable and separate from other output going to the
	 * same stream. */
	unsigned annotsig	: 1;
};

/* Transfers the prior recbyts bytes from srcf, measured from one byte before
 * the current seek position of srcf, to dstfd. Returns with the seek position
 * of srcf in the same position as when called. */
static void recallfiletofd(FILE *srcf, int recbyts, struct fdbuf *dstfd)
{
	char c;

	if (fseek(srcf, -1-recbyts, SEEK_CUR) < 0)
		err(1, "fseek by -%d", 1+recbyts);

	clearerr(srcf);
	while (recbyts--) {
		c = getc(srcf);
		if (ferror(srcf)) err(1, "transferring byte");
		fdb_apnd(dstfd, &c, 1);
	}

	if (getc(srcf) == EOF) err(1, "ignoring last byte");
}

static void newsessinhtml(struct iterprofspec *spc, char k, const char *nmarg)
{
	const char *litext = nmarg, *litrid = nmarg;

	if (!spc->newsessin) return;

	switch (k) {
	case 's':	/* start of profile group */
		fdb_apnd(spc->sigb, "<ul id=\"ctl-", -1);
		fdb_apnd(spc->sigb, nmarg, -1);
		fdb_apnd(spc->sigb, "\" class=\"newsessin-list\">", -1);
	break;
	case 'b':	/* automatic basic item, which has empty terminal ID */
		litext = "<em>basic</em>";
		litrid = "";
	case 'i':	/* profile item */
		fdb_apnd(spc->sigb,
			 "<li><a class=\"newsessin-link\" href=\"/?termid=",
			 -1);
		fdb_apnd(spc->sigb, litrid, -1);
		fdb_apnd(spc->sigb, "\">", -1);
		fdb_apnd(spc->sigb, litext, -1);
		fdb_apnd(spc->sigb, "</a>", -1);
	break;
	case 'e':	/* end of profile group */
		fdb_apnd(spc->sigb, "</ul>\n", -1);
	break;
	default: abort();
	}
}

static int proflines(const char *grpname, FILE *pff, struct iterprofspec *spc)
{
	const char *cmpname;
	int lineno = 0, namematc = 0, namerr = 0;

	char fld, eofield, namemat, err = 0, startedjs;
	char begunprenam, c;
	struct fdbuf nmbuf = {0};

	newsessinhtml(spc, 's', grpname);

	c = '\n';
	do {
		if (c == '\n') {
			cmpname = is_ephem() ? "" : termid;

			namemat = 0;
			fld = 'n';
			startedjs = 0;
			begunprenam = 0;
			nmbuf.len = 0;
			namerr = 0;
			lineno++;
		}

		clearerr(pff);
		c = getc(pff);
		if (c == EOF && ferror(pff)) {
			perror("getc for profile def file");
			break;
		}
		eofield = c == '\n' || c == EOF || c == '\t';

		switch (fld) {
		/* n = name field, p = preamble, j = auxjs list */
		case 'n':
			if (eofield) {
				namemat = cmpname &&
					(!*cmpname || '.' == *cmpname);
				namematc += namemat;
				fld = 'p';

				if (spc->newsessin && !namerr && nmbuf.len) {
					fdb_apnd(&nmbuf, "", 1);
					newsessinhtml(spc, 'i', nmbuf.bf);
				}
				break;
			}
			switch (c) {
			case '.': case '&': case '?': case '+': case '%':
			case ' ': case '=': case '/': case '\\': case '"':
				fprintf(stderr,
					"illegal char '%c' in profile name", c);
				err = 1;
				namerr = 1;
				cmpname = NULL;
			}
			if (cmpname && *cmpname++ != c) cmpname = NULL;
			fdb_apnd(&nmbuf, &c, 1);

			break;
		case 'p':
			if (eofield) {
				fld = 'j';
				if (begunprenam) fdb_apnd(spc->sigb, "\n", -1);
				break;
			}
			if (namemat && spc->sendpream) {
				fdb_apnd(spc->sigb, &c, 1);
				begunprenam = 1;
			}

			break;

		case 'j':
			if (eofield) {
				if (startedjs) fdb_apnd(spc->sigb, "\n", -1);
				break;
			}
			if (namemat && spc->sendauxjs) {
				if (!startedjs)
					fdb_apnd(spc->sigb, "\\@auxjs:", -1);
				startedjs = 1;
				fdb_apnd(spc->sigb, &c, 1);
			}

			break;

		default: errx(1, "BUG unexpected field type %d", fld);
		}

		if (err) {
			fprintf(stderr, " group=%s line=%d\n",
				grpname, lineno);
			err = 0;
		}
	} while (c != EOF);

	newsessinhtml(spc, 'e', 0);

	fdb_finsh(&nmbuf);

	return namematc;
}

static void iterprofs(const char *ppaths_, struct iterprofspec *spc)
{
	DIR *pd;
	char *ppaths = strdup(ppaths_), *tkn, *savepp, *ppitr, *ffn;

	struct dirent *den;
	FILE *pff;
	int namematc = 0;
	struct fdbuf sigbuf = {spc->sigde};
	spc->sigb = &sigbuf;

	/* "--" prefix to sort this category first. This hack can be removed
	 * once the sorting logic is moved out of shell. */
	newsessinhtml(spc, 's', "--basic");
	newsessinhtml(spc, 'b', 0);
	newsessinhtml(spc, 'e', 0);

	for (ppitr = ppaths; ; ppitr = NULL) {
		if (!(tkn = strtok_r(ppitr, ":", &savepp))) break;
		fprintf(stderr, "reading profile dir at: %s\n", tkn);

		pd = opendir(tkn);
		if (!pd) {
			perror("opendir");
			continue;
		}

		for (;;) {
			errno = 0;
			den = readdir(pd);
			if (!den) {
				if (errno) perror("readdir");
				break;
			}

			xasprintf(&ffn, "%s/%s", tkn, den->d_name);

			if (den->d_name[0] == '.') {
				if (spc->diaglog)
					fprintf(stderr,
						"  skipped file '%s'\n",
						den->d_name);
				goto doneproffile;
			}

			if (spc->diaglog)
				fprintf(stderr, "  group %s\n", den->d_name);

			pff = fopen(ffn, "r");
			if (!pff) {
				perror("fopen");
				goto doneproffile;
			}

			namematc += proflines(den->d_name, pff, spc);

doneproffile:
			free(ffn);
			ffn = NULL;
		}

		closedir(pd);
	}

	free(ppaths);

	fdb_finsh(&sigbuf);
	spc->sigb = 0;

	if (namematc || !termid || !*termid) return;

	if (spc->sendauxjs || spc->sendpream)
		fprintf(stderr, "profile with name '%s' not found\n", termid);
}

static const char *profpathsavd;

static const char *profpath(void)
{
	const char *p = profpathsavd;
	char *def;

	if (!p) p = getenv("WERMPROFPATH");
	if (!p) {
		xasprintf(&def, "%s/profiles:%s/.config/werm/profiles",
			  getenv("WERMSRCDIR"), getenv("HOME"));
		p = def;
	}

	return profpathsavd=p;
}

void recount_state(struct wrides *de)
{
	full_write(de, wts.altscren ? "\\s2" : "\\s1", -1);
	if (wts.ttl[0]) recountttl(de);

	iterprofs(profpath(), &((struct iterprofspec){
		.sigde = de,
		.sendauxjs = 1,
		.diaglog = 1,
	}));
}

void send_pream(int fd)
{
	struct wrides de = { fd };

	if (logview) {
		full_write(&de, ". $WERMSRCDIR/util/logview ", -1);
		full_write(&de, logview, -1);
		full_write(&de, "\r", -1);
		return;
	}

	iterprofs(profpath(), &((struct iterprofspec){
		.sigde = &de,
		.sendpream = 1,
		.diaglog = 1,
	}));
}

static void writetosubproccore(
	/* Where to send output for the process; this is raw keyboard input. */
	struct wrides *procde,

	/* Where to send output for attached client. */
	struct wrides *clioutde,

	/* Data received from client which is the escaped keyboard input. */
	const unsigned char *buf,
	unsigned bufsz)
{
	unsigned wi, ri, row, col;
	unsigned char byte, cursmvbyte;
	struct fdbuf kbdb = {procde};

	wts.sendsigwin = 0;

	wi = 0;
	while (bufsz--) {
		byte = *buf++;

		switch (wts.escp) {
		case 0:
			if (byte == '\n') continue;

			if (byte == '\\')
				wts.escp = '1';
			else
				fdb_apnd(&kbdb, &byte, 1);
			break;

		case '1':
			cursmvbyte = 0;
			wts.escp = 0;

			switch (byte) {
			case 'n':
				fdb_apnd(&kbdb, "\n", -1);
				break;

			case '\\':
				fdb_apnd(&kbdb, "\\", -1);
				break;

			case 'w':
			case 't':
				wts.altbufsz = 0;
				wts.escp = byte;
				break;

			case 'd':
				dump();
				break;

			/* no-op escape used for alerting master that it's OK to read
			 * from subproc. */
			case 'N':	break;

			/* directions, home, end */
			case '^':	cursmvbyte = 'A'; break;
			case 'v':	cursmvbyte = 'B'; break;
			case '>':	cursmvbyte = 'C'; break;
			case '<':	cursmvbyte = 'D'; break;
			case 'e':	cursmvbyte = 'F'; break;
			case 'h':	cursmvbyte = 'H'; break;

			default:
				warnx("unknown escape: %d\n", byte);
			}

			if (!cursmvbyte) break;
			fdb_apnd(&kbdb, "\033", 1);
			/* application cursor mode does O rather than [ */
			fdb_apnd(&kbdb, wts.appcursor ? "O" : "[", -1);
			fdb_apnd(&kbdb, &cursmvbyte, 1);
			break;

		case 'w':
			wts.winsize[wts.altbufsz++] = byte;
			if (wts.altbufsz != sizeof(wts.winsize)) break;

			wts.sendsigwin = (
				2 == sscanf(wts.winsize, "%4hu%4hu",
					    &wts.swrow, &wts.swcol));
			if (!wts.sendsigwin)
				warn("invalid winsize: %.8s", wts.winsize);
			wts.escp = 0;

			break;

		case 't':
			if (byte == '\n') {
				wts.escp = 0;
				byte = 0;
			}
			if (wts.altbufsz < sizeof wts.ttl)
				wts.ttl[wts.altbufsz++] = byte;
			if (!byte) recountttl(clioutde);

			break;

		default: errx(1, "unknown escape: %d", wts.escp);
		}
	}

	fdb_finsh(&kbdb);
}

void forward_stdin(int sock)
{
	struct wrides de = { sock };

	ssize_t red;
	unsigned char buf[512];

	red = read(0, buf, sizeof(buf));
	if (!red) errx(1, "nothing on stdin");
	if (red == -1) err(1, "read from stdin");

	full_write(&de, buf, red);
}

void process_kbd(int ptyfd, int clioutfd, unsigned char *buf, size_t bufsz)
{
	struct wrides ptyde = { ptyfd }, clide = { clioutfd };

	struct winsize ws = {0};

	writetosubproccore(&ptyde, &clide, buf, bufsz);

	if (!wts.sendsigwin) return;

	ws.ws_row = wts.swrow;
	ws.ws_col = wts.swcol;
	if (0 > ioctl(ptyfd, TIOCSWINSZ, &ws)) warn("setting window size");
}

static struct fdbuf tsrout = {};

static void putrwout(void)
{
	struct wrides de = {1, "putrwout"};
	full_write(&de, tsrout.bf, tsrout.len);
	tsrout.len = 0;
}

static void testreset(void)
{
	memset(&wts, 0, sizeof(wts));

	tsrout.len = 0;

	free(termid);	termid = 0;
	free(logview);	logview = 0;
	free(sblvl);	sblvl = 0;

	profpathsavd = "";
}

static void writetosp0term(const char *s)
{
	struct wrides pty = {1, "pty"}, cli = {1, "cli"};

	size_t len;

	len = strlen(s);

	writetosubproccore(&pty, &cli, (const unsigned char *)s, len);

	if (wts.sendsigwin)
		printf("sigwin r=%d c=%d\n", wts.swrow, wts.swcol);
}

static void tstdesc(const char *d) { printf("TEST: %s\n", d); }

static void testqrystring(void)
{
	tstdesc("parse termid arg");
	testreset();
	processquerystr("termid=hello");
	printf("%s\n", termid);

	tstdesc("unrecognized query string arg");
	testreset();
	processquerystr("logview=test&huhtest=987");
	printf("logview=%s\n", logview);

	tstdesc("empty arg, escapes, and omitted arg");
	testreset();
	processquerystr("sblvl=&termid=%21escapes%7eand%45");
	printf("%zu,%s,%d\n", strlen(sblvl), termid, !logview);
}

static void testiterprofs(void)
{
	struct wrides sigde = {1, "profsig"};

	tstdesc("empty WERMPROFPATH");
	testreset();

	iterprofs("", &((struct iterprofspec){ 0 }));

	tstdesc("non-existent and empty dirs in WERMPROFPATH");
	testreset();
	iterprofs(
		"test/profilesnoent::test/profiles1",
		&((struct iterprofspec){ 0 }));

	tstdesc("match js and print");
	testreset();
	termid = strdup("hasstuff");
	iterprofs("test/profiles1", &((struct iterprofspec) {
		&sigde,
		.sendauxjs = 1,
	}));

	tstdesc("name error but matches other line to print auxjs");
	testreset();
	termid = strdup("bad.name");
	iterprofs("test/profiles2", &((struct iterprofspec) {
		&sigde,
		.sendauxjs = 1,
	}));

	tstdesc("name error no match");
	testreset();
	termid = strdup("xyz");
	iterprofs("test/profiles2", &((struct iterprofspec) {
		&sigde,
		.sendauxjs = 1,
	}));

	tstdesc("name error but matches other line to print preamble");
	testreset();
	termid = strdup("bad");
	iterprofs("test/profiles2", &((struct iterprofspec) {
		&sigde,
		.sendpream = 1,
	}));

	tstdesc("empty preamble for match 1");
	testreset();
	termid = strdup("allempty");
	iterprofs("test/profiles1", &((struct iterprofspec) {
		&sigde,
		.sendpream = 1,
	}));

	tstdesc("empty preamble for match 2");
	testreset();
	termid = strdup("emptypream");
	iterprofs("test/profiles1", &((struct iterprofspec) {
		&sigde,
		.sendpream = 1,
	}));

	tstdesc("empty preamble for match 3");
	testreset();
	termid = strdup("emptypreamjs");
	iterprofs("test/profiles1", &((struct iterprofspec) {
		&sigde,
		.sendpream = 1,
	}));

	tstdesc("long preamble 1");
	testreset();
	termid = strdup("longpream1");
	iterprofs("test/profiles1", &((struct iterprofspec) {
		&sigde,
		.sendpream = 1,
	}));

	tstdesc("long preamble 2");
	testreset();
	termid = strdup("longpream2");
	iterprofs("test/profiles1", &((struct iterprofspec) {
		&sigde,
		.sendpream = 1,
	}));

	tstdesc("empty js for match 1");
	testreset();
	termid = strdup("emptypreamjs");
	iterprofs("test/profiles1", &((struct iterprofspec) {
		&sigde,
		.sendauxjs = 1,
	}));

	tstdesc("empty js for match 2");
	testreset();
	termid = strdup("allempty");
	iterprofs("test/profiles1", &((struct iterprofspec) {
		&sigde,
		.sendauxjs = 1,
	}));

	tstdesc("empty js for match 3");
	testreset();
	termid = strdup("emptyjs1");
	iterprofs("test/profiles1", &((struct iterprofspec) {
		&sigde,
		.sendauxjs = 1,
	}));

	tstdesc("empty js for match 4");
	testreset();
	termid = strdup("emptyjs2");
	iterprofs("test/profiles1", &((struct iterprofspec) {
		&sigde,
		.sendauxjs = 1,
	}));

	tstdesc("url-encoding-related chars not allowed in termid");
	testreset();
	iterprofs("test/profiles3", &((struct iterprofspec) {
		&sigde,
	}));

	tstdesc("bad names while outputting new session list");
	testreset();
	iterprofs("test/profiles3", &((struct iterprofspec) {
		&sigde,
		.newsessin = 1,
	}));

	tstdesc("dump newsessin list");
	testreset();
	iterprofs("test/profilesname", &((struct iterprofspec) {
		&sigde,
		.newsessin = 1,
	}));

	tstdesc("empty profile name");
	testreset();
	iterprofs("test/emptyprof", &((struct iterprofspec) {
		&sigde,
		.newsessin = 1,
	}));
	termid = strdup("");
	iterprofs("test/emptyprof", &((struct iterprofspec) {
		&sigde,
		.sendpream = 1,
	}));
	iterprofs("test/emptyprof", &((struct iterprofspec) {
		&sigde,
		.sendauxjs = 1,
	}));

	tstdesc("ephemeral session uses basic profile config");
	testreset();
	iterprofs("test/emptyprof", &((struct iterprofspec) {
		&sigde,
		.sendpream = 1,
		.sendauxjs = 1,
	}));
}

static void recountstate4test(void)
{
	recount_state(&((struct wrides){ 1, "recount_state" }));
}

static void writelgon(void)
{
	wts.logde.fd = 1;
	wts.writelg = 1;
	wts.logde.escannot = "sblog";
}

static void _Noreturn testmain(void)
{
	int i;
	struct wrides routde = {1, "rout"};

	tstdesc("WRITE_TO_SUBPROC_CORE");

	tstdesc("should ignore newline:");
	testreset();
	writetosp0term("hello\n how are you\n");

	tstdesc("empty string:");
	testreset();
	writetosp0term("");

	tstdesc("no-op escape \\N:");
	testreset();
	writetosp0term("\\N");

	tstdesc("change window size after \\N:");
	testreset();
	writetosp0term("\\N\\w00990011");

	tstdesc("missing newline:");
	testreset();
	writetosp0term("asdf");

	tstdesc("sending sigwinch:");
	testreset();
	writetosp0term("about to resize...\\w00910042...all done");

	tstdesc("escape seqs:");
	testreset();
	writetosp0term("line one\\nline two\\nline 3 \\\\ (reverse solidus)\\n\n");

	tstdesc("escape seqs straddling:");
	testreset();

	writetosp0term("line one\\nline two\\");

	writetosp0term("nline 3 \\");

	writetosp0term("\\ (reverse solidus)\\n\\w012");

	writetosp0term("00140");

	tstdesc("TEE_TTY_CONTENT");

	testreset();
	writelgon();
	process_tty_out(&tsrout, "hello", -1);
	tstdesc("pending line");
	process_tty_out(&tsrout, "\r\n", -1);
	tstdesc("finished line");

	do {
		int i = 0;
		while (i++ < sizeof(wts.linebuf)) process_tty_out(&tsrout, "x", -1);
		process_tty_out(&tsrout, "[exceeded]", -1);
		process_tty_out(&tsrout, "\r\n", -1);
	} while (0);

	process_tty_out(&tsrout, "abcdef\b\033[K\b\033[K\b\033[Kxyz\r\n", -1);
	process_tty_out(&tsrout, "abcdef\b\r\n", -1);

	tstdesc("move back x2 and delete to eol");
	process_tty_out(&tsrout, "abcdef\b\b\033[K\r\n", -1);

	tstdesc("move back x1 and insert");
	process_tty_out(&tsrout, "asdf\bxy\r\n", -1);

	tstdesc("move back and forward");
	process_tty_out(&tsrout, "asdf\b\033[C\r\n", -1);

	tstdesc("move back x2 and forward x1, then del to EOL");
	process_tty_out(&tsrout, "asdf\b\b" "\033[C" "\033[K" "\r\n", -1);

	tstdesc("as above, but in separate calls");
	process_tty_out(&tsrout, "asdf\b\b", -1);
	process_tty_out(&tsrout, "\033[C", -1);
	process_tty_out(&tsrout, "\033[K", -1);
	process_tty_out(&tsrout, "\r\n", -1);

	tstdesc("move left x3, move right x2, del EOL; 'right' seq in sep calls");
	process_tty_out(&tsrout, "123 UIO\b\b\b" "\033[", -1);
	process_tty_out(&tsrout, "C" "\033", -1);
	process_tty_out(&tsrout, "[C", -1);
	process_tty_out(&tsrout, "\033[K", -1);
	process_tty_out(&tsrout, "\r\n", -1);

	tstdesc("drop console title escape seq");
	/* https://tldp.org/HOWTO/Xterm-Title-3.html */
	process_tty_out(&tsrout, "abc\033]0;title\007xyz\r\n", -1);
	process_tty_out(&tsrout, "abc\033]1;title\007xyz\r\n", -1);
	process_tty_out(&tsrout, "123\033]2;title\007" "456\r\n", -1);

	tstdesc("drop console title escape seq; separate calls");
	process_tty_out(&tsrout, "abc\033]0;ti", -1);
	process_tty_out(&tsrout, "tle\007xyz\r\n", -1);

	tstdesc("bracketed paste mode");
	/* https://github.com/pexpect/pexpect/issues/669 */

	/* \r after paste mode off */
	process_tty_out(&tsrout, "before (", -1);
	process_tty_out(&tsrout, "\033[?2004l\rhello\033[?2004h", -1);
	process_tty_out(&tsrout, ") after\r\n", -1);

	/* no \r after paste mode off */
	process_tty_out(&tsrout, "before (", -1);
	process_tty_out(&tsrout, "\033[?2004lhello\033[?2004h", -1);
	process_tty_out(&tsrout, ") after\r\n", -1);

	tstdesc("drop color and font");
	process_tty_out(&tsrout, "before : ", -1);
	process_tty_out(&tsrout, "\033[1;35mafter\r\n", -1);

	/* split between calls */
	process_tty_out(&tsrout, "before : ", -1);
	process_tty_out(&tsrout, "\033[1;", -1);
	process_tty_out(&tsrout, "35mafter\r\n", -1);

	process_tty_out(&tsrout, "before : \033[36mAfter\r\n", -1);

	process_tty_out(&tsrout, "first ;; \033[1;31msecond\r\n", -1);

	tstdesc("\\r to move to start of line");
	process_tty_out(&tsrout, "xyz123\rXYZ\r\n", -1);

	tstdesc("something makes the logs stop");
	process_tty_out(&tsrout, 
		"\033[?2004h[0]~$ l\b"
		"\033[Kseq 1 | less\r"
		"\n\033[?2004l\r\033[?104"
		"9h\033[22;0;0t\033[?1h"
		"\033=\r1\r\n\033[7m(END)\033"
		"[27m\033[K\r\033[K\033[?1l"
		"\033>\033[?1049l\033[23;0"
		";0t\033[?2004h[0]~$"
		" # asdf\r\n\033[?2004"
		"l\r\033[?2004h[0]~$ "
		, -1
	);

	tstdesc("\\r then delete line");
	process_tty_out(&tsrout, "abc\r\033[Kfoo\r\n", -1);

	tstdesc("arrow keys are translated to escape sequences");
	testreset();
	writelgon();

	tstdesc("app cursor off: up,down,right,left=ESC [ A,B,C,D");
	writetosp0term("left (\\< \\<)\r");
	writetosp0term("up down up (\\^ \\v \\^)\r");
	writetosp0term("right (\\>)\r");

	tstdesc("app cursor on: same codes as when off but O instead of [");
	process_tty_out(&tsrout, "\033[?1h", -1);
	writetosp0term("left (\\< \\<)\r");
	writetosp0term("up down up (\\^ \\v \\^)\r");
	writetosp0term("right (\\>)\r");

	tstdesc("bad input tolerance: terminate OS cmd without char 7");
	process_tty_out(&tsrout, "\033]0;foobar\rdon't hide me\r\n", -1);

	tstdesc("backward to negative linepos, then dump line to log");
	testreset();
	writelgon();
	process_tty_out(&tsrout, "\r\010\010\010x\n", -1);

	tstdesc("escape before sending to attached clients");
	testreset();
	process_tty_out(&tsrout, "abcd\r\n", -1);
	process_tty_out(&tsrout, "xyz\b\t\r\n", -1);
	putrwout();

	tstdesc("pass OS escape to client");
	testreset();
	process_tty_out(&tsrout, "\033]0;asdf\007xyz\r\n", -1);
	putrwout();

	tstdesc("simplify alternate mode signal");
	testreset();
	process_tty_out(&tsrout, "\033[?47h" "hello\r\n" "\033[?47l", -1);

	process_tty_out(&tsrout, "\033[", -1);
	process_tty_out(&tsrout, "?47h" "hello\r\n" "\033", -1);
	process_tty_out(&tsrout, "[?47l", -1);

	process_tty_out(&tsrout, "\033[?1047h" "hello\r\n" "\033[?1047l", -1);
	putrwout();

	tstdesc("regression");
	testreset();
	process_tty_out(&tsrout, "\033\133\077\062\060\060\064\150\033\135\060\073\155\141\164\166\157\162\145\100\160\145\156\147\165\151\156\072\040\176\007\033\133\060\061\073\063\062\155\155\141\164\166\157\162\145\100\160\145\156\147\165\151\156\033\133\060\060\155\072\033\133\060\061\073\063\064\155\176\033\133\060\060\155\044\040\015\033\133\113\033\135\060\073\155\141\164\166\157\162\145\100\160\145\156\147\165\151\156\072\040\176\007\033\133\060\061\073\063\062\155\155\141\164\166\157\162\145\100\160\145\156\147\165\151\156\033\133\060\060\155\072\033\133\060\061\073\063\064\155\176\033\133\060\060\155\044\040", -1);
	putrwout();

	tstdesc("passthrough escape \\033[1P from subproc to client");
	testreset();
	process_tty_out(&tsrout, "\033[1P", -1);
	putrwout();
	testreset();
	process_tty_out(&tsrout, "\033[4P", -1);
	putrwout();
	testreset();
	process_tty_out(&tsrout, "\033[5P", -1);
	putrwout();
	testreset();
	process_tty_out(&tsrout, "\033[16P", -1);
	putrwout();

	tstdesc("delete 5 characters ahead");
	testreset();
	writelgon();
	process_tty_out(&tsrout, "$ asdfasdfasdf # asdfasdfasdf\r\033[C\033[C\033[5P\r\n", -1);

	tstdesc("delete 12 characters ahead");
	testreset();
	writelgon();
	process_tty_out(&tsrout, "$ asdfasdfasdf # asdfasdfasdf\r\033[C\033[C\033[12P\r\n", -1);

	tstdesc("delete 16 characters ahead");
	testreset();
	writelgon();
	process_tty_out(&tsrout, "$ asdfasdfasdf # asdfasdfasdf\r\033[C\033[C\033[16P\r\n", -1);

	tstdesc("save rawout from before OS escape");
	testreset();
	process_tty_out(&tsrout, "abc\033]0;new-t", -1);
	putrwout();
	tstdesc("<between calls>");
	process_tty_out(&tsrout, "itle\007xyz\r\n", -1);
	putrwout();

	tstdesc("1049h/l code for switching to/from alternate screen + other ops");
	testreset();
	process_tty_out(&tsrout, "abc \033[?1049h", -1);
	process_tty_out(&tsrout, "-in-\033[?1049lout", -1);
	putrwout();

	tstdesc("dump of state");
	testreset();
	recountstate4test();
	process_tty_out(&tsrout, "\033[?47h", -1); putrwout();
	recountstate4test();
	recountstate4test();
	process_tty_out(&tsrout, "\033[?47l", -1); putrwout();
	recountstate4test();
	process_tty_out(&tsrout, "\033[?1049h", -1); putrwout();
	recountstate4test();
	process_tty_out(&tsrout, "\033[?1049l", -1); putrwout();
	recountstate4test();

	tstdesc("do not save bell character in plain text log");
	testreset();
	writelgon();
	process_tty_out(&tsrout, "ready...\007 D I N G!\r\n", -1);

	tstdesc("editing a long line");
	testreset();
	writelgon();
	writetosp0term("\\w00300104");
	process_tty_out(&tsrout, test_lineed_in, 0xf8);
	process_tty_out(&tsrout, "\n", -1);

	tstdesc("editing a long line in a narrower window");
	testreset();
	writelgon();
	writetosp0term("\\w00800061");
	process_tty_out(&tsrout, test_lineednar_in, -1);
	process_tty_out(&tsrout, "\n", -1);

	tstdesc("go up more rows than exist in the linebuf");
	testreset();
	writetosp0term("\\w00800060");
	process_tty_out(&tsrout, "\033[Axyz\r\n", -1);

	tstdesc("set long then shorter title");
	testreset();
	writetosp0term("\\tlongtitle\n");
	putrwout();
	writetosp0term("\\t1+1++1\n");
	putrwout();

	tstdesc("title in recounted state");
	testreset();
	writetosp0term("\\tsometitle\n");
	putrwout();
	recountstate4test();
	putrwout();

	tstdesc("... continued: unset title, respond with empty title");
	writetosp0term("thisisnormalkeybinput\\t\n");
	putrwout();
	printf("(should not include title here): ");
	recountstate4test();
	putrwout();

	tstdesc("title is too long");
	writelgon();
	process_tty_out(&tsrout, "this is plain terminal text", -1);
	writetosp0term("\\t");
	for (i = 0; i < sizeof(wts); i++) writetosp0term("abc");
	writetosp0term("\n");
	putrwout();
	/* line buffer should not be clobbered by overflowing ttl buffer. */
	process_tty_out(&tsrout, "\r\n", -1);
	printf("stored title length: %zu\n", strnlen(wts.ttl, sizeof wts.ttl));

	tstdesc("do not include altscreen content in scrollback log");
	writelgon();
	process_tty_out(&tsrout, "xyz\r\nabc\033[?1049h", -1);
	process_tty_out(&tsrout, "defg", -1);
	process_tty_out(&tsrout, "hijk\033[?1049lrest\r\n", -1);

	tstdesc("move to col");
	testreset();
	writelgon();
	process_tty_out(&tsrout, test_jumptocol_in, test_jumptocol_in_size);

	tstdesc("move to col 2");
	testreset();
	writelgon();
	process_tty_out(&tsrout, "asdf\033[2Gxyz\r\n", -1);

	tstdesc("shift rest of line then overwrite");
	testreset();
	writelgon();
	process_tty_out(&tsrout, "asdf 01234\r\033[4Pxyz\n", -1);

	tstdesc("shift remaining characters right");
	testreset();
	writelgon();
	process_tty_out(&tsrout, "asdf\r\033[10@xyz\n", -1);

	tstdesc("shift remaining characters right more");
	testreset();
	writelgon();
	/* 10000 is too large; it should be ignored */
	process_tty_out(&tsrout, "asdf\r\033[10000@xyz\r\n", -1);
	process_tty_out(&tsrout, "asdf\r\033[15@xyz\r\n", -1);
	process_tty_out(&tsrout, ":(..more\r:)\033[5@xyz\r\n", -1);
	process_tty_out(&tsrout, ":(..more\r:)\033[1@xyz\r\n", -1);

	/* Make sure we only copy the amount of characters needed. */
	for (i = 0; i < 100; i++) process_tty_out(&tsrout, "123456", -1);
	process_tty_out(&tsrout, "\r\033[552G", -1);
	process_tty_out(&tsrout, "\033[10@", -1);
	process_tty_out(&tsrout, "..more:)\r\n", -1);

	tstdesc("move more characters right than are in the line");
	process_tty_out(&tsrout, "abcd\r\033[1000@!!!!\r\n", -1);
	process_tty_out(&tsrout, "abcd\r\033[50@!!!!\r\n", -1); 

	tstdesc("make long line too big to fit into buffer");
	for (i = 0; i < sizeof(wts.linebuf) - 1; i++)
		process_tty_out(&tsrout, "*", -1);
	process_tty_out(&tsrout, "\r\033[32@!!!\r\n", -1);

	testiterprofs();
	testqrystring();
	test_outstreams();

	exit(0);
}

void set_argv0(char role)
{
	snprintf(argv0, argv0sz, "Wer%c.%s", role, maybetermid());
}

static void appendunqid(void)
{
	char *newtrid, *sfix;

	sfix = next_uniqid();
	xasprintf(&newtrid, "%s.%s", termid, sfix);
	free(termid);
	termid = newtrid;

	printf("\\@appendid:.%s\n", sfix);
	free(sfix);
}

int main(int argc, char **argv)
{
	errno = 0;
	if (setvbuf(stdout, 0, _IONBF, 0))
		err(1, "could not turn off stdout buffering");

	argv0 = argv[0];
	argv0sz = strlen(argv0)+1;
	memset(argv0, ' ', argv0sz-1);

	if (argc < 1) errx(1, "unexpected argc value: %d", argc);
	argc--;
	argv++;

	if (1 == argc && !strcmp("test", *argv)) testmain();
	if (1 == argc && !strcmp("newsessinlinks", *argv)) {
		iterprofs(profpath(), &((struct iterprofspec){
			.sigde = &((struct wrides){ 1 }),
			.newsessin = 1,
			.diaglog = 1,
		}));
		exit(0);
	}

	processquerystr(getenv("WERMFLAGS"));

	if (argc >= 1 && !strcmp("serve", *argv)) {
		iterprofs(profpath(), &((struct iterprofspec){ .diaglog = 1 }));

		srvargv = argv+1;
		termid = strdup("~spawner");
		appendunqid();
		prepfordtach();
		fprintf(stderr,
"--- WARNING ---\n"
"Saving scrollback logs under: %s\n"
"Clean this directory periodically to avoid overloading your filesystem.\n"
"All persistent sessions are saved here until you remove them. Be aware of\n"
"what you save here and how fast it grows.\n"
"\n"
"This inconvenience will eventually be automated.\n"
"\n"
"--- STARTING DAEMONIZED SPAWNER PROCESS ---\n"
"Access http://<host>/attach to get started\n"
"\n",
			state_dir());

		cdhome();

		/* Start reading from process immediately. Otherwise the server
		 * may timeout, as stdout/stderr will block indefinitely.
		 * A side-effect of setting this is that pream will be ignored,
		 * so if we decide to set it this must be refactored. */
		first_attach = 1;
		exit(dtach_master());
	}

	if (argc) {
		fprintf(stderr, "unrecognized arguments\n");
		exit(1);
	}

	processquerystr(getenv("QUERY_STRING"));

	/* Set by websocketd and not wanted. CGI-related cruft: */
	unsetenv("AUTH_TYPE");
	unsetenv("CONTENT_LENGTH");
	unsetenv("CONTENT_TYPE");
	unsetenv("GATEWAY_INTERFACE");
	unsetenv("HTTP_ACCEPT_ENCODING");
	unsetenv("HTTP_ACCEPT_LANGUAGE");
	unsetenv("HTTP_CACHE_CONTROL");
	unsetenv("HTTP_CONNECTION");
	unsetenv("HTTP_ORIGIN");
	unsetenv("HTTP_PRAGMA");
	unsetenv("HTTPS");
	unsetenv("HTTP_SEC_WEBSOCKET_EXTENSIONS");
	unsetenv("HTTP_SEC_WEBSOCKET_KEY");
	unsetenv("HTTP_SEC_WEBSOCKET_VERSION");
	unsetenv("HTTP_UPGRADE");
	unsetenv("HTTP_USER_AGENT");
	unsetenv("PATH_INFO");
	unsetenv("PATH_TRANSLATED");
	unsetenv("QUERY_STRING");
	unsetenv("REMOTE_ADDR");
	unsetenv("REMOTE_HOST");
	unsetenv("REMOTE_IDENT");
	unsetenv("REMOTE_PORT");
	unsetenv("REMOTE_USER");
	unsetenv("REQUEST_METHOD");
	unsetenv("REQUEST_URI");
	unsetenv("SCRIPT_NAME");
	unsetenv("SERVER_NAME");
	unsetenv("SERVER_PORT");
	unsetenv("SERVER_PROTOCOL");
	unsetenv("SERVER_SOFTWARE");
	unsetenv("UNIQUE_ID");

	if (termid && !strchr(termid, '.')) appendunqid();

	prepfordtach();
	dtach_main();
}
