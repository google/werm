#define _XOPEN_SOURCE 600

#include <stdio.h>
#include <unistd.h>
#include <sys/types.h>
#include <stdlib.h>
#include <fcntl.h>
#include <sys/ioctl.h>
#include <err.h>

static int master;

static _Noreturn void do_exec()
{
	char *slave_name;
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

	execl("/bin/zsh", "-zsh", NULL);
	err(1, "exec");
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
			byte = *curs++;
			switch (byte) {
			case '\n': e = fputs("\\n", stdout); break;
			case '\\': e = fputs("\\\\", stdout); break;
			default: e = putchar(byte);
			}

			if (e == EOF) err(1, "putchar");
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
	_Bool escape;
	int byte;

	subprocf = fdopen(master, "w");
	if (!subprocf) err(1, "fdopen master");

	while (1) {
		b = read(0, read_buf, sizeof(512));
		if (!b) exit(0);
		if (b == -1) err(1, "read from stdin");

		curs = read_buf;
		do {
			byte = *curs++;
			if (byte == '\n') continue;
			if (byte == '\\') {
				escape = 1;
				continue;
			}

			if (escape) {
				switch (byte) {
				case 'n': byte = '\n'; break;
				case '\\': byte = '\\'; break;
				default:
					fprintf(stderr, "unknown escape: %d\n",
						byte);
				}
				escape = 0;
			}

			fputc(byte, subprocf);
		} while (--b);

		fflush(subprocf);
	}
}

int main(int argc, char **argv)
{
	pid_t child;

	master = posix_openpt(O_RDWR);
	if (-1 == master) err(1, "posix_openpt");
	if (-1 == grantpt(master)) err(1, "grantpt");
	if (-1 == unlockpt(master)) err(1, "unlockpt");

	child = fork();
	if (-1 == child) err(1, "fork");

	if (!child) do_exec();

	child = fork();
	if (-1 == child) err(1, "fork 2");

	if (child) read_from_subproc(); else write_to_subproc();
}
