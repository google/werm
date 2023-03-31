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

static FILE *loghndl;
static int rawlogfd;

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

	char teest;

	unsigned appcursor : 1;

	unsigned char *rwoutbuf;
	size_t rwoutsz;

	/* Raw output will be written here if non-null. */
	FILE *rwouthndl;
} wts;

static void fullwrite(int fd, const char *desc, const void *buf_, size_t sz)
{
	ssize_t writn;
	const unsigned char *buf = buf_;

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
		if (*buf == '\t' || *buf >= ' ')
			fputc(*buf, f);
		else
			fprintf(f, "\\%03o", *buf);
		buf++;
	}
	fputc('\n', f);
	fflush(f);
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
	fprintf(f, "teest: %d (%c)\n", wts.teest, wts.teest);
	fprintf(f, "appcurs: %u\n", wts.appcursor);
	fclose(f);
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

static void verifyrawosiz(size_t needsz)
{
	if (wts.rwoutsz >= needsz) return;
	wts.rwoutsz = needsz;
	wts.rwoutbuf = realloc(wts.rwoutbuf, wts.rwoutsz);
	if (!wts.rwoutbuf) errx(1, "even realloc knows: out of mem");
}

static int hexdig(int v)
{
	v &= 0x0f;
	return v + (v < 10 ? '0' : 'W');
}

static void putrout(struct raw_tty_out *rout, int b)
{
	unsigned char *bf = rout->buf;

	b &= 0xff;

	if (b == '\\' || b < ' ' || b > '~') {
		bf[rout->len++] = '\\';
		bf[rout->len++] = hexdig(b >> 4);
		bf[rout->len++] = hexdig(b);
	}
	else bf[rout->len++] = b;
}

void process_tty_out(
	const unsigned char *buf, size_t len, struct raw_tty_out *rout)
{
	char lastescbyt;

	/* At worst every byte needs escaping, plus trailing newline. */
	verifyrawosiz(len*3 + 1);
	rout->len = 0;
	rout->buf = wts.rwoutbuf;

	if (rawlogfd) fullwrite(rawlogfd, "raw log", buf, len);

	while (len) {
switch (wts.teest) {
case 0:
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
				switch (*buf) {
				case 'h': wts.appcursor = 1; break;
				case 'l': wts.appcursor = 0; break;
				}
				goto eol;
			}

			if (wts.escsz > 1 && wts.escbuf[1] == '[') {
				wts.escsz = 0;
				goto eol;
			}
		}

		if (CONSUMEESC("\033]")) {
			wts.teest = 't';
case 't':
			while (len && *buf != 0x07 && *buf != '\r') {
				putrout(rout, *buf++);
				len--;
			}
			if (!len) return;
			wts.teest = 0;
			goto eol;
		}

		if (*buf == '\n' || wts.linesz == sizeof(wts.linebuf)) {
			if (wts.linesz > sizeof(wts.linebuf)) {
				dump();
				errx(1, "linesz is too large, see dump");
			}

			if (loghndl)
				logescaped(loghndl, wts.linebuf, wts.linesz);
			wts.linesz = 0;
			wts.linepos = 0;
		}
		if (buf[0] == '\033' || wts.escsz) {
			if (buf[0] == '\033') wts.escsz = 0;
			*SAFEPTR(wts.escbuf, wts.escsz, 1) = *buf;
			wts.escsz++;
		}
		else if (*buf != '\n') {
			*SAFEPTR(wts.linebuf, wts.linepos, 1) = *buf;
			if (wts.linesz < ++wts.linepos)
				wts.linesz = wts.linepos;
		}
}
	eol:
		len--;
		putrout(rout, *buf++);
	}

	wts.rwoutbuf[rout->len++] = '\n';
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

static void openlogs(void)
{
	char *rawlogfn, *logfn;

	if (!termid) return;

	xasprintf(&rawlogfn, "/tmp/log.%s.raw", termid);
	xasprintf(&logfn, "/tmp/log.%s", termid);

	rawlogfd = open(rawlogfn, O_WRONLY | O_CREAT | O_APPEND, 0600);
	if (rawlogfd < 0) {
		rawlogfd = 0;
		warn("open %s", rawlogfn);
	}

	if (0 > mknod(logfn, 0600, 0) && errno != EEXIST)
		warn("mknod %s", logfn);
	else {
		loghndl = fopen(logfn, "a");
		if (0 > fseek(loghndl, 0, SEEK_END)) warn("fseek %s", logfn);
	}

	free(rawlogfn);
	free(logfn);
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
	openlogs();

#define EPHEM_SOCK_PREFIX "/tmp/werm.ephem"

	if (!termid) {
		xasprintf(&dtach_sock, EPHEM_SOCK_PREFIX ".%lld",
			  (long long) getpid());
		/* We need some termid for setting argv0 later */
		termid = dtach_sock + sizeof(EPHEM_SOCK_PREFIX);
	}
	else
		xasprintf(&dtach_sock, "/tmp/dtach.%s", termid);

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

			switch (byte) {
			case 'n':
				addkeybyte(outfd, '\n');
				wts.escp = 0;
				break;

			case '\\':
				addkeybyte(outfd, '\\');
				wts.escp = 0;
				break;

			case 'w':
				wts.wsi = 0;
				wts.escp = 'w';
				break;

			case 'd':
				dump();
				wts.wsi = 0;
				wts.escp = 0;
				break;

			/* no-op escape used for alerting master that it's OK to read
			 * from subproc. */
			case 'N':	wts.escp = 0; break;

			/* directions, home, end */
			case '^':	cursmvbyte = 'A'; break;
			case 'v':	cursmvbyte = 'B'; break;
			case '>':	cursmvbyte = 'C'; break;
			case '<':	cursmvbyte = 'D'; break;
			case 'e':	cursmvbyte = 'F'; break;
			case 'h':	cursmvbyte = 'H'; break;

			default:
				wts.escp = 0;
				warnx("unknown escape: %d\n", byte);
			}

			if (!cursmvbyte) break;
			addkeybyte(outfd, 033);
			/* application cursor mode does O rather than [ */
			addkeybyte(outfd, wts.appcursor ? 'O' : '[');
			addkeybyte(outfd, cursmvbyte);
			wts.escp = 0;
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
	struct raw_tty_out rout;

	process_tty_out((const unsigned char *)s, strlen(s), &rout);

	if (wts.rwouthndl) logescaped(wts.rwouthndl, rout.buf, rout.len);
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
	loghndl = stdout;

	testreset();
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
	proctty0term("\r\010\010\010x\n");

	puts("escape before sending to attached clients");
	testreset();
	loghndl = NULL;
	wts.rwouthndl = stdout;
	proctty0term("abcd\r\n");
	proctty0term("xyz\b\t\r\n");

	puts("pass OS escape to client");
	testreset();
	loghndl = NULL;
	wts.rwouthndl = stdout;
	proctty0term("\033]0;asdf\007xyz\r\n");
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
