/* Copyright 2023 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd */

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef int32_t		TMint;
typedef void	*	TMany;
typedef char	*	TMutf8;

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

#define argx(type, name) type name

#define fnx2(ret, name, arg1, arg2) \
	static ret name (argx arg1 , argx arg2)
#define fnx3(ret, name, arg1, arg2, arg3) \
	static ret name (argx arg1 , argx arg2 , argx arg3)
#define fnx4(ret, name, arg1, arg2, arg3, arg4) \
	static ret name (argx arg1 , argx arg2 , argx arg3 , argx arg4)

struct tmobj {
	/* If this is an allocated ID slot: Number of fields in this object.
	 * If unallocated: indicates the next unallocated ID, or ~tmobjs.capac
	 * if this is the last free one. */
	int32_t fct;

	/* Values of the fields of this object */
	int32_t *fs;
};

#define fld(id, fdx) (*fld_ptr(id, fdx))

int32_t *fld_ptr(int32_t id, int32_t fdx);
int32_t tmalloc(int32_t nfct);
int32_t tmlen(int32_t id);
void tmfree(int32_t id);

#define tmlog(...) do {				\
	fflush(stdout);				\
	fprintf(stderr,	"%s: ", __FILE__);	\
	fprintf(stderr, __VA_ARGS__);		\
	fputc('\n', stderr);			\
} while (0)

_Noreturn
static inline void tmabort(void)
{
	const char *e = getenv("WERM_TESTABORTS");
	if (e && *e) exit(1);
	abort();
}

#define sriously(...) do {tmlog("sriously: " __VA_ARGS__); tmabort();} while (0)

#define ORD(chr)	(chr)

#define tmutf8(s) (s)

static inline void fldcpy(	TMint dobj, TMint dfld,
				TMint sobj, TMint sfld, TMint qwc)
{
	if (qwc) memcpy(&fld(dobj,dfld), &fld(sobj,sfld), qwc << 2);
}

static inline void fldmov(	TMint dobj, TMint dfld,
				TMint sobj, TMint sfld, TMint qwc)
{
	if (qwc) memmove(&fld(dobj,dfld), &fld(sobj,sfld), qwc << 2);
}

#define HEXFMT		"%x"
#define HEXARG(a)	a
#define ORDAT(s, i) (((char *)(s))[i] & 0xff)

#include "teng"

static inline char *deqtostring(TMint deq, TMint byti)
{
	return ((char *)&fld(deq, deqhd(deq))) + byti;
}

#define FN0PROTO(name) static TMint name(void);
#define FN1PROTO(name) static TMint name(TMint);
#define FN2PROTO(name) static TMint name(TMint, TMint);
#define FN3PROTO(name) static TMint name(TMint, TMint, TMint);
#define FN4PROTO(name) static TMint name(TMint, TMint, TMint, TMint);
#define FN5PROTO(name) static TMint name(TMint, TMint, TMint, TMint, TMint);

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <inttypes.h>

struct {
	/* Number of elements in objel. */
	uint32_t capac;

	/* ID of the first free object, or =capac if all slots in tmobjs.objel
	 * are occupied. */
	int32_t bufsfreehead;

	struct tmobj *objel;
} tmobjs;

static struct tmobj *id2obj(int32_t id)
{
	int32_t i = ~id;
	struct tmobj *o;

	if (i < 0 || i >= tmobjs.capac) sriously("bad id: %"PRId32"\n", id);

	o = tmobjs.objel + i;
	if (o->fct < 0) sriously("unallocated id: %"PRId32"\n", id);

	return o;
}

int32_t *fld_ptr(int32_t id, int32_t fdx)
{
	struct tmobj *o = id2obj(id);

	if (fdx < 0 || fdx >= o->fct)
		sriously(	"fld %"PRId32" out of range id=%"PRId32"\n",
				fdx, id);

	return o->fs + fdx;
}

int32_t tmalloc(int32_t nfct)
{
	int32_t newid;
	uint32_t newcap;
	struct tmobj *newo;

	if (tmobjs.bufsfreehead == tmobjs.capac) {
		newcap = 3 * tmobjs.capac / 2;
		if (newcap == tmobjs.capac) newcap = tmobjs.capac + 16;
		tmobjs.objel = realloc(
			tmobjs.objel, newcap * sizeof(*tmobjs.objel));
		if (!tmobjs.objel) {
			perror("realloc");
			sriously("new capacity: %"PRIu32, newcap);
		}

		newo = tmobjs.objel + tmobjs.capac;
		do {
			newo->fct = ~++tmobjs.capac;
			newo->fs = NULL;
			newo++;
		} while (tmobjs.capac < newcap);
	}

	newid = ~tmobjs.bufsfreehead;
	newo = tmobjs.objel + ~newid;
	tmobjs.bufsfreehead = ~newo->fct;

	newo->fct = nfct;
	newo->fs = calloc(nfct, sizeof(int32_t));
	if (!newo->fs) {
		perror("calloc");
		sriously("calloc for new obj of field cnt %"PRId32"\n", nfct);
	}

	return newid;
}

int32_t tmlen(int32_t bref)
{
	if (!bref) return 0;
	return id2obj(bref)->fct;
}

void tmfree(int32_t id)
{
	struct tmobj *fro;

	if (!id) return;

	fro = id2obj(id);

	free(fro->fs);
	fro->fs = NULL;
	fro->fct = ~tmobjs.bufsfreehead;

	tmobjs.bufsfreehead = ~id;
}
