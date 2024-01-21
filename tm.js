/* Copyright 2023 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd */

#define TMint var
#define fn0(name)			function name()
#define fn1(name, a0)			function name(a0)
#define fn2(name, a0, a1)		function name(a0, a1)
#define fn3(name, a0, a1, a2)		function name(a0, a1, a2)
#define fn4(name, a0, a1, a2, a3)	function name(a0, a1, a2, a3)
#define fn5(name, a0, a1, a2, a3, a4)	function name(a0, a1, a2, a3, a4)

#define fnx2(r, name, a0, a1)		function name(fnxarg a0, fnxarg a1)
#define fnx3(r, name, a0, a1, a2)	function name(fnxarg a0, fnxarg a1, fnxarg a2)
#define fnx4(r, name, a0, a1, a2, a3)	function name(fnxarg a0, fnxarg a1, fnxarg a2, fnxarg a3)
#define fnxarg(t, n) n

var bufsa = [];
var bufsfreehead = -1;

#define fld(obj, ndx) (bufsa[~(obj)][ndx])

// jsobj* functions are a kludge to allow saving arbitrary objects in a buffer
// while porting is still ongoing.
#define jsobj(fld) (bufsa[~(fld)])

function jsobj_alloc(what)
{
	var i;

	if (0 > bufsfreehead) {
		i = bufsa.length;
		bufsa.push(what);
	}
	else {
		i = bufsfreehead;
		bufsfreehead = ~bufsa[bufsfreehead];
		bufsa[i] = what;
	}

	return ~i;
}

function tmalloc(size) { return jsobj_alloc(new Int32Array(size)); }

function tmlen(bref) { return bref ? bufsa[~bref].length : 0; }

function tmfree(bref)
{
	bufsa[~bref] = ~bufsfreehead;
	bufsfreehead = ~bref;
}

function sriously(...a) { throw a; }

function deqtostring(deq, byti)
{
	var ar = [], b;

	for (;;) {
		b = deqbytat(deq, byti++, -1);
		if (!b) break;
		ar.push(b);
	}

	return new TextDecoder().decode(new Uint8Array(ar));
}

#define ORD(chr) (chr).charCodeAt(0)

#define TMutf8	var
#define TMany	var

function tmutf8(s) { return new TextEncoder().encode(s); }

function tmlog(...args) { console.log(...args); }

function ORDAT(str, i) { return i == str.length ? 0 : str.charCodeAt(i); }

function fldcpy(dobj, dndx, sobj, sndx, qwc)
{
	var d, s;

	if (!qwc) return;
	d = jsobj(dobj);

	if (dobj == sobj) {
		jsobj(dobj).copyWithin(dndx, sndx, sndx + qwc);
	} else {
		s = jsobj(sobj);
		while (qwc--) d[dndx++] = s[sndx++];
	}
}

#define fldmov fldcpy

#define FN0PROTO(name)
#define FN1PROTO(name)
#define FN2PROTO(name)
#define FN3PROTO(name)
#define FN4PROTO(name)
#define FN5PROTO(name)

#define HEXFMT		+ "%s" +
#define HEXARG(a)	(a).toString(16)

#include "teng"
