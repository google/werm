/* See LICENSE for license details. */

#include "third_party/st/wcwidth.h"

#include <wchar.h>

int Wcwidth(int u)
{
	switch (wcwidth(u)) {
	case -1: case 0: case 1:	return 1;
	default:			return 2;
	}
}
