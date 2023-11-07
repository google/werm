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

 - drop statusfd mechanism. Use perror and stderr rather than stdout to show
   error details for init_pty and fork(2). This will show up in websocketd log.
   We can't use exit_msg from Werm here since we don't know if we were invoked
   directly from session.c and with a tty, or invoked from an attach process,
   where stdout is connected to a websocket. stderr is safe in both cases.

 - close the control socket in the subproc (e.g. /bin/bash or the spawner)

 OCT 2023

 - call a function defined by werm rather than exec an argv array to start the
   program

 - rename sockname to dtach_sock

 - remove forkpty and openpty re-implementations of standard functions. These
   seem to already be available by now in any OS werm may conceivably want to
   support in the future.

 - remove dontfork and act as if it's always false

 - allow logging of error messages based on werm configuration to a logfile,
   by simply sending errors to stderr

 - remove progname (argv[0] of dtach interactive invocations) and hard-code with
   "dtach" in status messages

 - remove packetized communication over the dtach socket and rewrite it in werm,
   calling process_kbd from this file

 - refactor logic to send output to clients, put it in sendrout function in this
   file */

#include "third_party/dtach/dtach.h"

/* The pty struct - The pty information is stored here. */
struct pty
{
	/* File descriptor of the pty */
	int fd;
#ifdef BROKEN_MASTER
	/* File descriptor of the slave side of the pty. For broken systems. */
	int slave;
#endif
	/* Process id of the child. */
	pid_t pid;
	/* The current window size of the pty. */
	struct winsize ws;
};

/* A connected client */
struct client
{
	/* The next client in the linked list. */
	struct client *next;
	/* The previous client in the linked list. */
	struct client **pprev;
	/* File descriptor of the client. */
	int fd;
	/* Whether or not the client is attached. */
	int attached;
};

/* The list of connected clients. */
static struct client *clients;
/* The pseudo-terminal created for the child process. */
static struct pty the_pty;

/* Unlink the socket */
static void
unlink_socket(void)
{
	unlink(dtach_sock);
}

/* Signal */
static RETSIGTYPE 
die(int sig)
{
	/* Well, the child died. */
	if (sig == SIGCHLD)
	{
#ifdef BROKEN_MASTER
		/* Damn you Solaris! */
		close(the_pty.fd);
#endif
		return;
	}
	exit(1);
}

/* Sets a file descriptor to non-blocking mode. */
static int
setnonblocking(int fd)
{
	int flags;

#if defined(O_NONBLOCK)
	flags = fcntl(fd, F_GETFL);
	if (flags < 0 || fcntl(fd, F_SETFL, flags | O_NONBLOCK) < 0)
		return -1;
	return 0;
#elif defined(FIONBIO)
	flags = 1;
	if (ioctl(fd, FIONBIO, &flags) < 0)
		return -1;
	return 0;
#else
#warning Do not know how to set non-blocking mode.
	return 0;
#endif
}

/* Initialize the pty structure. */
static int
init_pty(void)
{
	/* Use the original terminal's settings. We don't have to set the
	** window size here, because the attacher will send it in a packet. */
	memset(&the_pty.ws, 0, sizeof(struct winsize));

	/* Create the pty process */
	the_pty.pid = forkpty(&the_pty.fd, NULL, NULL, NULL);
	if (the_pty.pid < 0) {
		perror("forkpty");
		abort();
	}
	if (the_pty.pid != 0) {
#ifdef BROKEN_MASTER
		char *buf;

		buf = ptsname(the_pty.fd);
		the_pty.slave = open(buf, O_RDWR|O_NOCTTY);
#endif
	}
	return the_pty.pid;
}

/* Send a signal to the slave side of a pseudo-terminal. */
static void
killpty(struct pty *pty, int sig)
{
	pid_t pgrp = -1;

#ifdef TIOCSIGNAL
	if (ioctl(pty->fd, TIOCSIGNAL, sig) >= 0)
		return;
#endif
#ifdef TIOCSIG
	if (ioctl(pty->fd, TIOCSIG, sig) >= 0)
		return;
#endif
#ifdef TIOCGPGRP
#ifdef BROKEN_MASTER
	if (ioctl(pty->slave, TIOCGPGRP, &pgrp) >= 0 && pgrp != -1 &&
		kill(-pgrp, sig) >= 0)
		return;
#endif
	if (ioctl(pty->fd, TIOCGPGRP, &pgrp) >= 0 && pgrp != -1 &&
		kill(-pgrp, sig) >= 0)
		return;
#endif

	/* Fallback using the child's pid. */
	kill(-pty->pid, sig);
}

/* Creates a new unix domain socket. */
static int
create_socket(char *name)
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
	if (bind(s, (struct sockaddr*)&sockun, sizeof(sockun)) < 0)
	{
		close(s);
		return -1;
	}
	if (listen(s, 128) < 0)
	{
		close(s);
		return -1;
	}
	if (setnonblocking(s) < 0)
	{
		close(s);
		return -1;
	}
	/* chmod it to prevent any suprises */
	if (chmod(name, 0600) < 0)
	{
		close(s);
		return -1;
	}
	return s;
}

/* Update the modes on the socket. */
static void
update_socket_modes(int exec)
{
	struct stat st;
	mode_t newmode;

	if (stat(dtach_sock, &st) < 0)
		return;

	if (exec)
		newmode = st.st_mode | S_IXUSR;
	else
		newmode = st.st_mode & ~S_IXUSR;

	if (st.st_mode != newmode)
		chmod(dtach_sock, newmode);
}

static struct fdbuf therout;

static int sendrout(fd_set *writabl)
{
	struct client *p;
	const unsigned char *routcurs;
	ssize_t writn, routrema;
	int nclients;

	/* Send the data out to the clients. */
	for (p = clients, nclients = 0; p; p = p->next)
	{
		if (!FD_ISSET(p->fd, writabl)) continue;

		routcurs = therout.bf;
		routrema = therout.len;
		while (routrema)
		{
			writn = write(p->fd, routcurs, routrema);

			if (writn > 0)
			{
				routrema -= writn;
				routcurs += writn;
				continue;
			}
			else if (writn < 0 && errno == EINTR)
				continue;
			else if (writn < 0 && errno != EAGAIN)
				nclients = -1;
			break;
		}

		if (nclients != -1 && !routrema) nclients++;
	}

	return nclients;
}

/* Process activity on the pty - Input and terminal changes are sent out to
** the attached clients. If the pty goes away, we die. */
static void
pty_activity(int s)
{
	unsigned char preprocb[BUFSIZE];
	struct client *p;
	ssize_t preproclen, writn;
	fd_set readfds, writefds;
	int highest_fd, nclients;

	/* Read the pty activity */
	preproclen = read(the_pty.fd, preprocb, sizeof(preprocb));

	/* Error -> die */
	if (preproclen <= 0)
		exit(1);

	therout.len = 0;
	process_tty_out(&therout, preprocb, preproclen);

	do {
		/*
		** Wait until at least one client is writable. Also wait on the
		** control socket in case a new client tries to connect.
		*/
		FD_ZERO(&readfds);
		FD_ZERO(&writefds);
		FD_SET(s, &readfds);
		highest_fd = s;
		for (p = clients, nclients = 0; p; p = p->next)
		{
			if (!p->attached)
				continue;
			FD_SET(p->fd, &writefds);
			if (p->fd > highest_fd)
				highest_fd = p->fd;
			nclients++;
		}
		if (nclients == 0)
			break;
		if (select(highest_fd + 1, &readfds, &writefds, NULL, NULL) < 0)
			break;

		nclients = sendrout(&writefds);

		/* Try again if nothing happened. */
	} while (!FD_ISSET(s, &readfds) && nclients == 0);
}

/* Process activity on the control socket */
static void
control_activity(int s)
{
	int fd;
	struct client *p;
 
	/* Accept the new client and link it in. */
	fd = accept(s, NULL, NULL);
	if (fd < 0)
		return;
	else if (setnonblocking(fd) < 0)
	{
		close(fd);
		return;
	}

	/* Link it in. */
	p = malloc(sizeof(struct client));
	p->fd = fd;
	p->attached = 0;
	p->pprev = &clients;
	p->next = *(p->pprev);
	if (p->next)
		p->next->pprev = &p->next;
	*(p->pprev) = p;
}

/* Process activity from a client. */
static void
client_activity(struct client *p)
{
	ssize_t len;
	unsigned char buf[512];

	/* Read the activity. */
	len = read(p->fd, buf, sizeof(buf));
	if (len < 0 && (errno == EAGAIN || errno == EINTR))
		return;

	/* Close the client on an error. */
	if (len <= 0)
	{
		close(p->fd);
		if (p->next)
			p->next->pprev = p->pprev;
		*(p->pprev) = p->next;
		free(p);
		return;
	}
	if (!p->attached) recount_state(&((struct wrides) {p->fd}));
	p->attached = 1;

	process_kbd(the_pty.fd, p->fd, buf, len);
}

/* The master process - It watches over the pty process and the attached */
/* clients. */
static _Noreturn void
masterprocess(int s)
{
	struct client *p, *next;
	fd_set readfds;
	int highest_fd, nullfd;

	int has_attached_client = 0;

	/* Okay, disassociate ourselves from the original terminal, as we
	** don't care what happens to it. */
	if (!is_ephem()) setsid();

	/* Set a trap to unlink the socket when we die. */
	atexit(unlink_socket);

	/* Create a pty in which the process is running. */
	signal(SIGCHLD, die);
	if (!init_pty()) {
		/* Child of master. Becomes the subproc, such as the shell. We
		 * need to close the control socket so lsof can give an accurate
		 * picture of whether the sockets are in use. This keeps /attach
		 * session use state accurate. Note that the spawner also
		 * creates more dtach processes, so for the spawner process,
		 * this event prevents ~spawner.<ID> from staying open by each
		 * master proc. */
		close(s);
		subproc_main();
	}

	maybe_open_logs();

	/* Set up some signals. */
	signal(SIGPIPE, SIG_IGN);
	signal(SIGXFSZ, SIG_IGN);
	signal(SIGHUP, is_ephem() ? die : SIG_IGN);
	signal(SIGTTIN, SIG_IGN);
	signal(SIGTTOU, SIG_IGN);
	signal(SIGINT, die);
	signal(SIGTERM, die);

	/* Make sure stdin/stdout/stderr point to /dev/null. We are now a
	** daemon. */
	nullfd = open("/dev/null", O_RDWR);
	dup2(nullfd, 0);
	dup2(nullfd, 1);
	if (!dtach_logging()) dup2(nullfd, 2);

	if (nullfd > 2)
		close(nullfd);

	/* Loop forever. */
	while (1)
	{
		int new_has_attached_client = 0;

		/* Re-initialize the file descriptor set for select. */
		FD_ZERO(&readfds);
		FD_SET(s, &readfds);
		highest_fd = s;

		/*
		** When first_attach is unset, wait until the client attaches
		** before trying to read from the pty.
		*/
		if (!first_attach && clients && clients->attached) {
			first_attach = 1;
			send_pream(the_pty.fd);
		}

		if (first_attach) {
			FD_SET(the_pty.fd, &readfds);
			if (the_pty.fd > highest_fd)
				highest_fd = the_pty.fd;
		}

		for (p = clients; p; p = p->next)
		{
			FD_SET(p->fd, &readfds);
			if (p->fd > highest_fd)
				highest_fd = p->fd;

			if (p->attached)
				new_has_attached_client = 1;
		}

		/* chmod the socket if necessary. */
		if (has_attached_client != new_has_attached_client)
		{
			update_socket_modes(new_has_attached_client);
			has_attached_client = new_has_attached_client;
		}

		/* Wait for something to happen. */
		if (select(highest_fd + 1, &readfds, NULL, NULL, NULL) < 0)
		{
			if (errno == EINTR || errno == EAGAIN)
				continue;
			exit(1);
		}

		/* New client? */
		if (FD_ISSET(s, &readfds))
			control_activity(s);
		/* Activity on a client? */
		for (p = clients; p; p = next)
		{
			next = p->next;
			if (FD_ISSET(p->fd, &readfds))
				client_activity(p);
		}
		if (!clients && first_attach && is_ephem()) exit(0);
		/* pty activity? */
		if (FD_ISSET(the_pty.fd, &readfds))
			pty_activity(s);
	}
}

int
dtach_master(void)
{
	int s;
	pid_t pid;

	/* Create the unix domain socket. */
	s = create_socket(dtach_sock);
	if (s < 0 && errno == ENAMETOOLONG)
	{
		char *slash = strrchr(dtach_sock, '/');

		/* Try to shorten the socket's path name by using chdir. */
		if (slash)
		{
			int dirfd = open(".", O_RDONLY);

			if (dirfd >= 0)
			{
				*slash = '\0';
				if (chdir(dtach_sock) >= 0)
				{
					s = create_socket(slash + 1);
					fchdir(dirfd);
				}
				*slash = '/';
				close(dirfd);
			}
		}
	}
	if (s < 0)
	{
		perror("dtach create_socket");
		fprintf(stderr, "Socket path: %s\n", dtach_sock);
		return 1;
	}

	/* Fork off so we can daemonize and such */
	pid = fork();
	if (pid < 0)
	{
		perror("dtach: fork");
		unlink_socket();
		return 1;
	}
	else if (pid == 0)
	{
		/* Child - this becomes the master */
		set_argv0('m');
		masterprocess(s);
	}
	/* Parent - just return. */

	close(s);
	return 0;
}
