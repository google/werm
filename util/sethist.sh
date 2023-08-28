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

# This can be sourced in your shell startup script or profile preamble command
# to save the history to the 'var/' directory in $WERMDIR
# Note PROMPT_COMMAND is bash-specific, so automatic updating on each command
# won't work with zsh, though this should be simple to fix using the precmd
# function.

dirname=$WERMDIR/var/`date +%Y/%m`/hist
mkdir -p $dirname
HISTFILE=$dirname/$1
PROMPT_COMMAND="history -a;$PROMPT_COMMAND"
