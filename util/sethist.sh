dirname=$WERMDIR/var/`date +%Y/%m`/hist
mkdir -p $dirname
HISTFILE=$dirname/$1
PROMPT_COMMAND="history -a;$PROMPT_COMMAND"
