/* Copyright 2023 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd */

#include "third_party/st/wcwidth.h"
#include "shared.h"
#include "font.h"
#include "outstreams.h"
#include "gen/data.h"
#include <md4c-html.h>
#include "wts.h"
#include "http.h"
#include "spawner.h"
#include "dtachctx.h"
#include "tm.c"
#include "third_party/st/plat.h"
#include "third_party/st/tmeng"

#include <sys/wait.h>
#include <libgen.h>
#include <sys/stat.h>
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

/* Terminal Machine (TM...) functions are implemented in both Javascript and C.
 * They consider arguments to be untrusted - memory access must be guarded.
 * This means out-of-bounds checking to prevent an uncaught exception in
 * Javascript, and avoiding illegal accesses or UB in C.
 *
 * Code that exists above the VM... layer should be syntax-neutral between C and
 * Javascript. IOW, code that calls it will be executed in Javascript on the
 * client and in C on the server.
 */

static void TMpokettl(int toff, int b)
{
	if (toff >= 0 && toff < sizeof(wts.ttl)) wts.ttl[toff] = b;
}

void Xsetcolor(int trm, int pi, int rgb) {/* no-op */}

/* No-ops because server is headless */
void Xicontitl(TMint deq, TMint off)					{}
void Xsettitle(TMint deq, TMint off)					{}
void Xbell(int trm)							{}
void Xsetpointermotion(int set)						{}
void Xdrawglyph(int trm, int gf, int x, int y)				{}
void Xosc52copy(TMint trm, TMint deq, TMint byti)			{}
void Xdrawrect(TMint clor, TMint x0, TMint y0, TMint w, TMint h)	{}
void Xdrawline(TMint trm, int x1, int y1, int x2)			{}
void Xfinishdraw(TMint trm)						{}
void Xximspot(TMint trm, int cx, int cy)				{}

void Now(int ms) { fld(ms,0) = 0; fld(ms,1) = 0; }

void Xprint(TMint deq)
{
	full_write(&(struct wrides){2,"Xprint"},	deqtostring(deq, 0),
							deqsiz(deq));
}

void Ttywriteraw(int trm, int dq, int of, int sz)
{
	fdb_routs(&therout, deqtostring(dq, of), sz);
}

struct fdbuf therout;
void process_tty_out(void *buf, ssize_t len)
{
	static int d;
	int sbbuf;

	if (len < 0) len = strlen(buf);

	if (wts.writerawlg) full_write(&wts.rawlogde, buf, len);

	if (!wts.t) {
		wts.t = term_new();
		tnew(wts.t, 80, 25);
		if (wts.writelg) term(wts.t,sbbuf) = deqmk();
	}
	d = deqsetutf8(d ? d:deqmk(), buf, len);
	twrite(wts.t, d, -1, 0);

	fdb_routs(&therout, buf, len);
	fdb_apnc(&therout, '\n');

	if (wts.writelg) {
		sbbuf = term(wts.t,sbbuf);
		if (deqsiz(sbbuf)) {
			full_write(&wts.logde,	deqtostring(sbbuf, 0),
						deqbytsiz(sbbuf));
			deqclear(sbbuf);
		}
	}
}

static void recounttitl(struct wrides *de)
{
	struct fdbuf b = {.de = de};

	fdb_apnd(&b, "\\@title:", -1);
	if (wts.clnttl) fdb_apnd(&b, wts.ttl, ttl_len());
	fdb_apnc(&b, '\n');
	fdb_finsh(&b);
}

static int parsequeryarg(const char *pref, char **dest)
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

#define ILLEGALTERMIDCHARS "&?+% =/\\\"<>"

static void checktid(void)
{
	char *tc;
	for (tc = termid; *tc; tc++) {
		if (strchr(ILLEGALTERMIDCHARS, *tc))
			exit_msg("e", "termid query arg illegal char: ", *tc);
	}
}

static void processquerystr(const char *fullqs)
{
	if (!fullqs) return;
	qs = fullqs;

	while (1) {
		if (*qs == '&') qs++;
		if (!*qs) break;

		if (parsequeryarg("termid=",	&termid		)) continue;
		if (parsequeryarg("logview=",	&logview	)) continue;
		if (parsequeryarg("sblvl=",	&sblvl		)) continue;
		if (parsequeryarg("dtachlog=",	&dtachlog	)) continue;

		fprintf(stderr,
			"invalid query string arg at char pos %zu in '%s'\n",
			qs - fullqs, fullqs);

		qs = strchrnul(qs, '&');
	}
}

static void cdhome(void)
{
	const char *home;

	home = getenv("HOME");

	if (!home) warnx("HOME is not set");
	else if (-1 == chdir(home)) warn("chdir to home: '%s'", home);
}

void _Noreturn subproc_main(Dtachctx dc)
{
	const char *shell;

	if (dc->spargs) { set_argv0(dc, 's'); spawner(dc->spargs); }

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

void open_logs(void)
{
	time_t now;
	struct tm tim;

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

static Dtachctx prepfordtach(void)
{
	Dtachctx dc = calloc(1, sizeof(*dc));
	char *dtlogfn = 0;
	int lgfd = -1, ok;
	struct fdbuf sp = {0};

	/* sp is a predictable string to use in the socket name or related
	   process names. A percent is used in this string to separate the
	   profile name from the prefix since % is not allowed in profile
	   names. */
	fdb_apnd(&sp, socksdir(), -1);
	if (termid)	{fdb_apnd(&sp, "/prs%", -1); fdb_apnd(&sp, termid, -1);}
	else		{fdb_apnd(&sp, "/eph%", -1); fdb_itoa(&sp, getpid());}
	fdb_apnc(&sp, 0);

	dc->sockpath = (char *) sp.bf;
	sp.bf = 0;
	fdb_finsh(&sp);

	dc->isephem = !termid;

	if (!dtachlog) return dc;

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

	return dc;
}

struct iterprofspec {
	/* where to send any non-log, non-diagnostic output. */
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

static void newsessinhtml(struct iterprofspec *spc, char k, const void *nmarg)
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
			cmpname = termid ? termid : "";

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

			if (strchr(ILLEGALTERMIDCHARS ".", c)) {
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

static void tmstate4cli(struct wrides *de)
{
	struct tmobj *o0, *o1;
	int *f0, *f1;
	struct fdbuf sigb = {de, .cap = 1024};

	if (!wts.t) return;

	fdb_apnd(&sigb, "\\@state:{\"bs\":[", -1);
	o0 = tmobjs.objel;
	o1 = tmobjs.objel+tmobjs.capac;
	for (;;) {
		if (o0==o1) break;
		if (o0!=tmobjs.objel) fdb_apnc(&sigb, ',');
		if (!o0->fs) { fdb_itoa(&sigb, o0->fct); goto nexo; }

		f0 = o0->fs;
		f1 = o0->fs + o0->fct;
		fdb_apnc(&sigb, '[');
		for (;;) {
			if (f0==f1) break;
			if (f0!=o0->fs) fdb_apnc(&sigb, ',');
			fdb_itoa(&sigb, *f0++);
		}
		fdb_apnc(&sigb, ']');

	nexo:
		o0++;
	}

	fdb_apnd(&sigb, "],\"fh\":", -1);
	fdb_itoa(&sigb, tmobjs.bufsfreehead);
	fdb_apnd(&sigb, ",\"t\":", -1);
	fdb_itoa(&sigb, wts.t);
	fdb_apnd(&sigb, "}\n", -1);

	fdb_finsh(&sigb);
}

static void simpdump4cl(struct wrides *de)
{
	struct fdbuf sigb = {de};
	if (!wts.t) return;
	fdb_apnd(&sigb, MODE_ALTSCREEN & term(wts.t,mode) ? "\\s2":"\\s1", -1);
	fdb_finsh(&sigb);
}

static void profinfo4cli(struct wrides *de)
{
	struct fdbuf sigb = {de};
	iterprofs(profpath(), &((struct iterprofspec){
		.sigb = &sigb,
		.sendauxjs = 1,
		.diaglog = 1,
	}));
	fdb_finsh(&sigb);
}

void send_pream(int fd)
{
	struct fdbuf ob = {&(struct wrides){fd}};

	if (logview) {
		fdb_apnd(&ob, ". $WERMSRCDIR/util/logview ", -1);
		fdb_apnd(&ob, logview, -1);
		fdb_apnd(&ob, "\r", -1);
	}
	else {
		iterprofs(profpath(), &((struct iterprofspec){
			.sigb = &ob,
			.sendpream = 1,
			.diaglog = 1,
		}));
	}

	fdb_finsh(&ob);
}

static void linetitl(struct fdbuf *o)
{
	int td = deqmk(), y = curs_y(term(wts.t,curs));

	for (;;) {
		td = tpushlinestr(wts.t, td, y);
		if (--y < 0 || deqbytsiz(td)) break;
	}
	fdb_json(o, deqtostring(td, 0), deqbytsiz(td));
	tmfree(td);
}

/* Array with elements:
	0: print_atch_clis() array
	1: termid string
	2: title string */
static void atchstatejson(Dtachctx dc, struct wrides *cliutd)
{
	struct fdbuf hbuf = {cliutd};

	fdb_apnc(&hbuf, '[');

	print_atch_clis(dc, &hbuf);
	fdb_apnc(&hbuf, ',');
	fdb_json(&hbuf, termid ? termid : "", -1);
	fdb_apnc(&hbuf, ',');
	if (wts.clnttl)	fdb_json(&hbuf, wts.ttl, ttl_len());
	else		linetitl(&hbuf);

	fdb_apnd(&hbuf, "]\n", -1);
	fdb_finsh(&hbuf);
}

static void fwdlinetobuf(int fd, struct fdbuf *ob)
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

		fdb_apnd(ob, buf, rdn);
		if (buf[rdn-1] == '\n') break;
	}
}

static void atchsesnlis(struct wrides *de)
{
	DIR *skd;
	struct dirent *sken;
	char *spth = 0;
	int sc, firs = 1;
	struct fdbuf rb = {0};

	if (!(skd = opendir(socksdir()))) {
		perror("opendir: socks");
		puts("error opening socks directory");
		exit(1);
	}

	fdb_apnc(&rb, '[');
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

		if (!firs) fdb_apnc(&rb, ',');
		firs = 0;

		full_write(&(struct wrides){sc}, "\\A", -1);
		fwdlinetobuf(sc, &rb);
		close(sc);
	}

	fdb_apnc(&rb, ']');
	resp_dynamc(de, 'j', 200, rb.bf, rb.len);
	fdb_finsh(&rb);

	closedir(skd);
}

static void writetosubproccore(
	/* Where to send output for the process; this is raw keyboard input. */
	struct wrides *procde,

	/* Where to send output for attached client. */
	struct wrides *clioutde,

	Dtachctx dc,
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
				/* TODO: dump tmeng state */
				dump_wts();
				break;

			/* escape that alerts master we want to see terminal
			   output, and to alert master that it's OK to read
			   from subproc since there is a client ready to read
			   the output. */
			case 'N':
				cls->wantsoutput=1;
				if (wts.ttl[0])		recounttitl(clioutde);
				if (wts.allowtmstate)	tmstate4cli(clioutde);
				else			simpdump4cl(clioutde);
				profinfo4cli(clioutde);
				break;

			case 'A': atchstatejson(dc, clioutde);		break;

			/* directions, home, end */
			case '^': cursmvbyte = 'A';			break;
			case 'v': cursmvbyte = 'B';			break;
			case '>': cursmvbyte = 'C';			break;
			case '<': cursmvbyte = 'D';			break;
			case 'e': cursmvbyte = 'F';			break;
			case 'h': cursmvbyte = 'H';			break;

			/* keep-alive */
			case '!': full_write(clioutde, "\\!\n", -1);	break;

			default:
				warnx("unknown escape: %d\n", byte);
			}

			if (!cursmvbyte) break;
			fdb_apnc(&kbdb, 033);
			/* application cursor mode does O rather than [ */
			fdb_apnc(&kbdb,	wts.t &&
					MODE_APPCURSOR & term(wts.t,mode)
					? 'O' : '[');
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
			if (!byte) recounttitl(clioutde);

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

	if (wts.t && wts.sendsigwin) tresize(wts.t, wts.swcol, wts.swrow);
}

void process_kbd(int clioutfd, Dtachctx dc, struct clistate *cls,
		 unsigned char *buf, size_t bufsz)
{
	struct wrides ptyde = { dc->the_pty.fd }, clide = { clioutfd };

	struct winsize ws = {0};

	writetosubproccore(&ptyde, &clide, dc, cls, buf, bufsz);

	if (!wts.sendsigwin) return;

	ws.ws_row = wts.swrow;
	ws.ws_col = wts.swcol;
	if (0 > ioctl(dc->the_pty.fd, TIOCSWINSZ, &ws))
		warn("setting window size");
}

static void putrwout(void)
{
	struct wrides de = {1, "putrwout"};
	full_write(&de, therout.bf, therout.len);
	therout.len = 0;
}

static Dtachctx testdc(char op)
{
	static Dtachctx dc;

	switch (op) {
		case 'g':	if (!dc) abort();
	break;	case 'r':
		free(dc);
		dc = calloc(1, sizeof(*dc));
	break;	default: abort();
	}

	return dc;
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
	term_fre(wts.t);
	memset(&wts, 0, sizeof(wts));

	therout.len = 0;

	free(termid);	termid = 0;
	free(logview);	logview = 0;
	free(sblvl);	sblvl = 0;

	profpathsavd = "";
	testclistate('r');
	testdc('r');
}

static void writetosp0term(const void *s)
{
	struct wrides pty = {1, "pty"}, cli = {1, "cli"};

	writetosubproccore(
		&pty, &cli, testdc('g'), testclistate('g'), s, strlen(s));

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
	struct fdbuf sigb = {&sigde, 512};

	tstdesc("empty WERMPROFPATH");
	testreset();

	iterprofs("", &((struct iterprofspec){ 0 }));

	tstdesc("non-existent and empty dirs in WERMPROFPATH");
	testreset();
	iterprofs(
		"test/profilesnoent::test/profiles1",
		&((struct iterprofspec){ &sigb }));
	fdb_finsh(&sigb);

	tstdesc("match js and print");
	testreset();
	termid = strdup("hasstuff");
	iterprofs("test/profiles1", &((struct iterprofspec) {
		&sigb,
		.sendauxjs = 1,
	}));
	fdb_finsh(&sigb);

	tstdesc("name error but matches other line to print auxjs");
	testreset();
	termid = strdup("bad.name");
	iterprofs("test/profiles2", &((struct iterprofspec) {
		&sigb,
		.sendauxjs = 1,
	}));
	fdb_finsh(&sigb);

	tstdesc("name error no match");
	testreset();
	termid = strdup("xyz");
	iterprofs("test/profiles2", &((struct iterprofspec) {
		&sigb,
		.sendauxjs = 1,
	}));
	fdb_finsh(&sigb);

	tstdesc("name error but matches other line to print preamble");
	testreset();
	termid = strdup("bad");
	iterprofs("test/profiles2", &((struct iterprofspec) {
		&sigb,
		.sendpream = 1,
	}));
	fdb_finsh(&sigb);

	tstdesc("empty preamble for match 1");
	testreset();
	termid = strdup("allempty");
	iterprofs("test/profiles1", &((struct iterprofspec) {
		&sigb,
		.sendpream = 1,
	}));
	fdb_finsh(&sigb);

	tstdesc("empty preamble for match 2");
	testreset();
	termid = strdup("emptypream");
	iterprofs("test/profiles1", &((struct iterprofspec) {
		&sigb,
		.sendpream = 1,
	}));
	fdb_finsh(&sigb);

	tstdesc("empty preamble for match 3");
	testreset();
	termid = strdup("emptypreamjs");
	iterprofs("test/profiles1", &((struct iterprofspec) {
		&sigb,
		.sendpream = 1,
	}));
	fdb_finsh(&sigb);

	tstdesc("long preamble 1");
	testreset();
	termid = strdup("longpream1");
	iterprofs("test/profiles1", &((struct iterprofspec) {
		&sigb,
		.sendpream = 1,
	}));
	fdb_finsh(&sigb);

	tstdesc("long preamble 2");
	testreset();
	termid = strdup("longpream2");
	iterprofs("test/profiles1", &((struct iterprofspec) {
		&sigb,
		.sendpream = 1,
	}));
	fdb_finsh(&sigb);

	tstdesc("empty js for match 1");
	testreset();
	termid = strdup("emptypreamjs");
	iterprofs("test/profiles1", &((struct iterprofspec) {
		&sigb,
		.sendauxjs = 1,
	}));
	fdb_finsh(&sigb);

	tstdesc("empty js for match 2");
	testreset();
	termid = strdup("allempty");
	iterprofs("test/profiles1", &((struct iterprofspec) {
		&sigb,
		.sendauxjs = 1,
	}));
	fdb_finsh(&sigb);

	tstdesc("empty js for match 3");
	testreset();
	termid = strdup("emptyjs1");
	iterprofs("test/profiles1", &((struct iterprofspec) {
		&sigb,
		.sendauxjs = 1,
	}));
	fdb_finsh(&sigb);

	tstdesc("empty js for match 4");
	testreset();
	termid = strdup("emptyjs2");
	iterprofs("test/profiles1", &((struct iterprofspec) {
		&sigb,
		.sendauxjs = 1,
	}));
	fdb_finsh(&sigb);

	tstdesc("url-encoding-related chars not allowed in termid");
	testreset();
	iterprofs("test/profiles3", &((struct iterprofspec) {
		&sigb,
	}));
	fdb_finsh(&sigb);

	tstdesc("bad names while outputting new session list");
	testreset();
	iterprofs("test/profiles3", &((struct iterprofspec) {
		&sigb,
		.newsessin = 1,
	}));
	fdb_finsh(&sigb);

	tstdesc("dump newsessin list");
	testreset();
	iterprofs("test/profilesname", &((struct iterprofspec) {
		&sigb,
		.newsessin = 1,
	}));
	fdb_finsh(&sigb);

	tstdesc("empty profile name");
	testreset();
	iterprofs("test/emptyprof", &((struct iterprofspec) {
		&sigb,
		.newsessin = 1,
	}));
	termid = strdup("");
	iterprofs("test/emptyprof", &((struct iterprofspec) {
		&sigb,
		.sendpream = 1,
	}));
	iterprofs("test/emptyprof", &((struct iterprofspec) {
		&sigb,
		.sendauxjs = 1,
	}));
	fdb_finsh(&sigb);

	tstdesc("ephemeral session uses basic profile config");
	testreset();
	iterprofs("test/emptyprof", &((struct iterprofspec) {
		&sigb,
		.sendpream = 1,
		.sendauxjs = 1,
	}));
	fdb_finsh(&sigb);
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
	process_tty_out("hello", -1);
	tstdesc("pending line");
	process_tty_out("\r\n", -1);
	tstdesc("finished line");

	do {
		int i = 0;
		while (i++ < 1024) process_tty_out("x", -1);
		process_tty_out("[exceeded]", -1);
		process_tty_out("\r\n", -1);
	} while (0);

	process_tty_out("abcdef\b\033[K\b\033[K\b\033[Kxyz\r\n", -1);
	process_tty_out("abcdef\b\r\n", -1);

	tstdesc("move back x2 and delete to eol");
	process_tty_out("abcdef\b\b\033[K\r\n", -1);

	tstdesc("move back x1 and insert");
	process_tty_out("asdf\bxy\r\n", -1);

	tstdesc("move back and forward");
	process_tty_out("asdf\b\033[C\r\n", -1);

	tstdesc("move back x2 and forward x1, then del to EOL");
	process_tty_out("asdf\b\b" "\033[C" "\033[K" "\r\n", -1);

	tstdesc("as above, but in separate calls");
	process_tty_out("asdf\b\b", -1);
	process_tty_out("\033[C", -1);
	process_tty_out("\033[K", -1);
	process_tty_out("\r\n", -1);

	tstdesc("move left x3, move right x2, del EOL; 'right' seq in sep calls");
	process_tty_out("123 UIO\b\b\b" "\033[", -1);
	process_tty_out("C" "\033", -1);
	process_tty_out("[C", -1);
	process_tty_out("\033[K", -1);
	process_tty_out("\r\n", -1);

	tstdesc("drop console title escape seq");
	/* https://tldp.org/HOWTO/Xterm-Title-3.html */
	process_tty_out("abc\033]0;title\007xyz\r\n", -1);
	process_tty_out("abc\033]1;title\007xyz\r\n", -1);
	process_tty_out("123\033]2;title\007" "456\r\n", -1);

	tstdesc("drop console title escape seq; separate calls");
	process_tty_out("abc\033]0;ti", -1);
	process_tty_out("tle\007xyz\r\n", -1);

	tstdesc("bracketed paste mode");
	/* https://github.com/pexpect/pexpect/issues/669 */

	/* \r after paste mode off */
	process_tty_out("before (", -1);
	process_tty_out("\033[?2004l\rhello\033[?2004h", -1);
	process_tty_out(") after\r\n", -1);

	/* no \r after paste mode off */
	process_tty_out("before (", -1);
	process_tty_out("\033[?2004lhello\033[?2004h", -1);
	process_tty_out(") after\r\n", -1);

	tstdesc("drop color and font");
	process_tty_out("before : ", -1);
	process_tty_out("\033[1;35mafter\r\n", -1);

	/* split between calls */
	process_tty_out("before : ", -1);
	process_tty_out("\033[1;", -1);
	process_tty_out("35mafter\r\n", -1);

	process_tty_out("before : \033[36mAfter\r\n", -1);

	process_tty_out("first ;; \033[1;31msecond\r\n", -1);

	tstdesc("\\r to move to start of line");
	process_tty_out("xyz123\rXYZ\r\n", -1);

	tstdesc("something makes the logs stop");
	term(wts.t,mode) &= ~MODE_LOGBADESC;
	process_tty_out(
		"\033[?2004h"
		"[0]~$ l\b"
		"\033[K"
		"seq 1 | less\r"
		"\n"
		"\033[?2004l"
		"\r"
		"\033[?1049h"
		"\033[22;0;0t"
		"\033[?1h"
		"\033=\r1\r\n"
		"\033[7m(END)"
		"\033[27m"
		"\033[K"
		"\r"
		"\033[K"
		"\033[?1l"
		"\033>"
		"\033[?1049l"
		"\033[23;0;0t"
		"\033[?2004h[0]~$"
		" # asdf\r\n\033[?2004"
		"l\r\033[?2004h[0]~$ "
		, -1
	);

	tstdesc("\\r then delete line");
	process_tty_out("abc\r\033[Kfoo\r\n", -1);

	tstdesc("arrow keys are translated to escape sequences");
	testreset();
	writelgon();

	tstdesc("app cursor off: up,down,right,left=ESC [ A,B,C,D");
	writetosp0term("left (\\< \\<)\r");
	writetosp0term("up down up (\\^ \\v \\^)\r");
	writetosp0term("right (\\>)\r");

	tstdesc("app cursor on: same codes as when off but O instead of [");
	process_tty_out("\033[?1h", -1);
	writetosp0term("left (\\< \\<)\r");
	writetosp0term("up down up (\\^ \\v \\^)\r");
	writetosp0term("right (\\>)\r");

	tstdesc("bad input tolerance: terminate OS cmd without char 7");
	process_tty_out("\033]0;foobar\rdon't hide me\r\n", -1);

	tstdesc("backward to negative linepos, then dump line to log");
	testreset();
	writelgon();
	process_tty_out("\r\010\010\010x\n", -1);

	tstdesc("escape before sending to attached clients");
	testreset();
	process_tty_out("abcd\r\n", -1);
	process_tty_out("xyz\b\t\r\n", -1);
	putrwout();

	tstdesc("pass OS escape to client");
	testreset();
	process_tty_out("\033]0;asdf\007xyz\r\n", -1);
	putrwout();

	tstdesc("simplify alternate mode signal");
	testreset();
	process_tty_out("\033[?47h" "hello\r\n" "\033[?47l", -1);

	process_tty_out("\033[", -1);
	process_tty_out("?47h" "hello\r\n" "\033", -1);
	process_tty_out("[?47l", -1);

	process_tty_out("\033[?1047h" "hello\r\n" "\033[?1047l", -1);
	putrwout();

	tstdesc("regression");
	testreset();
	process_tty_out("\033\133\077\062\060\060\064\150\033\135\060\073\155\141\164\166\157\162\145\100\160\145\156\147\165\151\156\072\040\176\007\033\133\060\061\073\063\062\155\155\141\164\166\157\162\145\100\160\145\156\147\165\151\156\033\133\060\060\155\072\033\133\060\061\073\063\064\155\176\033\133\060\060\155\044\040\015\033\133\113\033\135\060\073\155\141\164\166\157\162\145\100\160\145\156\147\165\151\156\072\040\176\007\033\133\060\061\073\063\062\155\155\141\164\166\157\162\145\100\160\145\156\147\165\151\156\033\133\060\060\155\072\033\133\060\061\073\063\064\155\176\033\133\060\060\155\044\040", -1);
	putrwout();

	tstdesc("passthrough escape \\033[1P from subproc to client");
	testreset();
	process_tty_out("\033[1P", -1);
	putrwout();
	testreset();
	process_tty_out("\033[4P", -1);
	putrwout();
	testreset();
	process_tty_out("\033[5P", -1);
	putrwout();
	testreset();
	process_tty_out("\033[16P", -1);
	putrwout();

	tstdesc("delete 5 characters ahead");
	testreset();
	writelgon();
	process_tty_out("$ asdfasdfasdf # asdfasdfasdf\r\033[C\033[C\033[5P\r\n", -1);

	tstdesc("delete 12 characters ahead");
	testreset();
	writelgon();
	process_tty_out("$ asdfasdfasdf # asdfasdfasdf\r\033[C\033[C\033[12P\r\n", -1);

	tstdesc("delete 16 characters ahead");
	testreset();
	writelgon();
	process_tty_out("$ asdfasdfasdf # asdfasdfasdf\r\033[C\033[C\033[16P\r\n", -1);

	tstdesc("save rawout from before OS escape");
	testreset();
	process_tty_out("abc\033]0;new-t", -1);
	putrwout();
	tstdesc("<between calls>");
	process_tty_out("itle\007xyz\r\n", -1);
	putrwout();

	tstdesc("1049h/l code for switching to/from alternate screen + other ops");
	testreset();
	process_tty_out("abc \033[?1049h", -1);
	process_tty_out("-in-\033[?1049lout", -1);
	putrwout();

	tstdesc("dump of state");
	testreset();
	writetosp0term("\\N");
	process_tty_out("\033[?47h", -1); putrwout();
	writetosp0term("\\N");
	writetosp0term("\\N");
	process_tty_out("\033[?47l", -1); putrwout();
	writetosp0term("\\N");
	process_tty_out("\033[?1049h", -1); putrwout();
	writetosp0term("\\N");
	process_tty_out("\033[?1049l", -1); putrwout();
	writetosp0term("\\N");

	tstdesc("do not save bell character in plain text log");
	testreset();
	writelgon();
	process_tty_out("ready...\007 D I N G!\r\n", -1);

	tstdesc("editing a long line");
	testreset();
	writelgon();
	writetosp0term("\\w00300104");
	process_tty_out(test_lineed_in, 0xf8);
	process_tty_out("\n", -1);

	/* The expected output is garbly after the st migration. I suspect the
	   purpose here is to make sure there is no crash or crater. But maybe
	   I have actually introduced a bug with a bad st/tm rewrite. */
	tstdesc("editing a long line in a narrower window");
	testreset();
	writelgon();
	writetosp0term("\\w00800061");
	process_tty_out(test_lineednar_in, -1);
	process_tty_out("\n", -1);

	tstdesc("go up more rows than exist in the linebuf");
	testreset();
	writetosp0term("\\w00800060");
	process_tty_out("\033[Axyz\r\n", -1);

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
	process_tty_out("this is plain terminal text", -1);
	writetosp0term("\\t");
	for (i = 0; i < sizeof(wts); i++) writetosp0term("abc");
	writetosp0term("\n");
	putrwout();
	/* line buffer should not be clobbered by overflowing ttl buffer. */
	process_tty_out("\r\n", -1);
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
	process_tty_out("xyz\r\nabc\033[?1049h", -1);
	process_tty_out("defg", -1);
	process_tty_out("hijk\033[?1049lrest\r\n", -1);

	tstdesc("move to col");
	testreset();
	writelgon();
	process_tty_out(test_jumptocol_in, TEST_JUMPTOCOL_IN_LEN);

	tstdesc("move to col 2");
	testreset();
	writelgon();
	process_tty_out("asdf\033[2Gxyz\r\n", -1);

	tstdesc("shift rest of line then overwrite");
	testreset();
	writelgon();
	process_tty_out("asdf 01234\r\033[4Pxyz\n", -1);

	tstdesc("shift remaining characters right");
	testreset();
	writelgon();
	process_tty_out("asdf\r\033[10@xyz\n", -1);

	tstdesc("shift remaining characters right more");
	testreset();
	writelgon();
	/* 10000 is too large; it should be ignored */
	process_tty_out("asdf\r\033[10000@xyz\r\n", -1);
	process_tty_out("asdf\r\033[15@xyz\r\n", -1);
	process_tty_out(":(..more\r:)\033[5@xyz\r\n", -1);
	process_tty_out(":(..more\r:)\033[1@xyz\r\n", -1);

	/* Make sure we only copy the amount of characters needed. */
	for (i = 0; i < 100; i++) process_tty_out("123456", -1);
	process_tty_out("\r\033[552G", -1);
	process_tty_out("\033[10@", -1);
	process_tty_out("..more:)\r\n", -1);

	tstdesc("move more characters right than are in the line");
	process_tty_out("abcd\r\033[1000@!!!!\r\n", -1);
	process_tty_out("abcd\r\033[50@!!!!\r\n", -1); 

	tstdesc("make long line too big to fit into buffer");
	for (i = 0; i < 1023; i++) process_tty_out("*", -1);
	process_tty_out("\r\033[32@!!!\r\n", -1);

	tstdesc("text from current line in \\A output");
	testreset();
	termid = strdup("statejsontest");
	process_tty_out("foo!\r\nbar?", -1);
	writetosp0term("\\A");
	tstdesc("... text from prior line");
	process_tty_out("\r\n\r\n", -1);
	writetosp0term("\\A");
	tstdesc("... override with client-set title");
	writetosp0term("\\tmy ttl 42\n");
	writetosp0term("\\A");
	process_tty_out("another line\r\n", -1);
	writetosp0term("\\A");
	writetosp0term("\\t\n");
	writetosp0term("\\A");
	process_tty_out("again, ttl from line\r\n", -1);
	writetosp0term("\\A");

	tstdesc("tab backwards");
	testreset();
	writelgon();
	process_tty_out("abc\033[1Zxyz\r\n", -1);
	process_tty_out("\033[1Zxyz\r\n", -1);
	process_tty_out("abc\tb\033[1Zxyz\r\n", -1);
	process_tty_out("abc\t\033[1Zxyz\r\n", -1);
	process_tty_out("a\tb\tc\033[2Zxyz\r\n", -1);
	process_tty_out("a\tb\tc\033[3Zxyz\r\n", -1);

	testiterprofs();
	testqrystring();
	test_outstreams();
	test_http();

	exit(0);
}

void set_argv0(Dtachctx dc, char role)
{
	char *bname = strdup(dc->sockpath);
	memset(argv0, ' ', argv0sz);
	snprintf(argv0, argv0sz, "Wer%c.%s", role, basename(bname));
	free(bname);
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

static void m4hout(const MD_CHAR *buf, MD_SIZE sz, void *ud)
{
	fdb_apnd(ud, buf, sz);
}

static void servereadme(struct wrides *de)
{
	struct fdbuf d = {0};
	char *path, *mdsrc, *mdc, *mdend;
	struct stat sb;
	int sfd;
	ssize_t redn;

	xasprintf(&path, "%s/README.md", getenv("WERMSRCDIR"));
	sfd = open(path, O_RDONLY);
	if (0 > sfd)			{ perror("open md"); exit(1); }
	if (0 > fstat(sfd, &sb))	{ perror("fstat md"); exit(1); }
	free(path);

	mdc = mdsrc = malloc(sb.st_size);
	mdend = mdsrc + sb.st_size;

	while (mdc != mdend) {
		redn = read(sfd, mdc, mdend - mdc);
		if (0 > redn && errno == EINTR) continue;
		if (0 > redn) { perror("read md"); exit(1); }

		mdc += redn;
	}

	fdb_apnd(&d, "<html><head><title>README.md</title>", -1);
	fdb_apnd(&d, "<link rel=stylesheet href=common.css>", -1);
	fdb_apnd(&d, "<link rel=stylesheet href=readme.css>", -1);
	fdb_apnd(&d, "</head><body>", -1);
	md_html(mdsrc, sb.st_size, m4hout, &d, MD_FLAG_TABLES, 0);
	fdb_apnd(&d, "</body></html>", -1);

	resp_dynamc(de, 'h', 200, d.bf, d.len);
	fdb_finsh(&d);
}

static int maybeservefont(struct wrides *de, const char *resource)
{
	int fni, scann;

	scann = -1;
	sscanf(resource, "/%d.wermfont%n", &fni, &scann);
	if (strlen(resource) != scann)		return 0;
	if (fni < 0 || fni >= fontcnt())	return 0;
	servefnt(de, fni);
	return 1;
}

static _Noreturn void becomewebsocket(const char *quer)
{
	/* These query args settings do not get inherited from the spawner to
	   children. */
	free(dtachlog);
	dtachlog = 0;
	free(termid);
	termid = 0;

	processquerystr(quer);
	if (termid) {
		checktid();
		if (!strchr(termid, '.')) appendunqid();
	}

	dtach_main(prepfordtach());
}

static void begnsesnlis(struct wrides *de)
{
	struct fdbuf b = {0};

	iterprofs(profpath(), &((struct iterprofspec){
		.sigb = &b,
		.newsessin = 1,
		.diaglog = 1,
	}));

	resp_dynamc(de, 'h', 200, b.bf, b.len);
}

static void externalcgi(struct wrides *de, char hdr, Httpreq *rq)
{
	char *binp;
	struct fdbuf b = {0};
	int p[2];
	pid_t cpid;
	ssize_t redn;
	unsigned char inb[4096];

	if (0>pipe(p))			{ perror("pipe cgi"	); exit(1); }
	if (0>(cpid=fork()))		{ perror("fork cgi"	); exit(1); }
	if (!cpid && 0>dup2(p[1], 1))	{ perror("dup p1"	); exit(1); }
	if (0>close(p[1]))		{ perror("close p1"	); exit(1); }

	if (!cpid) {
		close(p[0]);

		xasprintf(&binp, "%s/cgi%s",
			  getenv("WERMSRCDIR"), rq->resource);
		setenv("QUERY_STRING", rq->query, 1);
		execl(binp, binp, NULL);
		perror("execl for external cgi");
		exit(1);
	}

	for (;;) {
		redn = read(p[0], inb, sizeof(inb));
		if (!redn)	break;
		if (0<redn)	fdb_apnd(&b, inb, redn);
		if (0>redn && errno != EINTR)	{ perror("read"); goto er; }
	}

	resp_dynamc(de, hdr, 200, b.bf, b.len);

	if (0>waitpid(cpid, 0, 0)) { perror("waitpid"); goto er; }

	goto cleanup;

er:
	resp_dynamc(de, 't', 403, 0, 0);

cleanup:
	fdb_finsh(&b);
}

static void mainjsscrip(struct wrides *out)
{
	resp_dynamc(out, 'j', 200, mainjs, MAINJS_LEN);
}

static void httphandlers(struct wrides *out, Httpreq *rq)
{
	const char *rs = rq->resource;

	fprintf(stderr, "serving: %s\n", rs);
	if (maybeservefont(out, rs))	return;

	if (!strcmp(rs, "/"))		{ resp_static(out, 'h', "/index.html");
									return;}
	if (!strcmp(rs, "/attach"))	{ resp_static(out, 'h', rs);	return;}
	if (!strcmp(rs, "/common.css"))	{ resp_static(out, 'c', rs);	return;}
	if (!strcmp(rs, "/readme.css"))	{ resp_static(out, 'c', rs);	return;}
	if (!strcmp(rs, "/share"))	{ externalcgi(out, 'j', rq);	return;}
	if (!strcmp(rs, "/endptid.js"))	{ resp_static(out, 'j', rs);	return;}
	if (!strcmp(rs, "/aux.js"))	{ externalcgi(out, 'j', rq);	return;}
	if (!strcmp(rs, "/scrollback"))	{ externalcgi(out, 'h', rq);	return;}
	if (!strcmp(rs, "/showenv"))	{ externalcgi(out, 't', rq);	return;}
	if (!strcmp(rs, "/st"))		{ mainjsscrip(out);		return;}
	if (!strcmp(rs, "/atchses"))	{ atchsesnlis(out);		return;}
	if (!strcmp(rs, "/readme"))	{ servereadme(out);		return;}
	if (!strcmp(rs, "/newsess"))	{ begnsesnlis(out);		return;}

	resp_dynamc(out, 't', 404, 0, 0);
}

int http_serv(void)
{
	struct fdbuf b = {0};
	struct wrides out = {1};
	Httpreq rq = {0};
	const char *rs = rq.resource;

	http_read_req(stdin, &rq, &out);
	if (rq.error) return 0;
	if (rq.validws) becomewebsocket(rq.query);

	/* TODO(github.com/google/werm/issues/1) will it be more secure to also
	   verify Origin/Host are consistent? */
	if (rq.restrictfetchsite
	    && strcmp(rs, "/")
	    && strcmp(rs, "/attach")
	) {
		fdb_apnd(&b, "Not accepting redirects for this resource: ", -1);
		fdb_apnd(&b, rs, -1);
		fdb_apnc(&b, '\n');
		resp_dynamc(&out, 't', 403, b.bf, b.len);
		fdb_finsh(&b);
	}
	else
		httphandlers(&out, &rq);

	return rq.keepaliv;
}

static void addsrcdirenv(void)
{
	char buf[PATH_MAX], *dn;
	const char *wsd = getenv("WERMSRCDIR");

	if (wsd && wsd[0]) return;

	if (!realpath(argv0, buf))		{ perror("realpath"); goto er; }
	dn = dirname(buf);
	if (0 > setenv("WERMSRCDIR", dn, 1))	{ perror("setenv"); goto er; }

	return;

er:
	fprintf(stderr, "cannot auto-set $WERMSRCDIR, argv0=%s\n", argv0);
	exit(1);
}

int main(int argc, char **argv)
{
	Dtachctx dc;

	errno = 0;
	if (setvbuf(stdout, 0, _IONBF, 0))
		err(1, "could not turn off stdout buffering");

	if (argc < 1) errx(1, "unexpected argc value: %d", argc);

	argv0 = argv[0];
	addsrcdirenv();

#if __linux__
	/* All elements in argv are in a contiguous block of memory. */
	argv0sz = argv[argc-1]-argv[0] + strlen(argv[argc-1]) + 1;
#else
	argv0sz = strlen(argv0)+1;
#endif

	argc--;
	argv++;
	if (1 == argc && !strcmp(*argv, "test"))	testmain();

	wts.allowtmstate = 1;

	if (argc >= 1 && !strcmp(*argv, "spawner")) {
		processquerystr(getenv("WERMFLAGS"));
		iterprofs(profpath(), &((struct iterprofspec){ .diaglog = 1 }));

		termid = strdup("~spawner");
		appendunqid();
		dc = prepfordtach();
		dc->spargs = parse_spawner_ports(argv + 1);

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
		dc->firstatch = 1;
		exit(dtach_master(dc));
	}

	fprintf(stderr, "unrecognized arguments\n");
	exit(1);
}
