#include <stddef.h>

extern char *dtach_sock;
extern _Bool dtach_ephem;

void _Noreturn dtach_main(void);
void _Noreturn subproc_main(void);
void tee_tty_content(const unsigned char *buf, size_t len);
