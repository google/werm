/* Copyright 2023 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd */

#include "spawner.h"
#include "shared.h"

#include <sys/stat.h>
#include <unistd.h>
#include <errno.h>
#include <sys/select.h>
#include <netinet/in.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/un.h>
#include <arpa/inet.h>
#include <sys/wait.h>

struct sock {
	void *a;
	socklen_t sz;
	char *arg;

	unsigned reus : 1;

	int fd;
};

struct subproc_args {
	struct sock sk[FD_SETSIZE];
	unsigned nr, maxsfd;
};

static int setreuse(struct sock *s)
{
	int radr = 1;
	if (!s->reus) return 0;
	return setsockopt(s->fd, SOL_SOCKET, SO_REUSEADDR, &radr, sizeof(radr));
}

static int prepsock(struct sock *s)
{
	struct sockaddr *sad = s->a;

	/* Must be non-blocking so that accept(2) will not block indefinitely
	   for a flakey connection or other race conditions. */
	s->fd = socket(sad->sa_family, SOCK_STREAM | SOCK_NONBLOCK, 0);

	if (0>s->fd)			{ perror("open socket"	); goto er; }
	if (0>setreuse(s))		{ perror("set REUSEADDR"); }
	if (0>bind(s->fd, sad, s->sz))	{ perror("bind socket"	); goto er; }
	if (0>listen(s->fd, 4))		{ perror("listen socket"); goto er; }

	if (s->fd >= FD_SETSIZE) {
		fprintf(stderr, "too many addresses (FD_SETSIZE=%llu)\n",
			(unsigned long long) FD_SETSIZE);
		goto er;
	}

	return 1;

er:
	fprintf(stderr, "could not listen on address: %s\n", s->arg);
	if (s->fd >= 0) close(s->fd);
	s->fd = -1;
	return 0;
}

static int adduds(const char *a, Ports ps)
{
	struct sockaddr_un *addr;
	const char pref[] = "[uds]:";
	int preflen = 6;

	if (strncmp(pref, a, preflen)) return 0;
	a += preflen;

	if (strlen(a) + 1 > sizeof(addr->sun_path)) {
		fprintf(stderr, "uds path too long: %s\n", a);
		return 0;
	}

	addr = malloc(sizeof(*addr));
	addr->sun_family = AF_UNIX;
	strcpy(addr->sun_path, a);
	ps->sk[ps->nr++] = (struct sock){addr, sizeof(*addr), strdup(a)};

	return 1;
}

static int addip4(const char *a, Ports ps)
{
	char ip[32];
	int len, port;
	struct sockaddr_in *addr;
	struct in_addr iddr;

	len = -1;
	sscanf(a, "%31[^:]:%d%n", ip, &port, &len);
	if (len != strlen(a))			return 0;
	if (!inet_pton(AF_INET, ip, &iddr))	return 0;

	addr = malloc(sizeof(*addr));
	addr->sin_family = AF_INET;
	addr->sin_port = htons(port);
	addr->sin_addr = iddr;
	ps->sk[ps->nr++] = (struct sock){addr, sizeof(*addr), strdup(a), 1};

	return 1;
}

static int addip6(const char *a, Ports ps)
{
	char ip[256];
	int len, port;
	struct sockaddr_in6 *addr;
	struct in6_addr iddr;

	len = -1;
	sscanf(a, "[%255[^]]]:%d%n", ip, &port, &len);
	if (len != strlen(a))			return 0;
	if (!inet_pton(AF_INET6, ip, &iddr))	return 0;

	addr = malloc(sizeof(*addr));
	addr->sin6_family = AF_INET6;
	addr->sin6_port = htons(port);
	addr->sin6_addr = iddr;
	ps->sk[ps->nr++] = (struct sock){addr, sizeof(*addr), strdup(a), 1};

	return 1;
}

static void closeports(Ports ps)
{
	struct sock *sk = ps->sk + ps->nr;

	while (sk-- != ps->sk) {
		if (sk->fd >= 0) close(sk->fd);
	}
}

static void delaystreamclose(void)
{
	int sl = 0;
	const char *e = 0;
	struct stat sb;

	if (!stat("/google", &sb))	sl = 1;
	else				e = getenv("WERM_DELAYSTREAMCLOSE");

	if (e && *e)			sl = 1;

	// Hack for SSH forwarding bug, where data sent through forwarded ssh
	// port is truncated. Sleep for half a second to avoid truncation.
	// https://g-issues.chromium.org/issues/41489368
	if (sl) nanosleep(&(struct timespec) {0, 500000000}, 0);
}

static void handlreq(Ports ps, struct sock *s)
{
	pid_t cpid;

	int fd = accept(s->fd, 0, 0);

	if (0 > fd)			{ perror("accept"	); goto er; }
	if (0 > (cpid=fork()))		{ perror("fork"		); goto er; }
	if (cpid) {
		/* If we leak any instances of this fd in the parent proc,
		   the connection will never close. */
		if (0>close(fd))	{ perror("close"	); goto er; }
		return;
	}
	/* Allow Wera processes to survive after the spawner process is killed,
	   which is usually done for debugging and development. */
	setsid();

	closeports(ps);

	if (0 > dup2(fd, 0))		{ perror("dup2 stdin"	); goto er; }
	if (0 > dup2(fd, 1))		{ perror("dup2 stdout"	); goto er; }

	/* This is needed to prevent Werm (Werm master) procs from keeping the
	port open. */
	close(fd);

	while (http_serv()) {}
	delaystreamclose();

	exit(0);

er:
	fprintf(stderr, "error handling request on %s\n", s->arg);
	exit(1);
}

static void acceptnext(Ports ps)
{
	fd_set fds;
	int seln;
	struct sock *sk;

	FD_ZERO(&fds);

	sk = ps->sk + ps->nr;
	while (sk-- != ps->sk) {
		if (sk->fd >= 0) FD_SET(sk->fd, &fds);
	}

	seln = select(ps->maxsfd + 1, &fds, 0, 0, &(struct timeval){1,0});

	if (0 > seln) {
		if (errno == EINTR) return;
		perror("select");
		exit(1);
	}
	waitpid(-1, 0, WNOHANG);

	sk = ps->sk + ps->nr;
	while (sk-- != ps->sk) {
		if (FD_ISSET(sk->fd, &fds)) handlreq(ps, sk);
	}
}

Ports parse_spawner_ports(char **argv)
{
	Ports ps = calloc(sizeof(*ps), 1);

	for (; *argv; argv++) {
		if (adduds(*argv, ps)) continue;
		if (addip4(*argv, ps)) continue;
		if (addip6(*argv, ps)) continue;

		fprintf(stderr, "can't open socket for addr:port: %s\n", *argv);
		exit(1);
	}

	if (!ps->nr) {
		fprintf(stderr, "need at least one address to listen on\n");
		exit(1);
	}

	return ps;
}

void _Noreturn spawner(Ports ps)
{
	struct sock *sk;

	sk = ps->sk + ps->nr;
	while (sk-- != ps->sk) {
		if (prepsock(sk) && ps->maxsfd < sk->fd) ps->maxsfd = sk->fd;
	}

	for (;;) acceptnext(ps);
}
