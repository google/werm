#include "../third_party/libschrift/schrift.h"
#include <stdio.h>
#include <sys/stat.h>
#include <unistd.h>
#include <errno.h>
#include <stdlib.h>
#include <limits.h>

#define PIXDIM 256
static void *pix;

#define PFAT(detail) do { perror(detail); exit(1); } while (0)

static FILE *openout(const char *bsname)
{
	char dirp[256], abp[256];
	FILE *f;

	snprintf(dirp, sizeof(dirp),
		 "/tmp/convert_ttf.%lld", (long long) getpid());
	snprintf(abp, sizeof(abp), "%s/%s.wermfont", dirp, bsname);
	fprintf(stderr, "writing font to %s...\n", abp);

	if (0>mkdir(dirp, 0700) && errno != EEXIST) PFAT("mkdir");
	f = fopen(abp, "wb");
	if (!f) PFAT("fopen");
	return f;
}

static void process(const char *dir, const char *bsname, int h)
{
	char absrc[256];
	SFT sf = {0, h, h, 0, 0, SFT_DOWNWARD_Y};
	SFT_Image im = {pix, PIXDIM, PIXDIM};
	unsigned char *pix;
	long cp;
	SFT_Glyph g;
	SFT_GMetrics gm;
	int minyoff = INT_MAX, minxber = INT_MAX, thisber, x, y, offx, offy, pc;
	FILE *out = openout(bsname);

	snprintf(absrc, sizeof(absrc), "%s/third_party/%s/%s.ttf",
		 getenv("WERMSRCDIR"), dir, bsname);

	sf.font = sft_loadfile(absrc);
	if (!sf.font) {fprintf(stderr, "error loading ", absrc); goto cleanup;}

	for (cp = 1; cp < 0x110000; cp++) {
		if (0x20 == cp) continue;
		if (0 > sft_lookup(&sf, cp, &g) || !g) continue;
		if (0 > sft_gmetrics(&sf, g, &gm)) goto metricerr;

		thisber = (int)gm.leftSideBearing;
		if (minyoff > gm.yOffset	) minyoff = gm.yOffset;
		if (minxber > thisber		) minxber = thisber;
	}

	for (cp = 1; cp < 0x110000; cp++) {
		if (0x20 == cp) continue;
		if (0 > sft_lookup(&sf, cp, &g) || !g) continue;
		if (0 > sft_render(&sf, g, im)) {
			fprintf(stderr, "can't render codepoint 0x%llx ", cp);
			goto cleanup;
		}
		if (0 > sft_gmetrics(&sf, g, &gm)) goto metricerr;
		fprintf(out, "%llx %d\n", cp, (int) gm.advanceWidth);
		/* offx (y) is number of empty pixels on left (top). */
		offx = (int)gm.leftSideBearing	- minxber;
		offy = gm.yOffset		- minyoff;

		for (x=0, y=0, pix=im.pixels;;) {
			if (x < offx || y < offy) {fputc('.', out); goto nextp;}

			switch (pix[(y - offy)*PIXDIM + (x - offx)]) {
			default:		goto blackwerr;
			break; case 0:		fputc('.', out);
			break; case 255:	fputc('o', out);
			}

		nextp:
			if (++x >= (int) gm.advanceWidth) {
				x = 0;
				fputc('\n', out);
				if (++y == h) break;
			}
		}
	}

cleanup:
	sft_freefont(sf.font);
	fclose(out);
	return;

metricerr: fprintf(stderr, "can't get metrics 0x%llx\n"	, cp); goto cleanup;
blackwerr: fprintf(stderr, "a pixel is gray 0x%llx\n"	, cp); goto cleanup;
}

int main()
{
	pix = malloc(PIXDIM * PIXDIM);
	process("oldschool-pc-fonts",	"ibm_ega_8x8",		8);
	process("oldschool-pc-fonts",	"hp_100lx_10x11",	12);
	fprintf(stderr, "the next one will take awhile\n");
	process("shinonome",		"jfdot_7x14",		14);
	process("oldschool-pc-fonts",	"ibm_vga_8x16",		16);
	process("oldschool-pc-fonts",	"ibm_vga_9x16",		16);
	process("oldschool-pc-fonts",	"dos_v_ibm_8x19",	20);
	process("oldschool-pc-fonts",	"cl_stringray_8x19",	20);
	process("oldschool-pc-fonts",	"ibm_xga_ai_12x20",	20);
	process("oldschool-pc-fonts",	"ibm_xga_ai_12x23",	24);
	process("oldschool-pc-fonts",	"dos_v_re_12x30",	32);
	free(pix);
}
