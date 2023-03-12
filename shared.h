#include <stddef.h>

void _Noreturn dtach_main(const char *socket);
void _Noreturn subproc_main(void);
void tee_tty_content(const unsigned char *buf, size_t len);
