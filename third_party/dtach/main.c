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

/* WERM-SPECIFIC MODIFICATIONS

 NOV 2023

 - attach_main is void instead of int and does not return at all on error

 OCT 2023

 - remove logic needed for interactive use

 - reformats prompted by large amount of removed logic

 - add error for dtach_sock not being set */

#include "third_party/dtach/dtach.h"
#include "dtachctx.h"

/*
** dtach is a quick hack, since I wanted the detach feature of screen without
** all the other crud. It'll work best with full-screen applications, as it
** does not keep track of the screen or anything like that.
*/

/* Make sure the binary has a copyright. */
const char copyright[] = "dtach - version " PACKAGE_VERSION "(C)Copyright 2004-2016 Ned T. Crigler";

void _Noreturn
dtach_main(Dtachctx dc)
{
	if (!dc->sockpath) { fprintf(stderr, "sockpath must be set"); abort(); }

	/* Try to attach first. If that doesn't work, create a new socket. */
	attach_main(dc, 1);

	if (errno == ECONNREFUSED || errno == ENOENT)
	{
		if (errno == ECONNREFUSED)
			unlink(dc->sockpath);
		if (dtach_master(dc) != 0)
			exit(1);
	}

	attach_main(dc, 0);
	exit(0);
}
