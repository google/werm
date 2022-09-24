#!/bin/sh

cmd_scratch=/tmp/compile_commands_$$.json

cd `dirname $0`
echo '{' >| compile_commands.json

build () {
	mod="$1"
	libs="$2"
	clang -std=c99 -MJ $cmd_scratch -o $mod $mod.c $libs ||
		exit 1
	cat $cmd_scratch >> compile_commands.json
	rm $cmd_scratch
}

build termserv "`pkg-config --libs nettle`  -lwslay"
build session

echo '}' >> compile_commands.json
