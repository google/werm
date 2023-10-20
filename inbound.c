/* Copyright 2023 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd */

#include "inbound.h"
#include <arpa/inet.h>
#include <string.h>
#include <stdint.h>
#include <stdlib.h>
#include <errno.h>
#include <stdio.h>

static unsigned char buf[512];
static unsigned bfi, bfsz;
static unsigned char pongmsg[2] = {0x8a, 0x00};

static void mkeaval(int c)
{
	ssize_t redn;
	unsigned bleft = bfsz - bfi;

	if (c > sizeof(buf)) abort();

	if (bleft >= c) return;

	bfsz = bleft;
	memmove(buf, buf+bfi, bfsz);
	bfi = 0;

	do {
		redn=read(0, buf + bfsz, sizeof(buf) - bfsz);
		if (0 > redn) {
			if (errno == EAGAIN) continue;
			perror("read stdin mid-frame");
			abort();
		}
		if (!redn) abort();
		bfsz += redn;
	}
	while (bfsz < c);
}

static unsigned char *forceinby(int c)
{
	mkeaval(c);
	bfi += c;
	return buf + bfi - c;
}

void fwrd_inbound_frames(int sock)
{
	unsigned char mask[4];
	uint64_t datalen;
	uint32_t datalen32;
	uint16_t datalen16;
	int unmaski, datpart, unmaskof;
	unsigned char *bfc;
	unsigned fragsz;

	if (bfi != bfsz) abort();

	do {
		bfc = forceinby(1);

		/* We don't care whether continuation or FIN */
		*bfc &= 0x7f;

		switch (*bfc) {
		case 0: case 1: case 2:
			/* data */

			/* Payload len */
			bfc = forceinby(1);
			datalen = *bfc & 0x7f;

			/* Should always send mask */
			if (!(*bfc & 0x80)) abort();

			/* Client should not send large frames that require
			 * extended payload length. */
			if (datalen == 126) {
				memcpy(&datalen16, forceinby(2), 2);

				datalen = ntohs(datalen16);
			}
			else if (datalen == 127) {
				memcpy(&datalen32, forceinby(4), 4);
				datalen = ntohl(datalen32);
				datalen <<= 32;

				memcpy(&datalen32, forceinby(4), 4);
				datalen |= ntohl(datalen32);
			}

			/* Read the mask */
			memcpy(mask, forceinby(4), 4);

			unmaskof = 0;
			while (datalen) {
				datpart = sizeof(buf);
				if (datpart > datalen) datpart = datalen;

				bfc = forceinby(datpart);
				for (unmaski = 0; unmaski < datpart; unmaski++) {
					bfc[unmaski] ^= mask[unmaskof++];
					unmaskof &= 3;
				}

				full_write(&(struct wrides){sock}, bfc, datpart);

				datalen -= datpart;
			}
		break;
		case 9:
			/* pinged, so respond with pong */
			full_write(&(struct wrides){1},
				   pongmsg, sizeof(pongmsg));
		break;
		default: /* close, pong, or reserved code. do nothing */
		}
	}
	while (bfi < bfsz);
}
