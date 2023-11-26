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

 DEC 2023

 - make connect_socket chdir-and-retry logic a separate function and allow
   other modules to call it

 NOV 2023

 - attach_main is void instead of int and does not return at all on error

 - call a Werm API to output formatted termination messages

 OCT 2023

 - do not clear screen on attach

 - remove logic to create and manage a pty, as this is not needed on attach
   side

 - remove logic to detect and report winsize changes, as this is the
   responsibility of werm and is no longer pty-based, so requires a complete
   rewrite

 - remove keyboard->packet forwarding logic (push_main)

 - rename sockname and allow werm code to modify it */

#include "third_party/dtach/dtach.h"
#include "outstreams.h"
#include "inbound.h"

/* Connects to a unix domain socket */
static int
connect_socket(const char *name)
{
	int s;
	struct sockaddr_un sockun;

	if (strlen(name) > sizeof(sockun.sun_path) - 1)
	{
		errno = ENAMETOOLONG;
		return -1;
	}

	s = socket(PF_UNIX, SOCK_STREAM, 0);
	if (s < 0)
		return -1;
	sockun.sun_family = AF_UNIX;
	strcpy(sockun.sun_path, name);
	if (connect(s, (struct sockaddr*)&sockun, sizeof(sockun)) < 0)
	{
		close(s);

		/* ECONNREFUSED is also returned for regular files, so make
		** sure we are trying to connect to a socket. */
		if (errno == ECONNREFUSED)
		{
			struct stat st;

			if (stat(name, &st) < 0)
				return -1;
			else if (!S_ISSOCK(st.st_mode) || S_ISREG(st.st_mode))
				errno = ENOTSOCK;
		}
		return -1;
	}
	return s;
}

int connect_uds_as_client(const char *name)
{
	char *slash, *nmcp = 0;
	int ern = 0, dirfd = -1, s;

	s = connect_socket(name);
	if (s >= 0 || errno != ENAMETOOLONG) return s;

	nmcp = strdup(name);
	slash = strrchr(nmcp, '/');
	if (!slash) {
		ern = ENAMETOOLONG;
		goto cleanup;
	}

	/* Try to shorten the socket's path name by using chdir. */
	dirfd = open(".", O_RDONLY);

	if (dirfd < 0) {
		ern = errno;
		goto cleanup;
	}

	*slash = '\0';
	if (chdir(nmcp) < 0) {
		ern = errno;
		goto cleanup;
	}

	s = connect_socket(nmcp + 1);
	if (s < 0) ern = errno;
	fchdir(dirfd);

cleanup:
	free(nmcp);
	if (dirfd >= 0) close(dirfd);
	errno = ern;
	return s;
}

/* Signal */
static RETSIGTYPE
die(int sig)
{
	/* Print a nice pretty message for some things. */
	if (sig == SIGHUP || sig == SIGINT)
		exit_msg("", "detached with signal: ", sig);
	else
		exit_msg("e", "unexpected signal: ", sig);
}

void attach_main(int noerror)
{
	unsigned char buf[BUFSIZE];
	fd_set readfds;
	int s;

	set_argv0('a');

	s = connect_uds_as_client(dtach_sock);
	if (s < 0) {
		if (noerror) return;
		exit_msg("es", "dtach connect_socket errno: ", errno);
	}

	/* Set some signals. */
	signal(SIGPIPE, SIG_IGN);
	signal(SIGXFSZ, SIG_IGN);
	signal(SIGHUP, die);
	signal(SIGTERM, die);
	signal(SIGINT, die);
	signal(SIGQUIT, die);

	/* Tell the master that we want to attach by sending a no-op signal. */
	write(s, "\\N", 2);

	/* Wait for things to happen */
	while (1)
	{
		int n;

		FD_ZERO(&readfds);
		FD_SET(0, &readfds);
		FD_SET(s, &readfds);
		n = select(s + 1, &readfds, NULL, NULL, NULL);
		if (n < 0 && errno != EINTR && errno != EAGAIN)
			exit_msg("e", "select syscall failed: ", errno);

		/* Pty activity */
		if (n > 0 && FD_ISSET(s, &readfds))
		{
			ssize_t len = read(s, buf, sizeof(buf));

			if (len == 0)
				exit_msg("", "EOF - dtach terminating", -1);
			if (len < 0)
				exit_msg("e", "read syscall failed: ", errno);

			/* Send the data to the terminal. */
			write_wbsoc_frame(buf, len);
			n--;
		}
		/* stdin activity */
		if (n > 0 && FD_ISSET(0, &readfds))
		{
			fwrd_inbound_frames(s);
			n--;
		}
	}
}
