/* See LICENSE for license details. */

#include <ctype.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "third_party/st/b64.h"

static char
base64dec_getc(const char **src, const char *en)
{
	while (**src && !isprint((unsigned char)**src))
		(*src)++;
	return **src && *src != en
		? *((*src)++) : '=';  /* emulate padding if string ends */
}

char *
base64dec(const char *src, const char *en, unsigned* reslen)
{
	size_t in_len = en ? en - src : strlen(src);
	char *result, *dst;
	static const char base64_digits[256] = {
		[43] = 62, 0, 62, 0, 63, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61,
		0, 0, 0, -1, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
		13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 0, 0, 0, 0,
		63, 0, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
		40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51
	};

	if (in_len % 4)
		in_len += 4 - (in_len % 4);
	result = dst = malloc(in_len / 4 * 3 + 1);
	if (!result) { perror("malloc"); abort(); }
	while (*src && src != en) {
		int a = base64_digits[(unsigned char) base64dec_getc(&src, en)];
		int b = base64_digits[(unsigned char) base64dec_getc(&src, en)];
		int c = base64_digits[(unsigned char) base64dec_getc(&src, en)];
		int d = base64_digits[(unsigned char) base64dec_getc(&src, en)];

		/* invalid input. 'a' can be -1, e.g. if src is "\n" (c-str) */
		if (a == -1 || b == -1)
			break;

		*dst++ = (a << 2) | ((b & 0x30) >> 4);
		if (c == -1)
			break;
		*dst++ = ((b & 0x0f) << 4) | ((c & 0x3c) >> 2);
		if (d == -1)
			break;
		*dst++ = ((c & 0x03) << 6) | d;
	}
	*dst = '\0';
	if (reslen) *reslen = dst - result;
	return result;
}
