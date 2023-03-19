/*
    dtach - A simple program that emulates the detach feature of screen.
    Copyright (C) 2004-2016 Ned T. Crigler

    This program is free software; you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation; either version 2 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/
#include "third_party/dtach/dtach.h"

/*
** dtach is a quick hack, since I wanted the detach feature of screen without
** all the other crud. It'll work best with full-screen applications, as it
** does not keep track of the screen or anything like that.
*/

/* Make sure the binary has a copyright. */
const char copyright[] = "dtach - version " PACKAGE_VERSION "(C)Copyright 2004-2016 Ned T. Crigler";

/* The character used for detaching. Defaults to '^\' */
int detach_char = '\\' - 64;
/* 1 if we should not interpret the suspend character. */
int no_suspend;
/* The default redraw method. Initially set to unspecified. */
int redraw_method = REDRAW_UNSPEC;

/*
** The original terminal settings. Shared between the master and attach
** processes. The master uses it to initialize the pty, and the attacher uses
** it to restore the original settings.
*/
struct termios orig_term;

void _Noreturn
dtach_main(void)
{
	if (!dtach_sock) errx(1, "dtach_sock must be set");

	redraw_method = REDRAW_NONE;

	/* Save the original terminal settings. */
	if (tcgetattr(0, &orig_term) < 0) errx(1, "dtach: requires a terminal");

	/* Try to attach first. If that doesn't work, create a new socket. */
	if (attach_main(1) != 0)
	{
		if (errno == ECONNREFUSED || errno == ENOENT)
		{
			if (errno == ECONNREFUSED)
				unlink(dtach_sock);
			if (master_main() != 0)
				exit(1);
		}
		exit(attach_main(0));
	}
	exit(0);
}
