# Copyright 2023 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd

# This can be sourced in your shell startup script or profile preamble command
# to save the history to $WERMVARDIR.
# Note PROMPT_COMMAND is bash-specific, so automatic updating on each command
# won't work with zsh, though this should be simple to fix using the precmd
# function.

dirname="$WERMVARDIR"/`date +%Y/%m`/hist
mkdir -p "$dirname"
HISTFILE="$dirname/$1"
PROMPT_COMMAND="history -a;$PROMPT_COMMAND"
