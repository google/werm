#include <stddef.h>

extern char *dtach_sock;

void _Noreturn dtach_daemonized(void);
void _Noreturn subproc_main(void);
void tee_tty_content(const unsigned char *buf, size_t len);
