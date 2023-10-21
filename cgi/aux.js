#!/bin/sh
# Copyright 2023 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd

echo Content-type: text/javascript
echo

printf '%s\n' "$QUERY_STRING" \
| tr ',' '\n' \
| while read jsnam; do
	printf '%s\n' "${WERMJSPATH:-$WERMSRCDIR/js:$HOME/.config/werm/js}" \
	| tr ':' '\n' \
	| while read jsdir; do
		full="$jsdir/$jsnam.js"
		if test -x "$full"; then
			"$full"
		elif test -e "$full"; then
			cat "$full"
		fi
	done
done
