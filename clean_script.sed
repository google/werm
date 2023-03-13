# parameterized escape sequences
s/\x1b\[[?0-9;]*[a-zA-Z]//g

s/\x1b/^[/g

# Trailing and leading \r are noise
s/\x0d$//g;	s/^\x0d//g	# By input line
s/\x0d\n/\n/g;	s/\n\x0d/\n/g	# By output line

# Remaining \r may be meaningful
s/\x0d\+/\n/g
