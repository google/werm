#define _XOPEN_SOURCE 600
#define _GNU_SOURCE

#include "shared.h"

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

static int xasprintf(char **strp, const char *format, ...)
{
	int res;

	va_list argp;

	va_start(argp, format);
	res = vsnprintf(NULL, 0, format, argp);
	va_end(argp);
	if (res < 0) errx(1, "vsnprintf: サイズの計算に失敗した");

	*strp = malloc(res+1);

	va_start(argp, format);
	res = vsnprintf(*strp, res+1, format, argp);
	va_end(argp);
	if (res < 0) errx(1, "vsnprintf");

	return res;
}

static char *pream, *argv0, *termid;

static size_t argv0sz;

#define SAFEPTR(buf, start, regsz) (buf + ((start) % (sizeof(buf)-(regsz)+1)))

/* Name is based on Write To Subproc but this contains process_kbd state too.
 * We put this in a single struct so all logic state can be reset with a single
 * memset call. */
static struct {
	unsigned sendsigwin : 1;
	unsigned short swrow, swcol;
	unsigned wsi;
	char winsize[8];

	/* 0: reading raw characters
	 * '1': next char is escaped
	 * 'w': reading window size
	 */
	char escp;

	/* Buffers for content about to be written to logs */
	unsigned char linebuf[1024], escbuf[1024];
	unsigned linesz, linepos, escsz;

	unsigned altscren	: 1;
	unsigned appcursor	: 1;

	unsigned char *rwoutbuf;
	size_t rwoutsz, rwoutlen;

	/* Raw output will be written here if non-null. */
	FILE *rwouthndl;

	/* Logs (either text only, or raw subproc output) are written to these
	 * fd's if not 0. */
	int logfd, rawlogfd;
} wts;

void get_rout_for_attached(const unsigned char **buf, size_t *len)
{
	*buf = wts.rwoutbuf;
	*len = wts.rwoutlen;
}

static void fullwrite(int fd, const char *desc, const void *buf_, size_t sz)
{
	ssize_t writn;
	const unsigned char *buf = buf_;

	/* This is convenient for tests. */
	if (1 == fd) fflush(stdout);

	while (sz) {
		writn = write(fd, buf, sz);
		if (!writn) errx(1, "should be blocking: %s", desc);
		if (writn > 0) {
			sz -= writn;
			buf += writn;
		}
		else if (errno != EINTR) {
			warn("write to %s", desc);
			return;
		}
	}
}

static void logescaped(FILE *f, const unsigned char *buf, size_t sz)
{
	while (sz--) {
		if (*buf >= ' ' && *buf != 0x7f)
			fputc(*buf, f);
		else
			fprintf(f, "\\%03o", *buf);
		buf++;
	}
	fputc('\n', f);
}

static void dump(void)
{
	char *dumpfn;
	FILE *f;
	static unsigned dimp;

	xasprintf(&dumpfn, "/tmp/dump.%lld.%u", (long long)getpid(), dimp++);
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
	fclose(f);
}

static void verifyroutcap(size_t needed)
{
	size_t minsz = wts.rwoutlen + needed;

	if (minsz <= wts.rwoutsz) return;

	wts.rwoutsz = minsz * 2;
	if (wts.rwoutsz < 16) wts.rwoutsz = 16;
	wts.rwoutbuf = realloc(wts.rwoutbuf, wts.rwoutsz);
	if (!wts.rwoutbuf) errx(1, "even realloc knows: out of mem");
}

static void putroutraw(const char *s) {
	unsigned char *bf;

	verifyroutcap(strlen(s));
	bf = wts.rwoutbuf;
	while (*s) bf[wts.rwoutlen++] = *s++;
}

static int hexdig(int v)
{
	v &= 0x0f;
	return v + (v < 10 ? '0' : 'W');
}

static void putrout(int b)
{
	unsigned char *bf;

	verifyroutcap(3);
	bf = wts.rwoutbuf;

	b &= 0xff;

	if (b == '\\' || b < ' ' || b > '~') {
		bf[wts.rwoutlen++] = '\\';
		bf[wts.rwoutlen++] = hexdig(b >> 4);
		bf[wts.rwoutlen++] = hexdig(b);
	}
	else bf[wts.rwoutlen++] = b;
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

void deletechrahead(void)
{
	char *endptr;
	const char *lesc;
	unsigned long cnt;

	lesc = (char *)wts.escbuf + wts.escsz - 1;
	if (wts.escsz < 4 || *lesc != 'P' || wts.escbuf[1] != '[') return;

	cnt = strtoul((char *)wts.escbuf+2, &endptr, 10);

	if (endptr != lesc) return;

	if (wts.linesz <= wts.linepos + cnt) return;

	wts.linesz -= cnt;
	memmove(wts.linebuf + wts.linepos, wts.linebuf + wts.linepos + cnt,
		wts.linesz - wts.linepos);
}

/* Obviously this function is a mess. But I'm still planning how to clean it up.
 */
void process_tty_out(const unsigned char *buf, size_t len)
{
	char lastescbyt;

	wts.rwoutlen = 0;

	if (wts.rawlogfd) fullwrite(wts.rawlogfd, "raw log", buf, len);

	while (len) {
		if (buf[0] == '\r') {
			wts.escsz = 0;
			wts.linepos = 0;
			goto eol;
		}

		if (buf[0] == '\b') {
			/* move left */
			if (wts.linepos) wts.linepos--;
			goto eol;
		}

		/* The bell character (7) is the correct way to
		 * terminate escapes that start with \033] */
		if (*buf == 7) wts.escsz = 0;

		if (*buf >= 'A' && *buf <= 'Z' && CONSUMEESC("\033[")) {
			switch (*buf) {
			/* delete to EOL */
			case 'K': wts.linesz = wts.linepos; break;

			/* move right */
			case 'C': wts.linepos++; break;
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
				putroutraw(*buf == 'h' ? "\\s2" : "\\s1");
				goto eol;
			}
			if (CONSUMEESC("\033[?1049")) {
				wts.altscren = *buf=='h';
				/* on: save cursor+state, set alternate screen,
				 * clear
				 * off: set primary screen, restore
				 * cursor+state
				 */
				putroutraw(*buf == 'h' ? "\\ss\\s2\\cl"
						       : "\\s1\\rs");
				goto eol;
			}

			if (wts.escsz > 1 && wts.escbuf[1] == '[') {
				wts.escsz = 0;
				goto eol;
			}
		}
		if (buf[0] == '\033' || wts.escsz) {
			if (buf[0] == '\033') wts.escsz = 0;
			*SAFEPTR(wts.escbuf, wts.escsz, 1) = *buf;
			wts.escsz++;
			goto eol;
		}

		if (*buf == '\n') wts.linepos = wts.linesz;
		if (*buf == 7) goto eol;

		*SAFEPTR(wts.linebuf, wts.linepos, 1) = *buf;
		if (wts.linesz < ++wts.linepos) wts.linesz = wts.linepos;

		if (*buf != '\n' && wts.linesz < sizeof(wts.linebuf)) goto eol;

		if (wts.linesz > sizeof(wts.linebuf)) {
			dump();
			errx(1, "linesz is too large, see dump");
		}

		if (wts.logfd)
			fullwrite(wts.logfd, "log", wts.linebuf, wts.linesz);
		wts.linesz = 0;
		wts.linepos = 0;

	eol:
		deletechrahead();

		putrout(*buf++);
		len--;
	}

	putroutraw("\n");
}

void recount_state(int fd)
{
	fullwrite(fd, "recount", wts.altscren ? "\\s2" : "\\s1", 3);
}

static char *extract_query_arg(const char **qs, const char *pref)
{
	size_t preflen;
	const char *end;
	char *buf, *bufcur;
	int byte, bcnt;

	preflen = strlen(pref);
	if (memcmp(*qs, pref, preflen)) return NULL;
	*qs += preflen;

	end = strchrnul(*qs, '&');
	bufcur = buf = malloc(end - *qs + 1);

	while (*qs != end) {
		byte = *(*qs)++;

		if (byte == '%') {
			bcnt = 0;
			if (sscanf(*qs, "%2x%n", &byte, &bcnt) && bcnt == 2)
				*qs += 2;
		}

		*bufcur++ = byte;
	}
	*bufcur = 0;

	return buf;
}


static void parse_query(void)
{
	const char *qs;
	char *val;

	qs = getenv("QUERY_STRING");
	if (!qs) return;

	val = NULL;
	while (1) {
		if (val) {
			free(val);
			val = NULL;
		}
		if (*qs == '&') qs++;
		if (!*qs) break;

		val = extract_query_arg(&qs, "termid=");
		if (val) {
			free(termid);
			termid = strdup(val);
			continue;
		}

		val = extract_query_arg(&qs, "pream=");
		if (val) {
			free(pream);
			pream = val;
			val = NULL;
			continue;
		}

		/* Unrecognized query arg */
		qs = strchrnul(qs, '&');
	}
}

void _Noreturn subproc_main(void)
{
	const char *shell;

	shell = getenv("SHELL");

	execl(shell, shell, NULL);
	err(1, "execl $SHELL, which is: %s", shell ? shell : "<undef>");
}

static int opnforlog(const char *suff)
{
	int fd;
	char *fn;

	xasprintf(&fn, "/tmp/log.%s%s", termid, suff);
	fd = open(fn, O_WRONLY | O_CREAT | O_APPEND, 0600);
	if (fd < 0) {
		warn("open %s", fn);
		fd = 0;
	}
	free(fn);
	return fd;
}

static _Noreturn void dtachorshell(void)
{
	if (-1 == setsid()) warn("setsid");

	setenv("TERM", "xterm-256color", 1);

	/* Set by websocketd and not wanted. CGI-related cruft: */
	unsetenv("HTTP_ACCEPT_ENCODING");
	unsetenv("HTTP_ORIGIN");
	unsetenv("HTTP_SEC_WEBSOCKET_KEY");
	unsetenv("HTTP_PRAGMA");
	unsetenv("HTTP_SEC_WEBSOCKET_VERSION");
	unsetenv("HTTP_ACCEPT_LANGUAGE");
	unsetenv("HTTP_CONNECTION");
	unsetenv("HTTP_USER_AGENT");
	unsetenv("HTTP_SEC_WEBSOCKET_EXTENSIONS");
	unsetenv("HTTP_CACHE_CONTROL");
	unsetenv("REMOTE_HOST");
	unsetenv("SERVER_NAME");
	unsetenv("SERVER_PORT");
	unsetenv("SERVER_PROTOCOL");
	unsetenv("SCRIPT_NAME");
	unsetenv("PATH_INFO");
	unsetenv("PATH_TRANSLATED");
	unsetenv("QUERY_STRING");
	unsetenv("AUTH_TYPE");
	unsetenv("CONTENT_LENGTH");
	unsetenv("CONTENT_TYPE");
	unsetenv("REMOTE_IDENT");
	unsetenv("REMOTE_USER");
	unsetenv("UNIQUE_ID");
	unsetenv("REMOTE_PORT");
	unsetenv("HTTPS");
	unsetenv("GATEWAY_INTERFACE");
	unsetenv("HTTP_UPGRADE");
	unsetenv("REQUEST_URI");
	unsetenv("REQUEST_METHOD");
	unsetenv("REMOTE_ADDR");
	unsetenv("HTTP_ACCEPT_ENCODING");
	unsetenv("HTTP_ORIGIN");
	unsetenv("HTTP_SEC_WEBSOCKET_KEY");
	unsetenv("HTTP_PRAGMA");
	unsetenv("HTTP_SEC_WEBSOCKET_VERSION");
	unsetenv("HTTP_ACCEPT_LANGUAGE");
	unsetenv("HTTP_CONNECTION");
	unsetenv("HTTP_USER_AGENT");
	unsetenv("HTTP_SEC_WEBSOCKET_EXTENSIONS");
	unsetenv("HTTP_CACHE_CONTROL");
	unsetenv("SERVER_SOFTWARE");

	dtach_ephem = !termid;

#define EPHEM_SOCK_PREFIX "/tmp/werm.ephem"

	if (!termid) {
		xasprintf(&dtach_sock, EPHEM_SOCK_PREFIX ".%lld",
			  (long long) getpid());
		/* We need some termid for setting argv0 later */
		termid = dtach_sock + sizeof(EPHEM_SOCK_PREFIX);
	}
	else {
		xasprintf(&dtach_sock, "/tmp/dtach.%s", termid);
		wts.logfd = opnforlog("");
		wts.rawlogfd = opnforlog(".raw");
	}

	dtach_main();
}


void send_pream(int fd)
{
	if (!pream) return;
	fullwrite(fd, "pream", pream, strlen(pream));

	/* Theoretically unneeded as send_pream is never called more than
	 * once: */
	free(pream);
	pream = NULL;
}


static unsigned kbufsz;
static unsigned char kbuf[8];

static void finishkbuf(int outfd)
{
	unsigned bi;

	if (!kbufsz) return;

	if (outfd != 1)
		fullwrite(outfd, "keyboard buffer", kbuf, kbufsz);
	else {
		fputs("kbd[", stdout);
		for (bi = 0; bi < kbufsz; bi++) {
			if (kbuf[bi] >= ' ' && kbuf[bi] != '\\') putchar(kbuf[bi]);
			else printf("\\%03o", kbuf[bi]);
		}
		puts("]");
	}

	kbufsz = 0;
}

static void addkeybyte(int outfd, int c)
{
	if (kbufsz == sizeof(kbuf)) finishkbuf(outfd);
	kbuf[kbufsz++] = c;
}

static void writetosubproccore(
	int outfd, const unsigned char *buf, unsigned bufsz)
{
	unsigned wi, ri, row, col;
	unsigned char byte, cursmvbyte;

	if (kbufsz != 0)
		errx(1, "expected kbuf to be empty, has %u bytes", kbufsz);
	wts.sendsigwin = 0;

	wi = 0;
	while (bufsz--) {
		byte = *buf++;

		if (byte == '\n') continue;

		switch (wts.escp) {
		case 0:
			if (byte == '\\')
				wts.escp = '1';
			else
				addkeybyte(outfd, byte);
			break;

		case '1':
			cursmvbyte = 0;
			wts.escp = 0;

			switch (byte) {
			case 'n':
				addkeybyte(outfd, '\n');
				break;

			case '\\':
				addkeybyte(outfd, '\\');
				break;

			case 'w':
				wts.wsi = 0;
				wts.escp = 'w';
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
			addkeybyte(outfd, 033);
			/* application cursor mode does O rather than [ */
			addkeybyte(outfd, wts.appcursor ? 'O' : '[');
			addkeybyte(outfd, cursmvbyte);
			break;

		case 'w':
			wts.winsize[wts.wsi++] = byte;
			if (wts.wsi != sizeof(wts.winsize)) break;

			wts.sendsigwin = (
				2 == sscanf(wts.winsize, "%4hu%4hu",
					    &wts.swrow, &wts.swcol));
			if (!wts.sendsigwin)
				warn("invalid winsize: %.8s", wts.winsize);
			wts.escp = 0;

			break;

		default: errx(1, "unknown escape: %d", wts.escp);
		}
	}

	finishkbuf(outfd);
}

void forward_stdin(int sock)
{
	ssize_t red;
	unsigned char buf[512];

	red = read(0, buf, sizeof(buf));
	if (!red) errx(1, "nothing on stdin");
	if (red == -1) err(1, "read from stdin");

	fullwrite(sock, "forward stdin", buf, red);
}

void process_kbd(int ptyfd, unsigned char *buf, size_t bufsz)
{
	struct winsize ws = {0};

	writetosubproccore(ptyfd, buf, bufsz);

	if (!wts.sendsigwin) return;

	ws.ws_row = wts.swrow;
	ws.ws_col = wts.swcol;
	if (0 > ioctl(ptyfd, TIOCSWINSZ, &ws)) warn("setting window size");
}

static void proctty0term(const char *s)
{
	process_tty_out((const unsigned char *)s, strlen(s));

	if (wts.rwouthndl)
		fullwrite(1, "proctty0term", wts.rwoutbuf, wts.rwoutlen);
}

static void testreset(void)
{
	free(wts.rwoutbuf);
	memset(&wts, 0, sizeof(wts));
}

static void writetosp0term(const char *s)
{
	size_t len;

	len = strlen(s);

	writetosubproccore(1, (const unsigned char *)s, len);

	if (wts.sendsigwin) printf("sigwin r=%d c=%d\n", wts.swrow, wts.swcol);
}

static void test_main(void)
{
	puts("WRITE_TO_SUBPROC_CORE");

	puts("should ignore newline:");
	testreset();
	writetosp0term("hello\n how are you\n");

	puts("empty string:");
	testreset();
	writetosp0term("");

	puts("no-op escape \\N:");
	testreset();
	writetosp0term("\\N");

	puts("change window size after \\N:");
	testreset();
	writetosp0term("\\N\\w00990011");

	puts("missing newline:");
	testreset();
	writetosp0term("asdf");

	puts("sending sigwinch:");
	testreset();
	writetosp0term("about to resize...\\w00910042...all done");

	puts("escape seqs:");
	testreset();
	writetosp0term("line one\\nline two\\nline 3 \\\\ (reverse solidus)\\n\n");

	puts("escape seqs straddling:");
	testreset();

	writetosp0term("line one\\nline two\\");

	writetosp0term("nline 3 \\");

	writetosp0term("\\ (reverse solidus)\\n\\w012");

	writetosp0term("00140");

	puts("TEE_TTY_CONTENT");

	testreset();
	wts.logfd = 1;
	proctty0term("hello");
	puts("pending line");
	proctty0term("\r\n");
	puts("finished line");

	do {
		int i = 0;
		while (i++ < sizeof(wts.linebuf)) proctty0term("x");
		proctty0term("[exceeded]");
		proctty0term("\r\n");
	} while (0);

	proctty0term("abcdef\b\033[K\b\033[K\b\033[Kxyz\r\n");
	proctty0term("abcdef\b\r\n");

	puts("move back x2 and delete to eol");
	proctty0term("abcdef\b\b\033[K\r\n");

	puts("move back x1 and insert");
	proctty0term("asdf\bxy\r\n");

	puts("move back and forward");
	proctty0term("asdf\b\033[C\r\n");

	puts("move back x2 and forward x1, then del to EOL");
	proctty0term("asdf\b\b" "\033[C" "\033[K" "\r\n");

	puts("as above, but in separate calls");
	proctty0term("asdf\b\b");
	proctty0term("\033[C");
	proctty0term("\033[K");
	proctty0term("\r\n");

	puts("move left x3, move right x2, del EOL; 'right' seq in sep calls");
	proctty0term("123 UIO\b\b\b" "\033[");
	proctty0term("C" "\033");
	proctty0term("[C");
	proctty0term("\033[K");
	proctty0term("\r\n");

	puts("drop console title escape seq");
	/* https://tldp.org/HOWTO/Xterm-Title-3.html */
	proctty0term("abc\033]0;title\007xyz\r\n");
	proctty0term("abc\033]1;title\007xyz\r\n");
	proctty0term("123\033]2;title\007" "456\r\n");

	puts("drop console title escape seq; separate calls");
	proctty0term("abc\033]0;ti");
	proctty0term("tle\007xyz\r\n");

	puts("bracketed paste mode");
	/* https://github.com/pexpect/pexpect/issues/669 */

	/* \r after paste mode off */
	proctty0term("before (");
	proctty0term("\033[?2004l\rhello\033[?2004h");
	proctty0term(") after\r\n");

	/* no \r after paste mode off */
	proctty0term("before (");
	proctty0term("\033[?2004lhello\033[?2004h");
	proctty0term(") after\r\n");

	puts("drop color and font");
	proctty0term("before : ");
	proctty0term("\033[1;35mafter\r\n");

	/* split between calls */
	proctty0term("before : ");
	proctty0term("\033[1;");
	proctty0term("35mafter\r\n");

	proctty0term("before : \033[36mAfter\r\n");

	proctty0term("first ;; \033[1;31msecond\r\n");

	puts("\\r to move to start of line");
	proctty0term("xyz123\rXYZ\r\n");

	puts("something makes the logs stop");
	proctty0term(
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
	);

	puts("\\r then delete line");
	proctty0term("abc\r\033[Kfoo\r\n");

	puts("arrow keys are translated to escape sequences");
	testreset();
	wts.logfd = 1;

	puts("app cursor off: up,down,right,left=ESC [ A,B,C,D");
	writetosp0term("left (\\< \\<)\r");
	writetosp0term("up down up (\\^ \\v \\^)\r");
	writetosp0term("right (\\>)\r");

	puts("app cursor on: same codes as when off but O instead of [");
	proctty0term("\033[?1h");
	writetosp0term("left (\\< \\<)\r");
	writetosp0term("up down up (\\^ \\v \\^)\r");
	writetosp0term("right (\\>)\r");

	puts("bad input tolerance: terminate OS cmd without char 7");
	proctty0term("\033]0;foobar\rdon't hide me\r\n");

	puts("backward to negative linepos, then dump line to log");
	testreset();
	wts.logfd = 1;
	proctty0term("\r\010\010\010x\n");

	puts("escape before sending to attached clients");
	testreset();
	wts.rwouthndl = stdout;
	proctty0term("abcd\r\n");
	proctty0term("xyz\b\t\r\n");

	puts("pass OS escape to client");
	testreset();
	wts.rwouthndl = stdout;
	proctty0term("\033]0;asdf\007xyz\r\n");

	puts("simplify alternate mode signal");
	testreset();
	wts.rwouthndl = stdout;
	proctty0term("\033[?47h" "hello\r\n" "\033[?47l");

	proctty0term("\033[");
	proctty0term("?47h" "hello\r\n" "\033");
	proctty0term("[?47l");

	proctty0term("\033[?1047h" "hello\r\n" "\033[?1047l");

	puts("regression");
	testreset();
	wts.rwouthndl = stdout;
	proctty0term("\033\133\077\062\060\060\064\150\033\135\060\073\155\141\164\166\157\162\145\100\160\145\156\147\165\151\156\072\040\176\007\033\133\060\061\073\063\062\155\155\141\164\166\157\162\145\100\160\145\156\147\165\151\156\033\133\060\060\155\072\033\133\060\061\073\063\064\155\176\033\133\060\060\155\044\040\015\033\133\113\033\135\060\073\155\141\164\166\157\162\145\100\160\145\156\147\165\151\156\072\040\176\007\033\133\060\061\073\063\062\155\155\141\164\166\157\162\145\100\160\145\156\147\165\151\156\033\133\060\060\155\072\033\133\060\061\073\063\064\155\176\033\133\060\060\155\044\040");

	puts("passthrough escape \\033[1P from subproc to client");
	testreset();
	wts.rwouthndl = stdout;
	proctty0term("\033[1P");
	testreset();
	wts.rwouthndl = stdout;
	proctty0term("\033[4P");
	testreset();
	wts.rwouthndl = stdout;
	proctty0term("\033[5P");
	testreset();
	wts.rwouthndl = stdout;
	proctty0term("\033[16P");

	puts("delete 5 characters ahead");
	testreset();
	wts.logfd = 1;
	proctty0term("$ asdfasdfasdf # asdfasdfasdf\r\033[C\033[C\033[5P\r\n");

	puts("delete 12 characters ahead");
	testreset();
	wts.logfd = 1;
	proctty0term("$ asdfasdfasdf # asdfasdfasdf\r\033[C\033[C\033[12P\r\n");

	puts("delete 16 characters ahead");
	testreset();
	wts.logfd = 1;
	proctty0term("$ asdfasdfasdf # asdfasdfasdf\r\033[C\033[C\033[16P\r\n");

	puts("save rawout from before OS escape");
	testreset();
	wts.rwouthndl = stdout;
	proctty0term("abc\033]0;new-t");
	puts("<between calls>");
	proctty0term("itle\007xyz\r\n");

	puts("1049h/l code for switching to/from alternate screen + other ops");
	testreset();
	wts.rwouthndl = stdout;
	proctty0term("abc \033[?1049h");
	proctty0term("-in-\033[?1049lout");

	puts("dump of state");
	testreset();
	wts.rwouthndl = stdout;
	recount_state(1); putchar('\n');
	proctty0term("\033[?47h");
	recount_state(1); putchar('\n');
	recount_state(1); putchar('\n');
	proctty0term("\033[?47l");
	recount_state(1); putchar('\n');
	proctty0term("\033[?1049h");
	recount_state(1); putchar('\n');
	proctty0term("\033[?1049l");
	recount_state(1); putchar('\n');

	puts("do not save bell character in plain text log");
	testreset();
	wts.logfd = 1;
	proctty0term("ready...\007 D I N G!\r\n");
}

void set_argv0(const char *role)
{
	snprintf(argv0, argv0sz, "werm.%s.%s", termid, role);
}

int main(int argc, char **argv)
{
	const char *home;

	argv0 = argv[0];
	argv0sz = strlen(argv0)+1;
	memset(argv0, ' ', argv0sz-1);

	if (argc < 1) errx(1, "unexpected argc value: %d", argc);
	argc--;
	argv++;

	if (1 == argc && !strcmp("test", *argv)) {
		test_main();
		exit(0);
	}

	home = getenv("HOME");

	if (!home) warnx("HOME is not set");
	else if (-1 == chdir(home)) warn("chdir to home: '%s'", home);

	parse_query();

	dtachorshell();
}
