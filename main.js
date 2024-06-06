#include "endptid.js"
#include "tm.js"
#include "third_party/st/tmeng"
#include "third_party/st/tmengui"

window["extended_macros"] = {}

function Xsetpointermotion(set) {}

function Xbell() {}

function Xsetcolor(trm, pi, rgb) {/* no-op */}

function Now(ms)
{
	var n = (new Date()).getTime();

	/* Use arithmetic division rather than >> 31 to avoid using 32-bit
	   two's complement operations. */
	fld(ms,0) = n / 0x80000000;
	fld(ms,1) = n & 0x7fffffff;
}

function Xosc52copy(trm, deq, byti)
{
	var s = new TextDecoder().decode(new Uint8Array(
		atob(deqtostring(deq, byti))
			.split('')
			.map(function(ch) { return ch.charCodeAt(0); })));
	navigator.clipboard.writeText(s);
}

var	t, tel, gl, gwid, ghei, cops, ftd, ftx, vbu, shpr, dw, dh,
	fontfgrgb,
	fontbgrgb,
	selecting, mdownstam,
	cli0,
	tex0,
	mask,
	clicoor,
	clipixw,
	clipixh,
	celpxsz,
	texpxsz,
	log_matching,
	log_send,
	log_display,
	log_keys,
	log_mn,
	log_macks,
	log_packin, capsonwhile, topr = deqmk(),
	term_ready,
	sock,
	pend_send = [],
	pend_display = [],
	pend_escape = '', termid,
	params, dead_key_hist, keep_row_ttl, row_ttl, locked_ttl, host,
	repeat_cnt, repsignal, repeat_boxes = [], macro_map,
	barrier_dig = [], barrdiv, font_key,
	got_key_up = false, matching = [], macro_winpos, notitout;

function notice(str)
{
	var	x = 0, scra = term_cellf(t, term(t,row), 0), scr = term(t,scr);

	fld(scr,scra+GLYPH_BG)		= 0x12222ff;
	fld(scr,scra+GLYPH_FG)		= 0x1ffffff;
	fld(scr,scra+GLYPH_MODE)	= ATTR_UNDERLINE;

	for (;;) {
		if (x == term(t,col))	break;
		fld(scr,scra+GLYPH_RUNE) =
			x < str.length ? str.charCodeAt(x) : 0x20;
		Xdrawglyph(t, scra, x++, 0);
	}

	if (notitout) window.clearTimeout(notitout);
	notitout = window.setTimeout(function()
	{
		tsetdirt(t, 0, 0);
		draw(t);
		notitout = 0;
	}, 2000);

	gl.flush();
}

function imposetsize()
{
	var	rc = 0 | dh/ghei,
		cc = 0 | dw/gwid;

	/* This means ghei or gwid is not set */
	if (!rc || !cc) return;

	tresize(t, cc, rc);
	signal(	'\\w'				+
		rc.toString().padStart(4, '0')	+
		cc.toString().padStart(4, '0')	);
}

function adjust()
{
	dw = 0 | window.devicePixelRatio*tel.clientWidth;
	dh = 0 | window.devicePixelRatio*tel.clientHeight;

	clipixw		= 2/dw	;
	clipixh		= 2/dh	;

	tel.width	= dw	;
	tel.height	= dh	;

	gl.uniform2f	(cliclsz,	clipixw,	-clipixh);
	gl.uniform1f	(texpxsz,	+1/ftd);

	gl.viewport(0, 0, dw, dh);
	gl.clearColor(0, 0, 0, 1);
	gl.clear(gl.COLOR_BUFFER_BIT);

	imposetsize();
	if (barrdiv) updatebarrdivcw();
}

function term4cli()
{
	term(t,noresponse) = 1;
	term(t,mode) |=	MODE_FOCUSED;
	term(t,cw) = gwid;
	term(t,ch) = ghei;
}

function term_canv()
{
	t = term_new();
	tnew(t, 80, 25);

	tel = document.createElement('canvas');
	tel.style.position	= "absolute";
	tel.style.width		= "100%";
	tel.style.height	= "100%";
	tel.style.left		= 0;
	tel.style.top		= 0;

	document.body.appendChild(tel);

	gl = tel.getContext('webgl2', {preserveDrawingBuffer: true});

	set_font(4);
}

var	deffg = defaultpalette(DEFAULTFG),
	defbg = defaultpalette(DEFAULTBG);

function unpackclr(c, rv)
{
	var ci;

	if (rv) {
		if	(c == DEFAULTBG) { c = DEFAULTFG; rv = 0 }
		else if	(c == DEFAULTFG) { c = DEFAULTBG; rv = 0 }
	}

	if (!IS_TRUECOL(c)) {
		ci = c;

		c = fld(term(t,palt),c);

		if (ci == DEFAULTFG && c == deffg) c = fontfgrgb;
		if (ci == DEFAULTBG && c == defbg) c = fontbgrgb;

		if (rv) c=~c;
	}

	return [(c >> 16	& 0xff) / 0xff,
		(c >> 8		& 0xff) / 0xff,
		(c		& 0xff) / 0xff];
}

var unkcops = new Map();

function Xdrawglyph(trm, scri, c, r)
{
	var cel, copd, wide, xoff, yoff, rv, eglymod,
		scr = term(trm,scr),
		cop = fld(scr,scri), copcou, mbit, maskval;

	if (!cop) return;

	copd = cops.get(cop);
	if (copd === undefined) {
		copcou = unkcops.get(cop) || 0;
		unkcops.set(cop, 1+copcou);
		if (!copcou)
			console.log(	`unknown cop: 0x${cop.toString(16)}, ` +
					`i.e. ${String.fromCodePoint(cop)}`);
		maskval = cop == 0x20 || cop == 0x3000 ? 256 : ~cop;
		wide = charwi(cop);
		xoff = yoff = 0;
	} else {
		wide = copd >>> 31 ? 2 : 1;
		mbit = copd >>> 28 & 0x0007;
		yoff = copd >>> 14 & 0x7fff;
		xoff = copd >>> 00 & 0x7fff;

		maskval = 1 << mbit;
	}

	rv = term(trm,mode) & MODE_REVERSE;

	eglymod = fld(scr,scri+GLYPH_MODE);
	if (selected(trm, c, r)) eglymod ^= ATTR_REVERSE;

	gl.uniform1i	(mask,		maskval);
	gl.uniform1i	(glymode,	eglymod);
	gl.uniform2f	(cli0,		-1 + c*gwid*clipixw,
					+1 - r*ghei*clipixh);
	gl.uniform2f	(celpxsz,	gwid * wide,
					ghei);
	gl.uniform2f	(tex0,		xoff, yoff);
	gl.uniform3fv	(fgcolor,	unpackclr(fld(scr,scri+GLYPH_FG), rv));
	gl.uniform3fv	(bgcolor,	unpackclr(fld(scr,scri+GLYPH_BG), rv));

	gl.bindBuffer(gl.ARRAY_BUFFER, vbu);
	gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
}

function Xdrawline(trm, x1, y1, x2)
{
	var celi = term_cellf(trm, y1, x1), x;

	for (x = x1; x < x2; x++, celi += GLYPH_ELCNT)
		Xdrawglyph(trm, celi, x, y1);
}

function Xdrawrect(col, x, y, w, h)
{
	if (!gl) return;

	gl.uniform1i	(glymode,	0);
	gl.uniform1i	(mask,		0);
	gl.uniform2f	(cli0,		-1 + x*clipixw,
					+1 - y*clipixh);
	gl.uniform2f	(celpxsz,	w, h);
	gl.uniform3fv	(bgcolor,	unpackclr(col));

	gl.bindBuffer(gl.ARRAY_BUFFER, vbu);
	gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
}

function Xfinishdraw(trm)	{ gl.flush(); updaterepboxs(0, 1, 0, 0); }

function Xximspot(trm, cx, cy)	{ /*console.log('Xximspot', trm, cx, cy);*/}

function Xsettitle(s, t)
{
	console.log('Xsettitle', s ? deqtostring(s, t) : '<default title>');
}

function Xicontitl(s, t)
{
	console.log('Xicontitl', s ? deqtostring(s, t) : '<default title>');
}

var native_to_mn = {
	'Escape':		'es',
	'F1':			'f1',
	'F2':			'f2',
	'F3':			'f3',
	'F4':			'f4',
	'F5':			'f5',
	'F6':			'f6',
	'F7':			'f7',
	'F8':			'f8',
	'F9':			'f9',
	'F10':			'fA',
	'F11':			'fB',
	'F12':			'fC',
	'PrintScreen':		'sr',
	'Pause':		'pa',
	'Enter':		'en',
	'Minus':		'- ',
	'Equal':		'= ',
	'Backspace':		'bs',
	'Tab':			'ta',
	'KeyA':			'A ',
	'KeyB':			'B ',
	'KeyC':			'C ',
	'KeyD':			'D ',
	'KeyE':			'E ',
	'KeyF':			'F ',
	'KeyG':			'G ',
	'KeyH':			'H ',
	'KeyI':			'I ',
	'KeyJ':			'J ',
	'KeyK':			'K ',
	'KeyL':			'L ',
	'KeyM':			'M ',
	'KeyN':			'N ',
	'KeyO':			'O ',
	'KeyP':			'P ',
	'KeyQ':			'Q ',
	'KeyR':			'R ',
	'KeyS':			'S ',
	'KeyT':			'T ',
	'KeyU':			'U ',
	'KeyV':			'V ',
	'KeyW':			'W ',
	'KeyX':			'X ',
	'KeyY':			'Y ',
	'KeyZ':			'Z ',
	'BracketLeft':		'[ ',
	'BracketRight':		'] ',
	'Space':		'sp',
	'AltLeft':		'la',
	'AltRight':		'ra',
	'Digit0':		'0 ',
	'Digit1':		'1 ',
	'Digit2':		'2 ',
	'Digit3':		'3 ',
	'Digit4':		'4 ',
	'Digit5':		'5 ',
	'Digit6':		'6 ',
	'Digit7':		'7 ',
	'Digit8':		'8 ',
	'Digit9':		'9 ',
	'Backslash':		'vs',	/* Reverse solidus */
	'ShiftLeft':		'ls',
	'ShiftRight':		'rs',
	'CapsLock':		'cl',
	'MetaLeft':		'lw',
	'MetaRight':		'rw',
	'Quote':		'" ',
	'ContextMenu':		'me',
	'ControlLeft':		'lc',
	'ControlRight':		'rc',
	'Comma':		', ',
	'Period':		'. ',
	'Slash':		'/ ',
	'Backquote':		'` ',
	'ScrollLock':		'sl',
	'Home':			'ho',
	'End':			'nd',
	'Delete':		'de',
	'PageUp':		'pu',
	'PageDown':		'pd',
	'Insert':		'in',
	'ArrowUp':		'up',
	'ArrowDown':		'do',
	'ArrowLeft':		'le',
	'ArrowRight':		'ri',
	'NumLock':		'#l',
	'NumpadDivide':		'#/',
	'NumpadSubtract':	'#-',
	'NumpadMultiply':	'#*',
	'NumpadAdd':		'#+',
	'NumpadEnter':		'#e',
	'NumpadDecimal':	'#.',
	'Numpad0':		'#0',
	'Numpad1':		'#1',
	'Numpad2':		'#2',
	'Numpad3':		'#3',
	'Numpad4':		'#4',
	'Numpad5':		'#5',
	'Numpad6':		'#6',
	'Numpad7':		'#7',
	'Numpad8':		'#8',
	'Numpad9':		'#9',
	'Semicolon':		'; ',
	'IntlRo':		'j1',
	'IntlYen':		'j7',
	'BrowserForward':	'bf',
};

// BEGIN deadkey_map
// left and right shift and left and right ctrl can be configured to insert a
// string if they are pressed without any other key.
// The string to insert is the second element of each entry in deadkey_map.
// These are empty strings in the released code. Customize them below.
// Note that pressing or releasing any of these four keys does not count as
// "press[ing] any other key" as above. So you can chain these
// quickly if required, e.g.
//     press left shift, (press or depress a ctrl key), release left shift
// will activate the left shift dead key behavior.
var deadkey_map = [
	// left shift
	[/Dls.?(rs|rc|lc)?Uls$/, ''],

	// right shift
	[/Drs.?(ls|rc|lc)?Urs$/, ''],

	// left ctrl
	[/Dlc.?(rc|rs|ls)?Ulc$/, ''],

	// right ctrl
	[/Drc.?(lc|rs|ls)?Urc$/, ''],
];
// END deadkey_map

var wermcfg = {};

// BEGIN pass_ctrl_L
// set this to truthy to not intercept Ctrl+L. This allows jumping to the
// address bar with the keyboard. You may also want to add an entry to macro_map
// to send Ctrl+L to the terminal when you need to do something like refresh or
// redraw the screen:
// var macro_map = [
//   'ralsL ': '\014',
//   ...
// ];
// Note this is not generic such that you can pass arbitrary codes like ^@ as
// some are processed by the below code in different paths, some are not a
// browser shortcut at all, and some would cause trouble if the browser
// processed it, such as Ctrl+A.
wermcfg.pass_ctrl_L = 0;
// END pass_ctrl_L

// BEGIN menu_key_inserts
// String to insert when pressing the ContextMenu (mnemonic: 'me') key.
var menu_key_inserts = '';
// END menu_key_inserts

// BEGIN remap_keys
// Set to an array to tweak or redefine the keyboard remapping. Each item in
// the array is an array of two elements. The first element is a regex that will
// match the 2-char mnemonic for a key. The second element is a plain JS object
// which maps characters to different strings to type when that character is
// pressed.  For instance, you can remap 9 and 0 keys such that the parenthesis
// are input without shift, and the numbers are input with shift, in which case
// you would have a line in a profile's JS which looks like this:
// remap_keys = [[/[09] /, {'9': '(', '0': ')', '(': '9', ')': '0'}]];
// Note that the above mnemonic regex is selectively written such that the
// numpad keys are not affected. To remap based on multiple regexes, you would
// use something like this:
//
// remap_keys = [[/[0-9] /: {...}],
//               [/#./: {...}]]
//
// in which case, the items in the first map would redefine the number row, and
// the items in the second map would redefine the numpad keys. If you do not
// need to distinguish keys that insert the same character, you can just use
// single map with a regex of /../
// Note that this can only remap keys that usually insert a character.
var remap_keys = [];
// END remap_keys

// BEGIN basic_git_macros
// Whether to enable a handful basic of Git macros. Defaults to yes; set to 0
// to disable them.
wermcfg.basic_git_macros = 1;
// END basic_git_macros

// BEGIN basic_vim_macros
// Whether to enable a handful basic of Vim macros. Defaults to yes; set to 0
// to disable them.
wermcfg.basic_vim_macros = 1;
// END basic_vim_macros

function sanit(s)
{
	var e = [], c, ci;

	for (ci = 0; ci < s.length; ci++) {
		c = s.charAt(ci);
		if (c === '\\') e.push('\\\\');
		else if (c === '\n') e.push('\\n');
		else e.push(c);
	}

	return e.join('');
}

function cookev(e)
{
	var mn, ce;

	mn = native_to_mn[e.code];
	if (!mn) {
		console.error('no mn available');
		console.log(e);
		mn = "??";
	}

	ce = {
		mn:		mn,
		type:		e.type,
		key:		e.key,
		ctrlKey:	e.ctrlKey,
		metaKey:	e.metaKey,
		altKey:		e.altKey,
		shiftKey:	e.shiftKey,
	};
	if (log_mn) console.log(ce);
	return ce;
}

#define REPEAT_BOX_CNT 8

function updaterepboxs(sz, newpo, o, st, en)
{
	var bs = repeat_boxes;

	if (en === undefined) en = REPEAT_BOX_CNT;

	function newbox(bi)
	{
		var b = document.createElement('div');

		b.style.position	= 'absolute';
		b.style.borderColor = `hsl(
			${bi*5%REPEAT_BOX_CNT/REPEAT_BOX_CNT * 360},
			90%, 50%)`
		b.style.borderStyle	= 'solid';
		b.style.pointerEvents	= 'none';
		b.style.visibility	= 'hidden';

		document.body.appendChild(b);

		return b;
	}

	while (bs.length < REPEAT_BOX_CNT) bs.push(newbox(bs.length));

	bs.forEach(function(b, bi)
	{
		var cw, ch, cx, cy, lyr = bi+1, s;

		if (bi < st || bi >= en) return;

		s = b.style;
		if (o == -1)	s.visibility='hidden';
		else if (o)	s.visibility='visible',s.opacity=o;

		if (!newpo && !sz) return;

		cw =		term(t,cw);
		ch =		term(t,ch);
		cx = curs_x(	term(t,curs));
		cy = curs_y(	term(t,curs));

		s.left			= `${cw * (cx - lyr * 5)}px`;
		s.top			= `${ch * (cy - lyr * 5)}px`;

		if (sz) {
			s.width		= `${cw * (lyr * 10 - 1)}px`;
			s.height	= `${ch * (lyr * 10 - 1)}px`;
			s.borderBottomWidth	= `${ch}px`;
			s.borderTopWidth	= `${ch}px`;
			s.borderLeftWidth	= `${cw}px`;
			s.borderRightWidth	= `${cw}px`;
		}
	});
}

function currowtext()
{
	var d = deqmk(), s;

	d = tpushlinestr(t, d, curs_y(term(t,curs)));
	s = deqtostring(d, 0);

	tmfree(d);
	return s;
}

function set_locked_title(type)
{
	var ttl, rc, rd, ri;

	switch (type) {
	case 'b':
		/* Bottom non-empty row */
		rc = term(t,row);
		rd = deqmk();
		ri = rc;
		while (ri && !deqbytsiz(rd))
			rd = tpushlinestr(t, rd, --ri);
		ttl = deqtostring(rd, 0);
		tmfree(rd);
		break;
	case 'c':
		/* Current row */
		ttl = currowtext();
		break;
	}
	if (ttl) signal('\\t' + ttl + '\n');
}

function unlock_title()
{
	signal('\\t\n');
	set_title();
}

function set_title()
{
	var compons;

	compons = [];
	if (termid) compons.push(`[${termid}]`);

	if (!locked_ttl) row_ttl = currowtext() || row_ttl;

	if (row_ttl) compons.push(row_ttl);
	compons.push(host);

	document.title = compons.join(' | ');
}

function loadauxjs(spec)
{
	var el, url;

	el = document.createElement('script');
	url = '/aux.js?' + spec;
	el.setAttribute('src', url);
	el.addEventListener('load', function() {
		var k, mels;
		for (k in window.extended_macros) {
			mels = window.extended_macros[k];
			while (mels.length) macro_map.push(mels.pop());
		}
	});
	document.body.appendChild(el);

	macro_map.push(['laO P J S ', function()
	{
		window.open(url);
	}]);
}

function display(s)
{
	var next_esc, pend_i, c, pend_remain, nli, escpylo, coldex,
		esclen, toesc;

	function pend(di) { return pend_display[pend_i + di]; }
	function is_utf_trail(di) {
		if (0x80 == (pend(di) & 0xc0)) return true;
		console.warn('not a utf8 trailing byte in print data');
		tputc(t, ORD('?'));
		draw(t);
		return false;
	}

	function hex_val(i)
	{
		var c = s.charAt(i);
		if (c >= '0' && c <= '9') return s.charCodeAt(i) - 48;
		if (c >= 'a' && c <= 'f') return s.charCodeAt(i) - 87;
		throw `invalid hex at ${i} in ${s}: ${c}`
	}

	if (log_display) {
		console.log('display:', encodeURI(s));
		if (log_display > 1) console.trace();
	}

	if (pend_escape) {
		s = pend_escape + s;
		pend_escape = '';
	}

	while (true) {
		next_esc = s.indexOf('\\');
		if (next_esc === -1) next_esc = s.length;
		/* |toesc| check below is to not allow empty strings
		   onto pend_display, as we would otherwise be unable to
		   interpret utf-8 multibyte chars later on, as these
		   must be contiguous byte values in the array. We don't
		   want dtach and related stuff to become utf-8 aware so
		   we handle that awkardness here. */
		if (next_esc > 0) {
			toesc = s.substr(0, next_esc)
				.replaceAll('\n', '');
			if (toesc) pend_display.push(toesc);
			s = s.substr(next_esc);
		}

		if (!s) break;

		nli = s.indexOf('\n');
		if (nli == -1) {
			// Escape may be incomplete, since we haven't
			// received a full line from the server.
			pend_escape = s;
			break;
		}

		if (s.startsWith('\\@')) {
			coldex = s.indexOf(':');
			escpylo = s.substring(coldex+1, nli);
			esclen = nli + 1;
		} else esclen = 3;

		if (s.startsWith('\\@state:')) {
			escpylo		= JSON.parse(escpylo);
			bufsa		= escpylo.bs;
			bufsfreehead	= escpylo.fh;
			t		= escpylo.t;
			term4cli();
			topr		= deqmk();
			bufsa.forEach(function(a, ai)
			{
				if (typeof a == 'object')
					bufsa[ai] = new Int32Array(a);
			});
		}
		else if (s.startsWith('\\@title:')) {
			row_ttl = escpylo;
			locked_ttl = !!row_ttl;
			set_title();
		}
		else if (s.startsWith('\\@auxjs:')) {
			loadauxjs(escpylo);
		}
		else if (s.startsWith('\\@appendid:')) {
			termid += escpylo;
			history.replaceState(
				{}, '', '/?termid=' + termid);
		}
		else
			pend_display.push(hex_val(1) * 16 + hex_val(2));

		s = s.substr(esclen);
	}

	if (!term_ready) return;

	for (pend_i = 0; pend_i < pend_display.length; pend_i++) {
		if (typeof pend(0) === 'string') {
			topr = deqpshutf8(topr, pend(0), -1);
			continue;
		}

		if (pend(0) < 0x80) {
			topr = deqpushbyt(topr, pend(0));
			continue;
		}

		c = 0;
		pend_remain = pend_display.length - pend_i;
		if (pend_remain < 2) break;
		if (!is_utf_trail(1)) continue;
		c += pend(1) & ~0xc0;

		if (0xc0 == (pend(0) & 0xe0)) {
			c += (pend(0) & ~0xe0) << 6;
			topr = deqpushcop(topr, c);
			pend_i+=1;
			continue;
		}

		c <<= 6;
		if (pend_remain < 3) break;
		if (!is_utf_trail(2)) continue;
		c += pend(2) & ~0xc0;

		if (0xe0 == (pend(0) & 0xf0)) {
			c += (pend(0) & ~0xf0) << 12;
			topr = deqpushcop(topr, c);
			pend_i+=2;
			continue;
		}

		c <<= 6;
		if (pend_remain < 4) break;
		if (!is_utf_trail(3)) continue;
		c += pend(3) & ~0xc0;

		if (0xf0 == (pend(0) & 0xf8)) {
			c += (pend(0) & ~0xf8) << 18;
			topr = deqpushcop(topr, c);
			pend_i+=3;
			continue;
		}

		console.warn('not a valid utf8 sequence');
		topr = deqpushbyt(topr, ORD('?'));
	}

	twrite(t, topr, -1, 0);
	draw(t);
	deqclear(topr);

	pend_display = pend_display.slice(pend_i);

	if (locked_ttl || keep_row_ttl) return;

	set_title();
	keep_row_ttl = setTimeout(function()
	{
		keep_row_ttl = null;
		set_title();
	}, 2000);
}

function prepare_sock()
{
	sock = new WebSocket(
		location.origin.replace(/^http/, 'ws') + '/' + location.search);
	/* signalsize implicitly sends pending sends that have
	   accumulated while disconnected. */
	sock.onopen = function() { signal('\\i' + endptid()); imposetsize() };

	sock.onmessage = function(e) {
		if (log_packin)
			console.log(`packet in ${e.data.length} chr(s)`,
				    [e.data]);
		display(e.data);
	};

	sock.onclose = function(e)
	{
		var mtxt = '[lost connection to server]';
		display(mtxt + mtxt.replaceAll(/./g, '\\08') + '\n');
	};
}

function signal(s)
{
	var s;

	pend_send.push(s);
	if (sock.readyState >	WebSocket.OPEN) prepare_sock();
	if (sock.readyState !=	WebSocket.OPEN) return;

	while (pend_send.length) {
		s = pend_send[0];
		if (log_send) {
			console.log('request send:', encodeURI(s));
			if (log_send > 1) console.trace();
		}
		sock.send(s);
		pend_send.splice(0, 1);
	}
}

function open_child_term()
{
	var nid = '';
	if (termid)
		nid = encodeURIComponent(termid.replace(/\..*$/, ''));
	window.open('/?termid=' + nid);
}

function push_dead_key_hist(e)
{
	switch (e.type) {
	case 'keydown':	dead_key_hist.push('D'); break;
	case 'keyup':	dead_key_hist.push('U'); break;
	default:	dead_key_hist.push('?');
	}

	dead_key_hist.push(e.mn);
}

function process_key_down(e)
{
	var ch, pref;

	remap_keys.forEach(function(rel)
	{
		var remch;
		if (e.mn.match(rel[0])) remch = rel[1][e.key];
		if (remch) e.key = remch;
	});

	if (e.altKey) return false;

	pref = e.metaKey ? '\x1b' : '';

	if (e.shiftKey && e.ctrlKey) {
		switch (e.mn) {
		case '2 ': signal(pref + '\x00'); return true;
		case '6 ': signal(pref + '\x1e'); return true;
		}
		return false;
	}

	if (e.key.length !== 1) {
		if (e.ctrlKey) {
			switch (e.mn) {
			case 'bs':	/* consume or else it makes a mess */	return true;
			case 'de':	/* consume or else it makes a mess */	return true;
			case 'me':	signal(pref + '\x1f');			return true;
			default:						return false;
			}
		}

		if (e.shiftKey) {
			switch (e.mn) {
			case 'bs': signal(pref + '\x17');		return true;	/* C+W */
			case 'en': signal(pref + '\x0e');		return true;	/* C+N */
			case 'ta': signal(pref + '\x1b\x5b\x5a');	return true;
			case 'pu':					return true;
			case 'pd':					return true;
			case 'ho':					return true;
			case 'nd':					return true;
			case 'up':					return true;
			case 'do':					return true;
			case 'le':					return true;
			case 'ri':					return true;
			default:					return false;
			}
		}

		switch (e.mn) {
		case 'up': signal(pref + '\\^');	return true;
		case 'do': signal(pref + '\\v');	return true;
		case 'ri': signal(pref + '\\>');	return true;
		case 'le': signal(pref + '\\<');	return true;
		case 'nd': signal(pref + '\\e');	return true;
		case 'ho': signal(pref + '\\h');	return true;
		case 'in': signal(pref + '\x1b[2~');	return true;
		case 'de': signal(pref + '\x1b[3~');	return true;
		case 'pu': signal(pref + '\x1b[5~');	return true;
		case 'pd': signal(pref + '\x1b[6~');	return true;
		case 'en': signal(pref + '\r');		return true;
		case 'bs': signal(pref + '\177');	return true;
		case 'es': signal(pref + '\x1b');	return true;
		case 'ta': signal(pref + '\t');		return true;
		case 'me':
			signal(pref + menu_key_inserts);
			return true;
		default:				return false;
		}
	}

	if (e.ctrlKey) {
		ch = e.key.charCodeAt(0);

		// Allow {|}~ and <DEL> and everything below space in
		// ascii(7) to pass to default browser behavior.
		if (ch >= 0173 || ch < 0100) return false;

		// Convert lowercase to upper.
		if (ch >= 0141) ch -= 040;

		// Shift key with alphabetic chars should pass.
		// Note the below check doesn't match if ch is capital
		// because of the caps lock key and not shift.
		if (e.shiftKey && ch >=0101 && ch <=0132) return false; 

		// Convert raw character to ctrl code.
		ch -= 0100;

		if (ch == 014 && wermcfg.pass_ctrl_L && pref == '')
			return false;

		signal(sanit(pref + String.fromCharCode(ch)));
		return true;
	}

	ch = e.key;
	if (capsonwhile) ch = ch.toUpperCase();

	signal(sanit(pref + ch));
	return true;
}

function set_default_font(ndx)
{
	set_font(ndx);
	set_default_font = function() {};
}

function evrow(e) { return 0 | e.clientY/ghei*window.devicePixelRatio }
function evcol(e) { return 0 | e.clientX/gwid*window.devicePixelRatio }
function ecoor(e) { return `${evcol(e)}:${evrow(e)}` }

function docopy(deq)
{
	var s = deqtostring(deq,0);

	if (navigator.clipboard.writeText) {
		navigator.clipboard.writeText(s);
		notice('copied; to paste: right-click or "ra5 ra" macro');
	} else {
		console.log('Clipboard not found, cannot copy:', s);
		notice("error; see browser's Javascript console");
	}
}

function readywindow()
{
	if (term_ready) return;
	term_ready=1;

	window.onresize = function(e) {	adjust(); redraw(t); };
	window.onblur = function(e)
	{
		term(t,mode) &= ~MODE_FOCUSED;
		draw(t);
	};
	tel.onmousedown = function(e)
	{
		if (0 == (e.buttons & 3)) return;

		/* !selecting		mouse button not down
		   selecting==1		moved mouse after mousedown
		   selecting==ecoor(e)	did not move mouse since mousedown */
		selecting = ecoor(e);
		mdownstam = e.timeStamp;

		click2sel(t, evrow(e), evcol(e), 1&e.buttons);
		draw(t);
	};
	tel.onmouseup = function(e)
	{
		var sq;

		if (!selecting) return;
		if (selecting != 1 && !term(t,selsnap)) {
			/* Did not move mouse while button was down, and user is
			   not double-clicking. */
			if (e.button == 2) dopaste();
			return;
		}
		selecting = 0;

		selextend(t,	evcol(e),
				evrow(e), term(t,seltype), 1);
		draw(t);

		if (!(sq = getsel(t))) return;
		docopy(sq);
		tmfree(sq);
	};
	tel.onmousemove = function(e)
	{
		var st, i;

		if (0 == (e.buttons & 3)) return;

		/* If the window is gaining focus, Chromium sometimes gives a
		   mousemove event right after mousedown, despite not actually
		   moving the mouse. Ignore such a mousemove event. */
		if (selecting == ecoor(e) && 1500 > e.timeStamp - mdownstam)
			return;
		selecting = 1;

		st = e.buttons & 2	? SEL_RECTANGULAR
					: SEL_REGULAR;

		selextend(t, evcol(e), evrow(e), st, 0);
		draw(t);
	};
	window.onfocus = function(e)
	{
		term(t,mode) |= MODE_FOCUSED;
		draw(t);
	};
}

function set_font(ndx)
{
	var fr = new XMLHttpRequest();

	fr.open('GET', `/${ndx}.wermfont`, true);
	fr.responseType = 'arraybuffer';

	fr.onload = function(ev)
	{
		var	ab = fr.response, bar, gcon, bi = 0, cop, wide, fg, bg,
			mbit = 0, xoff = 0, yoff = 0, gwidedwid, 	vshdr,
									fshdr;
		if (!ab) { console.error('could not load font data'); return; }

		cops = new Map();

		bar = new Uint8Array(ab);
		gwid	= bar[bi++];
		ghei	= bar[bi++];
		gcon	= bar[bi++]<<8
			| bar[bi++];
		ftd	= bar[bi++]<<8
			| bar[bi++];
		bg	= bar[bi++];
		fg	= bar[bi++];

		term4cli();
		fontbgrgb = TRUECOLOR(bg,bg,bg);
		fontfgrgb = TRUECOLOR(fg,fg,fg);

		for (;;) {
			if (!gcon--) break;

			cop	= bar[bi++]<<16
				| bar[bi++]<<8
				| bar[bi++];
			wide = (cop &	0x800000) && 1	;
			cop &= ~	0x800000	;

			gwidedwid = gwid << wide;
			if (ftd < xoff + gwidedwid) {
				xoff = 0;
				yoff += ghei;
				if (yoff + ghei > ftd) {
					yoff = 0;
					mbit++;
				}
			}
			cops.set(cop,	wide<<31 |
					mbit<<28 |
					yoff<<14 |
					xoff);
			xoff += gwidedwid;
		}

		bar = bar.subarray(bi);
		if (bar.length != ftd * ftd) {
			console.log(	'texture data wrong sz=%d, ftd=%d:',
					bar.length, ftd);
		}
		ftx = gl.createTexture();

		gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
		gl.bindTexture(gl.TEXTURE_2D, ftx);

		gl.texImage2D(
			gl.TEXTURE_2D,
			/*level=*/		0,
			/*internalFormat=*/	gl.R8UI,
			ftd, ftd,
			/*(must be 0) border=*/	0, 
			/*format=*/		gl.RED_INTEGER,
			/*type=*/		gl.UNSIGNED_BYTE,
			bar,
		);
		gl.texParameteri(
			gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
		gl.texParameteri(
			gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);

		vshdr = gl.createShader(gl.VERTEX_SHADER);
		fshdr = gl.createShader(gl.FRAGMENT_SHADER);
		shpr = gl.createProgram();
		gl.shaderSource(vshdr,
`#version 300 es
precision mediump float;

in	vec2	clicoor;
uniform	vec2	cli0;
uniform	vec2	cliclsz;
uniform vec2	celpxsz;
uniform	vec2	tex0;
uniform float	texpxsz;
out 	vec2	texcoor;

void main()
{
	vec2	celloff = clicoor * celpxsz;

	gl_Position	= vec4(	celloff * cliclsz + cli0, 0, 1);

	texcoor		=	celloff * texpxsz + tex0 * texpxsz;
}
`);
		gl.shaderSource(fshdr,
`#version 300 es
precision mediump float;

uniform int	glymode;
uniform	int	mask;
uniform vec3	bgcolor;
uniform vec3	fgcolor;
uniform	vec2	tex0;
in	vec2	texcoor;
out	vec4	fragColor;
uniform vec2	celpxsz;
uniform float	texpxsz;

uniform	lowp	usampler2D tex;

int texp(int xof)
{
	float xco = texcoor.x + float(xof) * texpxsz;
	int pd;

	pd = xco<tex0.x*texpxsz	? 0
				: int(texture(tex, vec2(xco, texcoor.y)).r);

	return mask & pd;
}

int hshp(int xof)
{
	int hx, hy, bs, bc = 0;

	hx = int(texcoor.x / texpxsz) + xof;
	hy = int(texcoor.y / texpxsz);

	if (hx < 0)	return 0;
	if (hx == 0)	return hy & 1;
	if (hy == 0)	return hx & 1;
	if (hx >= int(celpxsz.x) - 1)	return ~hy & 1;
	if (hy >= int(celpxsz.y) - 1)	return ~hx & 1;
	hx >>= 1;
	hy >>= 1;
	bs = mask * 97 ^ hx * 2957 ^ hy * 4129;
	bs &= 0x7f;
	while (bs != 0) {
		bs &= (bs - 1);
		bc++;
	}
	return (bc >= 4) ? 1 : 0;
}

int renp(int xof)
{
	int p = mask >= 0 ? texp(xof) : hshp(xof);

	if (p != 0) p = 1;

	return p;
}

void main()
{
	vec3 acfg, acbg;
	int faint = 0;

	if (0 != (glymode & ATTR_REVERSE)) {
		acfg = bgcolor;
		acbg = fgcolor;
	} else {
		acbg = bgcolor;
		acfg = fgcolor;
	}

	if (	0 != (glymode&ATTR_UNDERLINE)
	&&	texcoor.y/texpxsz - tex0.y >= celpxsz.y - 1.05
	) {
		fragColor = vec4(acfg, 1.0);
		if (0 == renp(0)) faint = 1;
	} else if (0 != renp(0)) {
		fragColor = vec4(acfg, 1.0);
	} else if (0 != (ATTR_BOLD & glymode) && 0 != renp(-1)) {
		fragColor = vec4(acfg * 0.8 + acbg * 0.2, 1.0);
	} else {
		fragColor = vec4(acbg, 1.0);
	}

	faint |= glymode & ATTR_FAINT;
	if (0 != faint) {
		fragColor.r *= 0.8;
		fragColor.g *= 0.8;
		fragColor.b *= 0.8;
	}
}
`);
		gl.compileShader		(	vshdr);
		gl.compileShader		(	fshdr);
		gl.attachShader			(shpr,	vshdr);
		gl.attachShader			(shpr,	fshdr);
		gl.linkProgram			(shpr);
		gl.useProgram			(shpr);

		clicoor	= gl.getAttribLocation	(shpr, "clicoor");
		bgcolor = gl.getUniformLocation	(shpr, "bgcolor");
		fgcolor = gl.getUniformLocation	(shpr, "fgcolor");
		glymode = gl.getUniformLocation	(shpr, "glymode");
		texpxsz = gl.getUniformLocation	(shpr, "texpxsz");
		cliclsz	= gl.getUniformLocation	(shpr, "cliclsz");
		celpxsz	= gl.getUniformLocation	(shpr, "celpxsz");
		tex0	= gl.getUniformLocation	(shpr, "tex0");
		cli0	= gl.getUniformLocation	(shpr, "cli0");
		mask	= gl.getUniformLocation	(shpr, "mask");

		vbu = gl.createBuffer();
		gl.bindBuffer(	gl.ARRAY_BUFFER, vbu);
		gl.bufferData(	gl.ARRAY_BUFFER,
				new Float32Array([
					0.0, 1.0,
					1.0, 1.0,
					1.0, 0.0,
					0.0, 0.0,
				]),
				gl.STATIC_DRAW);
		gl.enableVertexAttribArray(	clicoor);
		gl.vertexAttribPointer(		clicoor			,
					/*size		*/ 2		,
					/*type		*/ gl.FLOAT	,
					/*normalize	*/ false	,
					/*stride	*/ 0		,
					/*offset	*/ 0		);

		gl.bindBuffer(	gl.ARRAY_BUFFER, null);
		readywindow();
		adjust();
		redraw(t);
		display('');
	};
	fr.send(null);
}

function set_font_key(key)
{
	if (!/^[A-Z] $/.test(key)) return 0;

	font_key = key.charCodeAt(0) - 65;
	return (font_key >= 0 && font_key < WERMFONT_CNT) ? 'm' : 0;
}

function set_repeat_key(code)
{
	var bo = 0.5;

	switch (code) {
	case 'bs': repsignal = '\177';		break;
	case 'vs': repsignal = '\x1b[3~';	break;
	case 'en': repsignal = '\r';		break;
	case '- ': repsignal = '-';		break;
	case 'sp': repsignal = ' ';		break;
	case 'ri': repsignal = '\\>';		break;
	case 'le': repsignal = '\\<';		break;
	case 'up': repsignal = '\\^';		break;
	case 'do': repsignal = '\\v';		break;
	case '. ': repsignal = '\t';		bo=-1; break;

	default:	return 0;
	}

	updaterepboxs(1, 1, bo, 0);

	return 'm';
}

function set_repeat_cnt(code)
{
	var boxi;

	// 'me' means don't hide the guide boxes, nor repeat
	boxi = code == 'me' ? 0 : REPEAT_BOX_CNT;
	updaterepboxs(0, 0, code == 'me' ? +0.25 : -1, 0);

	switch (code) {
	case 'ra': case 'me':	repeat_cnt = 0;		return 'm';
	case 'rs':		repeat_cnt = 40;	return 'm';
	}

	if (code.charAt(1) != ' ') return 0;

	repeat_cnt =	/*000000000111111111122222222223333333
			  123456789012345678901234567890123456789*/
			' 12345QWERTASDFGZXCVB7890-UIOP[JKL;"M,./'
		.indexOf(code.charAt(0));
	return repeat_cnt >= 1 ? 'm' : 0;
}

function repeat_keystroke() {
	while (repeat_cnt--) signal(repsignal);
}

function set_barrier_dig(code)
{
	barrier_dig[this] = code[1];
	return /#[0-9]/.test(code) ? 'm' : 0;
}

function updatebarrdivcw()
{
	var cw = term(t,cw);
	barrdiv.style.left	= `${cw * barrdiv.termcols}px`;
	barrdiv.style.width	= `${cw}px`; 
}

function show_barrier(col)
{
	var s;

	if (barrdiv) document.body.removeChild(barrdiv);
	barrdiv = 0;

	if (!col) return;

	barrdiv = document.createElement('div');
	barrdiv.termcols = col;
	s = barrdiv.style;
	s.position = 'absolute';
	s.opacity = 0.3;
	s.backgroundColor = 'hsl(' + (col * 283 % 360) + ', 90%, 50%)'
	updatebarrdivcw();
	s.top = '0';
	s.height = '100%';
	document.body.appendChild(barrdiv);
};

function match_key(exp, mn)
{
	var res;

	switch (exp.__proto__) {
	case Function.prototype: return exp(mn);
	case Array.prototype:
		res = match_key(exp[0], mn);
		switch (res) {
		case 0: case false: return 0;
		case 'm':
			exp = exp.slice(1);
			if (!exp.length) return 'm';
			break;
		default:
			exp = exp.slice();
			exp[0] = res;
		}
		return exp;
	case String.prototype:
		if (!exp.startsWith(mn)) return 0;
		exp = exp.substr(2);
		if (!exp.length) return 'm';
		return exp;
	}
	console.error('unknown matching kind:');
	console.log(exp, mn);
}

function open_for_term(prefix)
{
	if (!termid)
		display('Not available in ephemeral session.');
	else
		window.open(prefix + encodeURIComponent(termid));
}

function dopaste()
{
	navigator.clipboard.readText().then(function(ct)
	{
		signal(sanit(ct.replaceAll('\r\n', '\n')));
	});
}

macro_map = [
	/* Sample macros for C++ coding and shell use. */
	['raW ; ',	'std::'],
	['raA ',	'->'],
	['lavsU ',	'| grep '],
	['raD G ',	'grep -Irn '],

	/* Send Ctrl+T, do not open a new tab */
	['raT ',	'\x14'],

	['laH T ',	open_child_term],
	[['raF N ',	set_font_key], () => set_font(font_key, 0)],
	['raD U M P ',	signal.bind(0, '\\d')],
	['raS T ',	set_locked_title.bind(0, 'c')],
	['raS B T ',	set_locked_title.bind(0, 'b')],
	['laU T ',	unlock_title],
	['rarsA T ',	function() { window.open('/attach', '_top'); }],
	['rarsS T ',	function() { window.open('/attach', '_blank'); }],

	/* These cannot be added conditionally to macro_map, since
	 * termid may be set later by \@appendid */
	['laH L ', open_for_term.bind(0, '/?logview=')],
	['laH M ', open_for_term.bind(0, '/scrollback?termid=')],
	['laH N ', function()
	{
		var sbwin, rows, rsi, rstxt = deqmk();

		rows = term(t,row);
		for (rsi = 0; rsi < rows; rsi++) {
			rstxt = tpushlinestr(t,	rstxt, rsi);
			rstxt = deqpushbyt(	rstxt, ORD('\n'));
		}

		sbwin = window.open('/scrollback');
		sbwin.scrollbackcontent = deqtostring(rstxt, 0);
		tmfree(rstxt);
	}],

	[['ra', set_repeat_key, set_repeat_cnt], repeat_keystroke],
	[['la',
	 set_barrier_dig.bind(0),
	 set_barrier_dig.bind(1),
	 set_barrier_dig.bind(2)], function()
	{
		show_barrier(Number(barrier_dig.join('')));
	}],

	['ra5 ra', dopaste],
];

var git_macros = [
	['laI F ',	'git status -s -uno\r'],
	['laI R V ',	'git remote -v\r'],
	['laI lsF ',	'git status -s -uall\r'],
	['laI D ',	'git diff '],
	['laI L ',	'git log --name-status '],
	['laI C O ',	'git checkout '],
	['laI C D ',	'git diff --cached '],
	['laI B R ',	'git branch '],
	['laI C M ',	'git commit '],
	['laI P S ',	'git push '],
	['laI P L ',	'git pull '],
	['laI S ',	'git show '],

	/* `git log` which shows full branching history with commit rather than
	author timestamps, in a format that doesn't require Git to do any
	preprocessing, so it is fast even for very complex branching patterns.
	Parent commits are shown as shortened 3-character hashes, which allows
	locating them easily enough. */
	['laI T ',	'|perl -pE\'/^([^0-9]*)(\\d{8,10})\\b(.*)/ and $_=$1.`date -d\\@$2 +"%F %T %Z"`."$3\\n" and s/\\n//\'|less \x01git log --graph --format="%ct %h %s" '],
];

var vim_macros = [
	['raS D ', '\x1b:w\r'],		/* save buffer */
	['raS K ', '\x1b:wq\r'],	/* save buffer and quit */
	['la; P ', ':e %:p:h\t'],	/* open prepopulating path with current file's dir */
	['la; [ ', ':e \x12%'],		/* open prepopulating path with current file */
	['ralsI ', '\x1bI'],		/* insert mode at start of line, similar to Ctrl+O then I */
	['ralsE ', '\x1bA'],		/* insert mode at end of line, similar to Ctrl+O then E */
];

function winpos() { return window.screenX + 'x' + window.screenY; }
function process_mkey(e)
{
	var mi, mch, mac, save, is_alt;

	is_alt = (e.mn == 'la' || e.mn == 'ra');

	if (e.key == 'Meta' && e.altKey) {
		/* Alt+Meta+M to switch monitors should not be
		   considered the start of a macro. */
		matching.length = 0;
		if (log_macks)
			console.log('Ignore Meta for second macro key');
		return false;
	}

	if (!matching.length) {
		if (!is_alt) return false;
		got_key_up = false;
		macro_winpos = winpos();
		if (log_macks) console.log('start of macro: ', e);
	}
	else if (!got_key_up && is_alt) {
		// Ignore holding down Alt key, or starting a macro
		// right after an Alt+<ash keybinding>.
		matching = [];
		if (log_macks)
			console.log('macro reset (hold alt): ', e);
	}
	else if (!got_key_up && !e.altKey) {
		// We never received Alt release event, but the current
		// event doesn't have the altKey bit set.
		// Chrome may have hid the event from us, indicating an
		// Ash shortcut was activated, so we don't consider
		// macros.
		// On Lacros this seems to have changed. The Alt Key up
		// event is still received.
		matching.length = 0;
		if (log_macks)
			console.log('macro reset (missed alt up)', e);
		return false;
	}
	else if (log_macks)
		console.log('process macro', e, matching);

	function poplmatching(ar)
	{
		ar.forEach(function(e) { matching.push(e.slice()) });
	}

	if (!matching.length) {
		poplmatching(macro_map);
		if (wermcfg.basic_git_macros) poplmatching(git_macros);
		if (wermcfg.basic_vim_macros) poplmatching(vim_macros);
	}

	for (mi = 0; mi < matching.length; mi++) {
		mac = matching[mi];
		if (log_matching) console.log('match against:', mac);
		switch (mac[0] = match_key(mac[0], e.mn)) {
		case 0:
			save = matching.pop();
			if (mi < matching.length) matching[mi--] = save;
			break;
		case 'm':
			mch = mac[1];
			if (typeof mch === 'string')
				signal(sanit(mch));
			else if (typeof mch === 'function')
				mch();
			else {
				console.error('unknown mapping type:');
				console.log(mch);
			}
			matching.length = 0;
			return true;
		}
	}

	if (!matching.length) {
		// Neither a full match nor a prefix match.
		console.warn('no matching macro');
		signal('?');
	}
	return true;
}

function sporkeydown(e)
{
	var ce;

	if (log_keys) console.log('scrollport key:', e);

	ce = cookev(e);

	if (capsonwhile && !ce.mn.match(capsonwhile)) capsonwhile = 0;

	// Let search+right alt (in that order) turn on capslock.
	if (ce.mn == 'ra' && ce.metaKey) return;

	if (!process_mkey(ce)) {
		push_dead_key_hist(ce);
		dead_key_hist.splice(0, 2);

		if (!process_key_down(ce)) return;
	}
	e.stopPropagation();
	e.preventDefault();
}

function sporkeyup(e)
{
	var hist, dki;

	if (log_keys) console.log('scrollport key:', e);

	if (matching.length) {
		if (macro_winpos != winpos()) {
			if (log_macks)
				console.log('macro reset (win moved)');
			matching.length = 0;
			return;
		}
		// Don't consider Tab to validate the start of a macro,
		// as this would only be useful if the user pressed:
		//	1. AltDown
		//	2. TabDown
		//	3. TabUp
		// But this would just activate the Alt+Tab shortcut to
		// switch windows.
		if (e.code != 'Tab') got_key_up = true;
		if (log_macks)
			console.log('check key up', got_key_up, e);
		return;
	}

	e = cookev(e);
	push_dead_key_hist(e);
	hist = dead_key_hist.join('');
	dead_key_hist.splice(0, 2);

	for (dki = 0; dki < deadkey_map.length; dki++) {
		if (-1 === hist.search(deadkey_map[dki][0])) continue;
		signal(deadkey_map[dki][1]);
	}
}

window.onload = function()
{
	term_canv();

	host = location.host.replace(/^localhost:/, ':');
	prepare_sock();
	params = new URLSearchParams(window.location.search);
	termid = params.get('termid');
	dead_key_hist = ['?', 'x', '?', 'x'];
	display('');

	document.onkeydown = sporkeydown;
	document.onkeyup = sporkeyup;
	document.oncontextmenu = function(e) {	e.stopPropagation();
						e.preventDefault(); };
};

function Ttywriteraw(trm, dq, of, sz)
{
	var bs = new Uint8Array(sz), bi = 0;

	for (;;) {
		if (bi == sz) break;
		bs[bi++] = deqbytat(dq, of++, -1);
	}
	signal(sanit(new TextDecoder().decode(bs)));
}
