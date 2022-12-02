#!/bin/sh

echo Content-type: text/html
echo

test -f ~/gum/werm_gum.js || exit 0

cat ~/gum/werm_gum.js
