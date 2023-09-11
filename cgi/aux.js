#!/bin/sh
# Copyright 2023 Google Inc. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

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
