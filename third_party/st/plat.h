/* See LICENSE for license details. */

/* platform-specific functions */

void Xbell(TMint trm);

/* deq's bytes starting at byti, null-terminated, are base-64 encoded */
void Xosc52copy(TMint trm, TMint deq, TMint byti);

void Xdrawglyph(TMint trm, TMint gf, int cx, int cy);
void Xdrawrect(TMint clor, TMint x0, TMint y0, TMint w, TMint h);
void Xdrawline(TMint trm, int x1, int y1, int x2);
void Xfinishdraw(TMint trm);
/* Reports that a palette index has changed its rgb setting. */
void Xsetcolor(int trm, int pi, int rgb);
void Xicontitl(TMint deq, TMint off);
void Xsettitle(TMint deq, TMint off);
void Xsetpointermotion(int set);
void Xximspot(TMint trm, int cx, int cy);
void Xprint(TMint deq);

void Ttywriteraw(TMint trm, TMint dq, TMint of, TMint sz);

/* Writes the number of ms since an arbitrary point in the past to ms. ms has
   two fields - the first is the upper 31 bits and the second is the lower 31
   bits. */
void Now(TMint ms);
