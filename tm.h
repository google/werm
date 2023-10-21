/* Copyright 2023 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd */

#define WERM_C 1
#undef WERM_JS

#include <stdint.h>
#include <err.h>

typedef int32_t TMint;

#define fn0(name)			static int32_t name(void)
#define fn1(name, a0)			static int32_t name( \
	int32_t a0)
#define fn2(name, a0, a1)		static int32_t name( \
	int32_t a0, int32_t a1)
#define fn3(name, a0, a1, a2)		static int32_t name( \
	int32_t a0, int32_t a1, int32_t a2)
#define fn4(name, a0, a1, a2, a3)	static int32_t name( \
	int32_t a0, int32_t a1, int32_t a2, int32_t a3)
#define fn5(name, a0, a1, a2, a3, a4)	static int32_t name( \
	int32_t a0, int32_t a1, int32_t a2, int32_t a3, int32_t a4)

struct tmobj {
	/* If this is an allocated ID slot: Number of fields in this object.
	 * If unallocated: indicates the next unallocated ID, or ~tmobjs.capac
	 * if this is the last free one. */
	int32_t fct;

	/* Values of the fields of this object */
	uint32_t *fs;
};

#define fld(id, fdx) (*fld_ptr(id, fdx))

int32_t *fld_ptr(int32_t id, int32_t fdx);
int32_t tmalloc(int32_t nfct);
int32_t tmlen(int32_t id);
void tmfree(int32_t id);

#define sriously(...) errx(1, __VA_ARGS__);
