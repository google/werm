#!/bin/sh

cmd_scratch=/tmp/compile_commands_$$.json
echo '{' >| compile_commands.json

cd `dirname $0`
clang -MJ $cmd_scratch -o termserv termserv.c `pkg-config --libs nettle`  -lwslay ||
	exit 1
cat $cmd_scratch >> compile_commands.json

echo '}' >> compile_commands.json
