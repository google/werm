s/\x1b\[1@/^D/g		# Del
s/\x08\x1b\[K/^H/g	# BS
s/\x1b\[C/^F/g		# Move right
s/\x1b\[B/^B/g		# Move left
s/\x08/^B/g

# parameterized escape sequences
s/\x1b\[[?0-9;]*[a-zA-Z]//g

# simple (1-byte) escape sequences
s/\(\x1b.\)\+/\n/g

# Trailing and leading \r are noise
s/\x0d$//g;	s/^\x0d//g	# By input line
s/\x0d\n/\n/g;	s/\n\x0d/\n/g	# By output line

# Remaining \r may be meaningful
s/\x0d\+/\n/g
