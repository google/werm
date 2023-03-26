#include <stddef.h>

extern char *dtach_sock;
extern _Bool dtach_ephem;

void _Noreturn dtach_main(void);
void _Noreturn subproc_main(void);

struct raw_tty_out {
	void *buf;
	size_t len;
};
void process_tty_out(
	const unsigned char *buf, size_t len, struct raw_tty_out *rout);

void forward_stdin(int sock);
void process_kbd(int ptyfd, unsigned char *buf, size_t bufsz);

void set_argv0(const char *role);

/* Called if the process was attached to for the first time. */
void send_pream(int fd);
