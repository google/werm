#define _XOPEN_SOURCE 600
#define _GNU_SOURCE

#include "shared.h"

#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <stdlib.h>
#include <fcntl.h>
#include <sys/ioctl.h>
#include <err.h>

static int master;
static int argv0sz;
static char *argv0, *dtach_check_cmd, *dtach_sock, *logfile, *pream;


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

void subproc_main(void)
{
	execlp("script", "script", "-qfa", logfile, NULL);
	exit(1);
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

static _Noreturn void do_exec(void)
{
	char *slave_name;
	const char *shell;
	int slave;

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

	if (dtach_sock) {
		snprintf(argv0, argv0sz, "dtach-%s", logfile);
		dtach_main(dtach_sock);
	}

	shell = getenv("SHELL");

	execl(shell, shell, NULL);
	err(1, "execl $SHELL, which is: %s\n", shell ? shell : "<undef>");
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

static void write_all(unsigned char *buf, size_t sz)
{
	ssize_t writn;

	while (sz) {
		writn = write(master, buf, sz);
		if (writn < 0) err(1, "could not write to stdout");
		sz -= writn;
		buf += writn;
	}
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

	if (pream) write_all((unsigned char *)pream, strlen(pream));
	free(pream);

	pream = NULL;

	st.esc = '0';
	while (1) {
		red = read(0, st.buf, sizeof(512));
		if (!red) exit(0);
		if (red == -1) err(1, "read from stdin");

		st.bufsz = red;
		write_to_subproc_core(&st);
		write_all(st.buf, st.bufsz);
		if (st.sendsigwin) send_sigwinch(st.swrow, st.swcol);
	}
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

	if (!child) do_exec();

	child = fork();
	if (-1 == child) err(1, "fork 2");

	if (child) read_from_subproc(); else write_to_subproc();
}
