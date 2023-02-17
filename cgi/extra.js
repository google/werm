#!/bin/sh

echo Content-type: text/javascript
echo

hubip=`awk '/myhouse/ { print $1 }' /etc/hosts`

sed "s/{{hubip}}/$hubip/g" \
	~/gum/werm_gum.js \
	../local.js		# We don't have $WERMDIR :( so hack with $PWD :)
