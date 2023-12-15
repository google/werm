/* Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd */

/* State of a client connected to the dtach socket. */
struct clistate {
	/* An opaque endpoint ID. This is chosen at random by the client and
	   persisted indefinitely. */
	char endpnt[8];

	/* Whether the client wants to receive terminal output and state
	   updates. */
	unsigned wantsoutput : 1;
};

struct client;
