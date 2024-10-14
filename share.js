/* Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd */

/* This file is for code shared between, or potentially shared between, main.js
and attach. */

#include "tmconst"

window.wermhosttitle ||= location.host.replace(/^localhost:/, ':');

/* Encodes a regular array or Uint8Array of byte values, or an ArrayBuffer, to
base64 */
function arr64enc(arb)
{
	if (!arb.map) arb = new Uint8Array(arb);
	return btoa(new Array(...arb)
		.map(function (b) { return String.fromCharCode(b) })
		.join(''));
}

function endptid()
{
	var bi, bs, id = localStorage['endptid'];

	if (id && id.match(/^[\000-~]{8}$/)) return id;

	bs = new Uint8Array(8);
	crypto.getRandomValues(bs);

	id = [];
	for (bi = 0; bi < bs.length; bi++)
		id.push(String.fromCharCode(bs[bi] & 0x7f));

	id = id.join('');
	localStorage['endptid'] = id;
	return id;
}

(function () {
	/* Get a unique session ID. We can't use endpoint ID because that value
	is passed to other clients to identify who is connected to a session. */
	var bar, coo, exd;
	if (location.protocol != 'https:')		return;
	if (document.cookie.match(/\bwermsession=/))	return;

	bar = new Uint8Array(16);
	crypto.getRandomValues(bar);
	coo = arr64enc(bar);

	/* Expire the cookie when the server will make it expire. Just in case
	make it expire a few seconds earlier so there is no chance of us sending
	a session ID that has already expired authorization in the server. */
	exd = new Date(new Date().getTime() + 1000 * (AUTH_EXPIRE_SECONDS - 3));
	document.cookie = 'wermsession=' + coo.replace(/==*$/, '') +
		'; expires=' + exd.toGMTString();
})();

function wermuserid()
{
	return crypto.subtle.digest(
		'SHA-256', new TextEncoder().encode(wermpasskeyid));
}
