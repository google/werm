/* Copyright 2023 Google LLC

 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd */

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
