/* Copyright 2023 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd */

struct subproc_args;
typedef struct subproc_args *Ports;

/* Sets spawner ports from the given command-line arguments, or terminates
   process on error. */
Ports parse_spawner_ports(char **argv);

/* Serves requests on given ports and doesn't return. */
void _Noreturn spawner(Ports ps);
