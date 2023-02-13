#define _XOPEN_SOURCE 600
#define _GNU_SOURCE

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

int xasprintf(char **strp, const char *format, ...)
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

static char *dtach_check_cmd, *dtach_sock, *log, *pream;

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

			free(log);
			xasprintf(&log, "/tmp/log.%s", val);

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

#define DTACH "/bin/dtach"

static _Noreturn void do_exec()
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

	if (!dtach_sock) {
		shell = getenv("SHELL");

		execl(shell, shell, NULL);
		err(1, "execl $SHELL, which is: %s\n",
		    shell ? shell : "<undef>");
	}
	else {
		execl(DTACH, DTACH, "-A", dtach_sock,
		      "-r", "none", "script", "-qfa", log, NULL);
		err(1, "execl " DTACH);
	}
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
	int byte, e;

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

static _Noreturn void write_to_subproc(void)
{
	unsigned char read_buf[512], *curs;
	ssize_t b;
	FILE *subprocf;
	char escape, winsize[8];
	int byte, wsi, col, row;

	subprocf = fdopen(master, "w");
	if (!subprocf) err(1, "fdopen master");

	if (pream && EOF == fputs(pream, subprocf))
		warn("could not write preamble to pty: %s", pream);
	free(pream);
	pream = NULL;

	/* '0': reading raw characters
	 * '1': next char is escaped
	 * 'w': reading window size
	 */
	escape = '0';
	while (1) {
		b = read(0, read_buf, sizeof(512));
		if (!b) exit(0);
		if (b == -1) err(1, "read from stdin");

		curs = read_buf;
		do {
			byte = *curs++;

			if (byte == '\n') continue;

			switch (escape) {
			case '0':
				if (byte == '\\')
					escape = '1';
				else
					fputc(byte, subprocf);
				break;

			case '1':
				switch (byte) {
				case 'n':
					fputc('\n', subprocf);
					escape = '0';
					break;

				case '\\':
					fputc('\\', subprocf);
					escape = '0';
					break;

				case 'w':
					wsi = 0;
					escape = 'w';
					break;

				default:
					escape = '0';
					warnx("unknown escape: %d\n", byte);
				}
				break;

			case 'w':
				winsize[wsi++] = byte;
				if (wsi != sizeof(winsize)) break;

				if (2 != sscanf(winsize, "%4d%4d", &row, &col))
					warn("invalid winsize");
				else
					send_sigwinch(row, col);
				escape = '0';

				break;

			default: warnx("unknown escape: %d", escape);
			}
		} while (--b);

		fflush(subprocf);
	}
}

int main(int argc, char **argv)
{
	pid_t child;
	const char *home;

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
