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
