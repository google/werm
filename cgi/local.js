#!/bin/sh

echo Content-type: text/html
echo

p=/usr/local/google/home/matvore/.local/werm/local.js

test -f $p || exit 0

hubip=`awk '/myhouse/ { print $1 }' /etc/hosts`
sed "s/{{hubip}}/$hubip/g" $p
