/* See LICENSE for license details. */

/* This has been changed from the original to support
a. returning length from reslen
b. specifying end via en (en==0 means to terminate at first null byte)
c. support base64url in addition to base64 */
char *base64dec(const char *src, const char *en, unsigned *reslen);
