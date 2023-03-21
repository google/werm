#include <stddef.h>
#include "third_party/dtach/pkt.h"

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

void process_kbd(int sock);
