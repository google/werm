/* Copyright 2023 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License. */

#include "tm.h"

#include <err.h>
#include <stdint.h>
#include <stdlib.h>
#include <inttypes.h>

static struct {
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

	if (i < 0 || i >= tmobjs.capac) errx(1, "bad id: %"PRId32, id);

	o = tmobjs.objel + i;
	if (o->fct < 0) errx(1, "unallocated id: %"PRId32, id);

	return o;
}

int32_t *fld_ptr(int32_t id, int32_t fdx)
{
	struct tmobj *o = id2obj(id);

	if (fdx < 0 || fdx >= o->fct)
		errx(1, "fld %"PRId32" out of range for obj %"PRId32, fdx, id);

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
		if (!tmobjs.objel)
			err(1, "realloc for new capac %"PRIu32, newcap);

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
	if (!newo->fs) err(1, "calloc for new obj of field cnt %"PRId32, nfct);

	return newid;
}

int32_t tmlen(int32_t bref)
{
	errx(1, "TODO");
}

void tmfree(int32_t id)
{
	struct tmobj *fro = id2obj(id);

	free(fro->fs);
	fro->fs = NULL;
	fro->fct = ~tmobjs.bufsfreehead;

	tmobjs.bufsfreehead = ~id;
}
