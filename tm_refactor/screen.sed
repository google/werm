#!/bin/sh
# Copyright 2023 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd

cat >|/tmp/serm.$$ <<'SEOF'

1,/Screen_CursorState = function/{
	s/\<this\([,.)]\)/scn\1/g
}

/hterm.Screen = function() {/{
	s//\n  return scn;/
	h
	s/.*//

	s/$/fn0(new_screen) {\n/
	s/$/  TMint scn = tmalloc(10);\n\n/
	s/$/  #define rowsArray(s)		fld(s, 0)\n/
	s/$/  rowsArray(scn) = jsobj_alloc();\n/
	s/$/  #define columnCount_(s)	fld(s, 1)\n/
	s/$/  #define scrTextAttr(s)	fld(s, 2)\n/
	s/$/  scrTextAttr(scn) = jsobj_alloc();\n/
	s/$/  #define cursrow(s)		fld(s, 3)\n/
	s/$/  #define curscol(s)		fld(s, 4)\n/
	s/$/  #define cursovrfl(s)		fld(s, 5)\n/
	s/$/  #define cursorState_(s)	fld(s, 6)\n/
	s/$/  cursorState_(scn) = jsobj_alloc();\n/
	s/$/  #define cursorRowNode_(s)	fld(s, 7)\n/
	s/$/  cursorRowNode_(scn) = jsobj_alloc();\n/
	s/$/  #define cursorNode_(s)	fld(s, 8)\n/
	s/$/  cursorNode_(scn) = jsobj_alloc();\n/
	s/$/  #define cursorOffset_(s)	fld(s, 9)\n/
}

/^};$/{
	x; /./{
		s/$/\n}/; x
		s/.*//;
	}
	x
}

s/\<new hterm\.Screen\>/new_screen/g

s/hterm.Screen.prototype/SPROT/

/SPROT.*=$/{
	N; s/\n//
}

/^SPROT[.]/!bA
s///

s/function()/1\0/
s/function([^,][^,]*)/2\0/
s/function([^,]*,[^,]*)/3\0/
s/function([^,]*,[^,]*,[^,]*)/4\0/
s/function([^,]*,[^,]*,[^,]*,[^,]*)/5\0/
s/\([^ ]*\) = *\(.\)function(/fn\2(\1, scn, /
s/scn, )/scn)/

/\<function\>/q

b

:A

s/hterm.Screen..commitLineOverflow/commitLineOverflow/

# annotate functions with FNCT
s/\.\(cur_row_text\|getHeight\|setColumnCount\|unshiftRow\|unshiftRows\|popRow\|popRows\|pushRow\|insertRow\|insertRows\|removeRows\|clearCursorRow\|commitLineOverflow\|setCursorPosition\|syncSelectionCaret\|splitNode_\|maybeClipCurrentRow\|insertString\|overwriteString\|deleteChars\|getLineStartRow_\|getLineText_\|getXRowAncestor_\|getPositionWithOverflow_\|getPositionWithinRow_\|getNodeAndOffsetWithOverflow_\|getNodeAndOffsetWithinRow_\|setRange_\|expandSelectionWithWordBreakMatches_\|expandSelection\|expandSelectionForUrl\|saveCursorAndState\|restoreCursorAndState\)\>/.FNCT\1/g

# annotate and convert Javascript value fields
s/\.\(rowsArray\|scrTextAttr\|cursorState_\|cursorRowNode_\|cursorNode_\)\>/.JFLD\1/g
s/\([a-zA-Z_.]*\)\.JFLD\([a-zA-Z_]*\)/jsobj(\2(\1))/g

# annotate and convert int32 fields
s/\.\(columnCount_\|cursrow\|curscol\|cursovrfl\|cursorOffset_\)\>/.IFLD\1/g
s/\([a-zA-Z_.]*\)\.IFLD\([a-zA-Z_]*\)/\2(\1)/g

/\<\([a-zA-Z0-9_.]*\)\.FNCT\([a-zA-Z0-9_]*\)(/{
	s//\2(\1, /
	s/, )/)/
}

SEOF

f=third_party/hterm/engine.js
if ! git diff --quiet -- $f index.html; then
	echo $f has unstanged changes >&2
	exit 1
fi

set -x

sed -i -f /tmp/serm.$$ $f
sed -i 's/t.screen_.cur_row_text()/cur_row_text(t.screen_)/g' index.html

# sed 's/s.rowsArray\[s.cursrow\].innerText/jsobj(rowsArray(s))[cursrow(s)]/' index.html
rm /tmp/serm.$$
git diff $f index.html
git checkout $f index.html
