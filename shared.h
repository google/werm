#include <stddef.h>
#include <unistd.h>

extern char *dtach_sock;
extern _Bool dtach_ephem;

void _Noreturn dtach_main(void);
int dtach_master(void);
void _Noreturn subproc_main(void);

void clear_rout(void);
/* Puts terminal state in rout buffer to send to a client, such as whether using
 * alternate screen. */
void recount_state(void);
void process_tty_out(const void *buf, ssize_t len);
void get_rout_for_attached(const unsigned char **buf, size_t *len);

void forward_stdin(int sock);
void process_kbd(int ptyfd, unsigned char *buf, size_t bufsz);

void set_argv0(const char *role);

/* Called if the process was attached to for the first time. */
void send_pream(int fd);
