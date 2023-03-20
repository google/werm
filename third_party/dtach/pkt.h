#ifndef DTACH_PKT_H
#define DTACH_PKT_H

#include <pty.h>

enum
{
	MSG_PUSH	= 0,
	MSG_ATTACH	= 1,
	MSG_DETACH	= 2,
	MSG_WINCH	= 3,
	MSG_REDRAW	= 4,
};

/* The client to master protocol. */
struct dtach_pkt
{
	unsigned char type;
	unsigned char len;
	union
	{
		unsigned char buf[sizeof(struct winsize)];
		struct winsize ws;
	} u;
};

#endif
