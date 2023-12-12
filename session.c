/* Copyright 2023 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd */

#include "shared.h"
#include "outstreams.h"
#include "test/raw/data.h"
#include "wts.h"

#include <stdint.h>
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

static void TMpokettl(int toff, int b)
{
	if (toff >= 0 && toff < sizeof(wts.ttl)) wts.ttl[toff] = b;
}

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
		TMlinepos(cnt - 1);
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
		if (!wts.clnttl && *buf != '\n') {
			TMpokettl(wts.linesz-1,	*buf);
			TMpokettl(wts.linesz,	0);
		}

		if (*buf != '\n' && wts.linesz < sizeof(wts.linebuf)) goto eol;

		if (wts.writelg)
			full_write(&wts.logde, wts.linebuf, wts.linesz);
		TMlineresize(0);

	eol:
		deletechrahead();

		fdb_routc(rout, *buf++);
		len--;
	}

	fdb_apnc(rout, '\n');
}

static void recountttl(struct wrides *de)
{
	struct fdbuf b = {.de = de};

	fdb_apnd(&b, "\\@title:", -1);
	if (wts.clnttl) fdb_apnd(&b, wts.ttl, ttl_len());
	fdb_apnc(&b, '\n');
	fdb_finsh(&b);
}

static int extractqueryarg(const char *pref, char **dest)
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
	const char *sockenv;

	if (sd) return sd;

	sockenv = getenv("WERMSOCKSDIR");
	if (sockenv)
		sd = strdup(sockenv);
	else
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
};

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

static int proflines(
	const char *grpname, const char *prffn, struct iterprofspec *spc)
{
	const char *cmpname;
	int lineno = 0, namematc = 0, namerr = 0;

	char fld, eofield, namemat, err = 0, startedjs;
	char begunprenam, c;
	struct fdbuf nmbuf = {0};
	FILE *pff = fopen(prffn, "r");

	if (!pff) {
		perror("fopen for profile");
		fprintf(stderr, "prpath=%s group=%s\n", prffn, grpname);
		return 0;
	}

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
					fdb_apnc(&nmbuf, 0);
					newsessinhtml(spc, 'i', nmbuf.bf);
				}
				break;
			}
			switch (c) {
			case '.': case '&': case '?': case '+': case '%':
			case ' ': case '=': case '/': case '\\': case '"':
			case '<': case '>':
				fprintf(stderr,
					"illegal char '%c' in profile name", c);
				err = 1;
				namerr = 1;
				cmpname = NULL;
			}
			if (cmpname && *cmpname++ != c) cmpname = NULL;
			fdb_apnc(&nmbuf, c);

			break;
		case 'p':
			if (eofield) {
				fld = 'j';
				if (begunprenam) fdb_apnc(spc->sigb, '\n');
				break;
			}
			if (namemat && spc->sendpream) {
				fdb_apnc(spc->sigb, c);
				begunprenam = 1;
			}

			break;

		case 'j':
			if (eofield) {
				if (startedjs) fdb_apnc(spc->sigb, '\n');
				break;
			}
			if (namemat && spc->sendauxjs) {
				if (!startedjs)
					fdb_apnd(spc->sigb, "\\@auxjs:", -1);
				startedjs = 1;
				fdb_apnc(spc->sigb, c);
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
	fclose(pff);

	return namematc;
}

static void iterprofs(const char *ppaths_, struct iterprofspec *spc)
{
	DIR *pd;
	char *ppaths = strdup(ppaths_), *tkn, *savepp, *ppitr, *ffn = 0;

	struct dirent *den;
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

			free(ffn);
			xasprintf(&ffn, "%s/%s", tkn, den->d_name);

			if (den->d_name[0] == '.') {
				if (spc->diaglog)
					fprintf(stderr,
						"  skipped file '%s'\n",
						den->d_name);
				continue;
			}

			if (spc->diaglog)
				fprintf(stderr, "  group %s\n", den->d_name);

			namematc += proflines(den->d_name, ffn, spc);
		}

		closedir(pd);
	}

	free(ppaths);
	free(ffn);

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

static void recountstate(struct wrides *de)
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

/* Array with elements:
	0: print_atch_clis() array
	1: termid string
	2: title string */
static void atchstatejson(struct wrides *cliutd)
{
	struct fdbuf hbuf = {cliutd};

	fdb_apnc(&hbuf, '[');

	print_atch_clis(&hbuf);
	fdb_apnc(&hbuf, ',');
	fdb_json(&hbuf, termid ? termid : "", -1);
	fdb_apnc(&hbuf, ',');
	fdb_json(&hbuf, wts.ttl, ttl_len());

	fdb_apnd(&hbuf, "]\n", -1);
	fdb_finsh(&hbuf);
}

static void fwdlinetostdout(int fd)
{
	int rdn;
	char buf[512];

	for (;;) {
		rdn = read(fd, buf, sizeof(buf));

		if (rdn < 0) {
			if (errno == EINTR) continue;
			perror("read line from socket");
			break;
		}

		fwrite(buf, rdn, 1, stdout);
		if (buf[rdn-1] == '\n') break;
	}
}

static _Noreturn void atchsesnlist(void)
{
	DIR *skd;
	struct dirent *sken;
	char *spth = 0;
	int sc, firs = 1;

	if (!(skd = opendir(socksdir()))) {
		perror("opendir: socks");
		puts("error opening socks directory");
		exit(0);
	}

	putchar('[');
	for (;;) {
		errno = 0;
		sken = readdir(skd);
		if (!sken) {
			if (errno) perror("readdir: socks");
			break;
		}

		if (strncmp(sken->d_name, "prs%", 4) &&
		    strncmp(sken->d_name, "eph%", 4))
			continue;

		xasprintf(&spth, "%s/%s", socksdir(), sken->d_name);
		sc = connect_uds_as_client(spth);
		free(spth);
		if (sc < 0) continue;

		if (!firs) putchar(',');
		firs = 0;

		full_write(&(struct wrides){sc}, "\\A", -1);
		fwdlinetostdout(sc);
		close(sc);
	}

	putchar(']');

	closedir(skd);

	exit(0);
}

static void writetosubproccore(
	/* Where to send output for the process; this is raw keyboard input. */
	struct wrides *procde,

	/* Where to send output for attached client. */
	struct wrides *clioutde,

	struct clistate *cls,

	/* Data received from client which is the escaped keyboard input. */
	const unsigned char *buf,
	unsigned bufsz)
{
	unsigned wi;
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
				fdb_apnc(&kbdb, byte);
			break;

		case '1':
			cursmvbyte = 0;
			wts.escp = 0;

			switch (byte) {
			case 'n':
				fdb_apnc(&kbdb, '\n');
				break;

			case '\\':
				fdb_apnc(&kbdb, '\\');
				break;

			case 'w':
			case 't':
			case 'i':
				wts.altbufsz = 0;
				wts.escp = byte;
				break;

			case 'd':
				dump_wts();
				break;

			/* escape that alerts master we want to see terminal
			   output, and to alert master that it's OK to read
			   from subproc since there is a client ready to read
			   the output. */
			case 'N':
				cls->wantsoutput=1;
				recountstate(clioutde);
				break;

			case 'A':	atchstatejson(clioutde); break;

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
			fdb_apnc(&kbdb, 033);
			/* application cursor mode does O rather than [ */
			fdb_apnc(&kbdb, wts.appcursor ? 'O' : '[');
			fdb_apnc(&kbdb, cursmvbyte);
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
				wts.clnttl = !!wts.altbufsz;
			}
			TMpokettl(wts.altbufsz++, byte);
			if (!byte) recountttl(clioutde);

			break;

		case 'i':
			if (wts.altbufsz >= sizeof cls->endpnt) abort();

			cls->endpnt[wts.altbufsz] = byte;
			if (++wts.altbufsz == sizeof cls->endpnt) wts.escp = 0;

			break;

		default: errx(1, "unknown escape: %d", wts.escp);
		}
	}

	fdb_finsh(&kbdb);
}

void process_kbd(int ptyfd, int clioutfd, struct clistate *cls,
		 unsigned char *buf, size_t bufsz)
{
	struct wrides ptyde = { ptyfd }, clide = { clioutfd };

	struct winsize ws = {0};

	writetosubproccore(&ptyde, &clide, cls, buf, bufsz);

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

static struct clistate *testclistate(char op)
{
	static struct clistate *s;

	switch (op) {
	case 'g':
		if (!s) abort();
	break;
	case 'r':
		free(s);
		s = calloc(1, sizeof(*s));
	break;
	case 'i':
		full_write(&(struct wrides){1, "endpnt"},
			   s->endpnt, sizeof(s->endpnt));
	break;
	case 'o':
		printf("wantsoutput=%u\n", s->wantsoutput);
	break;

	default: abort();
	}

	return s;
}

static void testreset(void)
{
	memset(&wts, 0, sizeof(wts));

	tsrout.len = 0;

	free(termid);	termid = 0;
	free(logview);	logview = 0;
	free(sblvl);	sblvl = 0;

	profpathsavd = "";
	testclistate('r');
}

static void writetosp0term(const void *s)
{
	struct wrides pty = {1, "pty"}, cli = {1, "cli"};

	writetosubproccore(&pty, &cli, testclistate('g'), s, strlen(s));

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

static void writelgon(void)
{
	wts.logde.fd = 1;
	wts.writelg = 1;
	wts.logde.escannot = "sblog";
}

static void _Noreturn testmain(void)
{
	int i;

	tstdesc("WRITE_TO_SUBPROC_CORE");

	tstdesc("should ignore newline:");
	testreset();
	writetosp0term("hello\n how are you\n");

	tstdesc("empty string:");
	testreset();
	writetosp0term("");

	tstdesc("no-op escape \\N:");
	testreset();
	testclistate('o');
	writetosp0term("\\N");
	testclistate('o');

	tstdesc("change window size after \\N:");
	testreset();
	testclistate('o');
	writetosp0term("\\N\\w00990011");
	testclistate('o');

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
	writetosp0term("\\N");
	process_tty_out(&tsrout, "\033[?47h", -1); putrwout();
	writetosp0term("\\N");
	writetosp0term("\\N");
	process_tty_out(&tsrout, "\033[?47l", -1); putrwout();
	writetosp0term("\\N");
	process_tty_out(&tsrout, "\033[?1049h", -1); putrwout();
	writetosp0term("\\N");
	process_tty_out(&tsrout, "\033[?1049l", -1); putrwout();
	writetosp0term("\\N");

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
	writetosp0term("\\N");
	putrwout();

	tstdesc("... continued: unset title, respond with empty title");
	writetosp0term("thisisnormalkeybinput\\t\n");
	putrwout();
	printf("(should not include title here): ");
	writetosp0term("\\N");
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

	tstdesc("set endpoint ID");
	testreset();
	writetosp0term("\\iabcDEfgh");
	testclistate('i');
	writetosp0term("rest of text");
	testclistate('i');

	tstdesc("set endpoint ID two calls A");
	testreset();
	writetosp0term("\\i1bcDEfg");
	testclistate('i');
	writetosp0term("z");
	testclistate('i');
	writetosp0term("rest of text");
	testclistate('i');

	tstdesc("set endpoint ID two calls b");
	testreset();
	writetosp0term("\\i");
	testclistate('i');
	writetosp0term("z1bjkEfg--rest of test");
	testclistate('i');

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

	tstdesc("text from current line in \\A output");
	testreset();
	termid = strdup("statejsontest");
	process_tty_out(&tsrout, "foo!\r\nbar?", -1);
	writetosp0term("\\A");
	tstdesc("... text from prior line");
	process_tty_out(&tsrout, "\r\n\r\n", -1);
	writetosp0term("\\A");
	tstdesc("... override with client-set title");
	writetosp0term("\\tmy ttl 42\n");
	writetosp0term("\\A");
	process_tty_out(&tsrout, "another line\r\n", -1);
	writetosp0term("\\A");
	writetosp0term("\\t\n");
	writetosp0term("\\A");
	process_tty_out(&tsrout, "again, ttl from line\r\n", -1);
	writetosp0term("\\A");

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
	char *sfix;
	struct fdbuf buf = {0};

	sfix = next_uniqid();
	fdb_apnd(&buf, "\\@appendid:.", -1);
	fdb_apnd(&buf, sfix, -1);
	fdb_apnc(&buf, '\n');
	write_wbsoc_frame(buf.bf, buf.len);

	buf.len = 0;
	fdb_apnd(&buf, termid, -1);
	fdb_apnc(&buf, '.');
	fdb_apnd(&buf, sfix, 1 + strlen(sfix));

	/* Free old termid and take ownership of buffer. */
	free(termid);
	termid = (char *)buf.bf;

	free(sfix);
}

static void _Noreturn doshowenv(void)
{
	int syst;

	/* Let perror and other errors show in the page. */
	if (0 > dup2(1, 2)) printf("dup2 stderr to stdout error! %d\n", errno);

	if (0 > (syst=system("env")))
		perror("starting 'env'");
	else if (syst)
		printf("\n'env' exited with error: %d\n", WEXITSTATUS(syst));

	exit(0);
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

	if (1 == argc) {
		if (!strcmp("test",	*argv)) testmain();
		if (!strcmp("/showenv",	*argv)) doshowenv();
		if (!strcmp("/atchses",	*argv)) atchsesnlist();
		if (!strcmp("/newsess",	*argv)) {
			iterprofs(profpath(), &((struct iterprofspec){
				.sigde = &((struct wrides){ 1 }),
				.newsessin = 1,
				.diaglog = 1,
			}));
			exit(0);
		}
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
	unsetenv("QUERY_STRING");

	if (termid && !strchr(termid, '.')) appendunqid();

	/* TODO: validate termid against illegal characters */

	prepfordtach();
	dtach_main();
}
