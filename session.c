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

static int master, argv0sz;
static char *argv0, *dtach_check_cmd, *logfile, *pream;

#define SAFEPTR(buf, start, regsz) (buf + ((start) % (sizeof(buf)-(regsz))))
static unsigned char linebuf[1024], escbuf[1024];

static FILE *loghndl;
static int rawlogfd;

static unsigned linesz, linepos, escsz;

static char teest;

static void fullwrite(
	int fd, const char *desc, const unsigned char *buf, size_t sz)
{
	ssize_t writn;

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

static void teettyline(void)
{
	unsigned li;
	int c;

	for (li = 0; li < linesz; li++) {
		c = *SAFEPTR(linebuf, li, 1);
		if (c == '\t' || c >= ' ')
			fputc(c, loghndl);
		else
			fprintf(loghndl, "\\%03o", c);
	}

	fputc('\n', loghndl);
	fflush(loghndl);

	linesz = 0;
	linepos = 0;
}

static _Bool consumeesc(const char *pref, size_t preflen)
{
	if (escsz != preflen) return 0;
	if (memcmp(pref, SAFEPTR(escbuf, 0, preflen), preflen)) return 0;
	escsz = 0;
	return 1;
}

#define CONSUMEESC(pref) consumeesc(pref, sizeof(pref)-1)

void tee_tty_content(const unsigned char *buf, size_t len)
{
	if (rawlogfd) fullwrite(rawlogfd, "raw log", buf, len);
	if (!loghndl) return;

	while (len) {
switch (teest) {
case 0:
		if (buf[0] == '\r') {
			escsz = 0;
			linepos = 0;
			goto eol;
		}

		if (buf[0] == '\b') {
			/* move left */
			linepos--;
			goto eol;
		}

		if (CONSUMEESC("\033[")) {
			if (*buf == 0x4b) {
				/* delete to EOL */
				linesz = linepos;
				goto eol;
			}

			if (*buf == 0x43) {
				/* move right */
				linepos++;
				goto eol;
			}

			teest = 'c';
case 'c':
			while (1) {
				if (!len) return;
				if (*buf >= 'a' && *buf <= 'z') break;
				buf++;
				len--;
			}
			teest = 0;
			goto eol;
		}

		if (CONSUMEESC("\033]")) {
			teest = 't';
case 't':
			while (*buf != 0x07 && len) {
				buf++;
				len--;
			}
			if (!len) return;
			teest = 0;
			goto eol;
		}

		if (*buf == '\n' || linesz == sizeof(linebuf)) {
			teettyline();
			goto eol;
		}
		if (buf[0] == '\033' || escsz) {
			if (buf[0] == '\033') escsz = 0;
			*SAFEPTR(escbuf, escsz, 1) = *buf;
			escsz++;
		}
		else {
			*SAFEPTR(linebuf, linepos, 1) = *buf;
			if (linesz < ++linepos) linesz = linepos;
		}
		if (linesz == sizeof(linebuf)) teettyline();
}
	eol:
		len--;
		buf++;
	}
}

static void send_sigwinch(int row, int col)
{
	struct winsize ws = {
		.ws_row = (unsigned short) row,
		.ws_col = (unsigned short) col,
	};

	if (-1 == ioctl(master, TIOCSWINSZ, &ws)) warn("ioctl for winsz");
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
			free(dtach_check_cmd);
			xasprintf(&dtach_check_cmd,
				  "test -S /tmp/dtach.%s", val);

			free(dtach_sock);
			xasprintf(&dtach_sock, "/tmp/dtach.%s", val);

			free(logfile);
			xasprintf(&logfile, "/tmp/log.%s", val);

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
	char *rawlogfn;

	if (!logfile) errx(1, "expect logfile is set if dtach_sock is set");

	xasprintf(&rawlogfn, "%s.raw", logfile);

	rawlogfd = open(rawlogfn, O_WRONLY | O_CREAT | O_APPEND, 0600);
	if (rawlogfd < 0) {
		rawlogfd = 0;
		warn("open %s", rawlogfn);
	}
	free(rawlogfn); rawlogfn = NULL;

	if (0 > mknod(logfile, 0600, 0) && errno != EEXIST)
		warn("mknod %s", logfile);
	else {
		loghndl = fopen(logfile, "a");
		if (0 > fseek(loghndl, 0, SEEK_END)) warn("fseek %s", logfile);
	}

	snprintf(argv0, argv0sz, "dtach-%s", logfile);
}

static _Noreturn void dtachorshell(void)
{
	char *slave_name;
	int slave, dontfork;

	slave_name = ptsname(master);
	if (!slave_name) err(1, "ptsname");
	slave = open(slave_name, O_RDWR);

	close(master);
	if (-1 == dup2(slave, 0) ||
	    -1 == dup2(slave, 1) ||
	    -1 == dup2(slave, 2))
		err(1, "dup2");

	if (-1 == setsid()) warn("setsid");
	if (-1 == ioctl(0, TIOCSCTTY, 1)) warn("ioctl");

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

	dtach_ephem = !dtach_sock;

	if (dtach_sock) openlogs();
	else
		xasprintf(&dtach_sock, "/tmp/werm.ephem.%lld",
			  (long long) getpid());


	dtach_main();
}

static _Bool send_byte(int b)
{
	if (b < 0) errx(1, "got negative byte: %d", b);

	if (b == '\\' || b < ' ' || b > '~') return 3 == printf("\\%02x", b);

	return 0 <= putchar(b);
}

static _Noreturn void read_from_subproc(void)
{
	unsigned char read_buf[512], *curs;
	ssize_t b;

	snprintf(argv0, argv0sz, "read_subproc-%s", logfile);

	while (1) {
		b = read(master, read_buf, sizeof(read_buf));
		if (!b) exit(0);
		if (b == -1) err(1, "read from subproc");

		curs = read_buf;
		do {
			if (!send_byte(*curs++)) err(1, "send_byte");
		} while (--b);

		putchar('\n');
		fflush(stdout);
	}
}

struct write_subproc_st {
	unsigned bufsz;
	unsigned char buf[512];

	unsigned sendsigwin : 1, swrow : 16, swcol : 16;
	unsigned wsi;
	char winsize[8];

	/* '0': reading raw characters
	 * '1': next char is escaped
	 * 'w': reading window size
	 */
	char esc;
};

static void dump_wts_st(struct write_subproc_st *st)
{
	unsigned char *curs = st->buf;
	while (st->bufsz--) {
		if (*curs >= ' ' && *curs != '\\') putchar(*curs);
		else printf("\\%03o", *curs);

		curs++;
	}

	puts("\\<eobuff>");
	if (st->sendsigwin) printf("sigwin r=%d c=%d\n", st->swrow, st->swcol);
}

static void write_to_subproc_core(struct write_subproc_st *st)
{
	unsigned char byte;
	unsigned wi, ri, row, col;

	snprintf(argv0, argv0sz, "write_subproc-%s", logfile);

	st->sendsigwin = 0;

	wi = 0;
	for (ri = 0; ri < st->bufsz; ri++) {
		byte = st->buf[ri];

		if (byte == '\n') continue;

		switch (st->esc) {
		case '0':
			if (byte == '\\')
				st->esc = '1';
			else
				st->buf[wi++] = byte;
			break;

		case '1':
			switch (byte) {
			case 'n':
				st->buf[wi++] = '\n';
				st->esc = '0';
				break;

			case '\\':
				st->buf[wi++] = '\\';
				st->esc = '0';
				break;

			case 'w':
				st->wsi = 0;
				st->esc = 'w';
				break;

			default:
				st->esc = '0';
				warnx("unknown escape: %d\n", byte);
			}
			break;

		case 'w':
			st->winsize[st->wsi++] = byte;
			if (st->wsi != sizeof(st->winsize)) break;

			if (2 != sscanf(st->winsize, "%4u%4u", &row, &col))
				warn("invalid winsize");
			else {
				st->swrow = row;
				st->swcol = col;
				st->sendsigwin = 1;
			}
			st->esc = '0';

			break;

		default: errx(1, "unknown escape: %d", st->esc);
		}
	}

	st->bufsz = wi;
}

static _Noreturn void write_to_subproc(void)
{
	struct write_subproc_st st;
	ssize_t red;

	if (pream)
		fullwrite(master, "preamble", (unsigned char *)pream,
			  strlen(pream));
	free(pream);
	pream = NULL;

	st.esc = '0';
	while (1) {
		red = read(0, st.buf, sizeof(512));
		if (!red) exit(0);
		if (red == -1) err(1, "read from stdin");

		st.bufsz = red;
		write_to_subproc_core(&st);
		fullwrite(master, "subproc", st.buf, st.bufsz);
		if (st.sendsigwin) send_sigwinch(st.swrow, st.swcol);
	}
}

static void teetty4test(const char *s, int len)
{
	if (-1 == len) len = strlen(s);
	tee_tty_content((const unsigned char *)s, len);
}

static void test_main(void)
{
	struct write_subproc_st wts;

	puts("WRITE_TO_SUBPROC_CORE");

	puts("should ignore newline:");
	wts.esc = '0';
	strcpy((char *)wts.buf, "hello\n how are you\n");
	wts.bufsz = strlen("hello\n how are you\n");
	write_to_subproc_core(&wts);
	dump_wts_st(&wts);

	puts("empty string:");
	wts.esc = '0';
	wts.bufsz = 0;
	write_to_subproc_core(&wts);
	dump_wts_st(&wts);

	puts("missing newline:");
	wts.esc = '0';
	strcpy((char *)wts.buf, "asdf");
	wts.bufsz = strlen("asdf");
	write_to_subproc_core(&wts);
	dump_wts_st(&wts);

	puts("sending sigwinch:");
	wts.esc = '0';
	strcpy((char *)wts.buf, "about to resize...\\w00910042...all done");
	wts.bufsz = strlen((char *)wts.buf);
	write_to_subproc_core(&wts);
	dump_wts_st(&wts);

	puts("escape seqs:");
	wts.esc = '0';
	strcpy((char *)wts.buf,
	       "line one\\nline two\\nline 3 \\\\ (reverse solidus)\\n\n");
	wts.bufsz = strlen((char *)wts.buf);
	write_to_subproc_core(&wts);
	dump_wts_st(&wts);

	puts("escape seqs straddling:");
	wts.esc = '0';

	strcpy((char *)wts.buf, "line one\\nline two\\");
	wts.bufsz = strlen((char *)wts.buf);
	write_to_subproc_core(&wts);
	dump_wts_st(&wts);

	strcpy((char *)wts.buf, "nline 3 \\");
	wts.bufsz = strlen((char *)wts.buf);
	write_to_subproc_core(&wts);
	dump_wts_st(&wts);

	strcpy((char *)wts.buf, "\\ (reverse solidus)\\n\\w012");
	wts.bufsz = strlen((char *)wts.buf);
	write_to_subproc_core(&wts);
	dump_wts_st(&wts);

	strcpy((char *)wts.buf, "00140");
	wts.bufsz = strlen((char *)wts.buf);
	write_to_subproc_core(&wts);
	dump_wts_st(&wts);

	puts("TEE_TTY_CONTENT");
	loghndl = stdout;
	teetty4test("hello", -1);
	puts("pending line");
	teetty4test("\r\n", -1);
	puts("finished line");

	do {
		int i = 0;
		while (i++ < sizeof(linebuf)) teetty4test("x", 1);
		teetty4test("[exceeded]", -1);
		teetty4test("\r\n", -1);
	} while (0);

	teetty4test(
		"abcdef\b\033[K\b\033[K\b\033[Kxyz\r\n", -1);
	teetty4test("abcdef\b\r\n", -1);

	puts("move back x2 and delete to eol");
	teetty4test("abcdef\b\b\033[K\r\n", -1);

	puts("move back x1 and insert");
	teetty4test("asdf\bxy\r\n", -1);

	puts("move back and forward");
	teetty4test("asdf\b\033[C\r\n", -1);

	puts("move back x2 and forward x1, then del to EOL");
	teetty4test("asdf\b\b" "\033[C" "\033[K" "\r\n", -1);

	puts("as above, but in separate calls");
	teetty4test("asdf\b\b", -1);
	teetty4test("\033[C", -1);
	teetty4test("\033[K", -1);
	teetty4test("\r\n", -1);

	puts("move left x3, move right x2, del EOL; 'right' seq in sep calls");
	teetty4test("123 UIO\b\b\b" "\033[", -1);
	teetty4test("C" "\033", -1);
	teetty4test("[C", -1);
	teetty4test("\033[K", -1);
	teetty4test("\r\n", -1);

	puts("drop console title escape seq");
	/* https://tldp.org/HOWTO/Xterm-Title-3.html */
	teetty4test("abc\033]0;title\007xyz\r\n", -1);
	teetty4test("abc\033]1;title\007xyz\r\n", -1);
	teetty4test("123\033]2;title\007" "456\r\n", -1);

	puts("drop console title escape seq; separate calls");
	teetty4test("abc\033]0;ti", -1);
	teetty4test("tle\007xyz\r\n", -1);

	puts("bracketed paste mode");
	/* https://github.com/pexpect/pexpect/issues/669 */

	/* \r after paste mode off */
	teetty4test("before (", -1);
	teetty4test("\033[?2004l\rhello\033[?2004h", -1);
	teetty4test(") after\r\n", -1);

	/* no \r after paste mode off */
	teetty4test("before (", -1);
	teetty4test("\033[?2004lhello\033[?2004h", -1);
	teetty4test(") after\r\n", -1);

	puts("drop color and font");
	teetty4test("before : ", -1);
	teetty4test("\033[1;35mafter\r\n", -1);

	/* split between calls */
	teetty4test("before : ", -1);
	teetty4test("\033[1;", -1);
	teetty4test("35mafter\r\n", -1);

	teetty4test("before : \033[36mAfter\r\n", -1);

	teetty4test("first ;; \033[1;31msecond\r\n", -1);

	puts("\\r to move to start of line");
	teetty4test("xyz123\rXYZ\r\n", -1);

	puts("something makes the logs stop");
	teetty4test(
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
	, -1);

	puts("\\r then delete line");
	teetty4test("abc\r\033[Kfoo\r\n", -1);
}

int main(int argc, char **argv)
{
	pid_t child;
	const char *home;

	argv0 = argv[0];
	argv0sz = strlen(argv0)+1;

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

	master = posix_openpt(O_RDWR);
	if (-1 == master) err(1, "posix_openpt");
	if (-1 == grantpt(master)) err(1, "grantpt");
	if (-1 == unlockpt(master)) err(1, "unlockpt");

	parse_query();

	if (!system(dtach_check_cmd)) {
		free(pream);
		pream = NULL;
	}

	child = fork();
	if (-1 == child) err(1, "fork");

	if (!child) dtachorshell();

	child = fork();
	if (-1 == child) err(1, "fork 2");

	if (child) read_from_subproc(); else write_to_subproc();
}
