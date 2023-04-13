#!/bin/sh

echo Content-type: text/javascript
echo

echo $QUERY_STRING | (
echo '
genjs () {
	if test -x $1; then
		$1
	elif test -e $1; then
		cat $1
	fi
}
'
sed '
s_[^,]*_genjs $WERMDIR/js/\0.js; genjs $HOME/.config/werm/js/\0.js_g
s_,_;_g
' ) | /bin/sh
