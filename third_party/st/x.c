/* See LICENSE for license details. */
#include <wchar.h>
#include <errno.h>
#include <math.h>
#include <limits.h>
#include <locale.h>
#include <signal.h>
#include <sys/select.h>
#include <time.h>
#include <unistd.h>
#include <termios.h>
#include <libgen.h>
#include <X11/Xatom.h>
#include <X11/Xlib.h>
#include <X11/cursorfont.h>
#include <X11/keysym.h>
#include <X11/Xft/Xft.h>
#include <X11/XKBlib.h>
#include <ctype.h>
#include <sys/ioctl.h>

#include "tm.c"
#include "third_party/st/plat.h"
#include "third_party/st/tmeng"
#include "third_party/st/tmengui"

typedef unsigned char uchar;
typedef unsigned int uint;
typedef unsigned long ulong;
typedef unsigned short ushort;
typedef TMint Rune;

#define ATTRCMP(a, b)	(	(a)[GLYPH_MODE]	!= (b)[GLYPH_MODE]	|| \
				(a)[GLYPH_FG]	!= (b)[GLYPH_FG]	|| \
				(a)[GLYPH_BG]	!= (b)[GLYPH_BG])

#define LEN(a)			(sizeof(a) / sizeof(a)[0])

#define DIVCEIL(n, d)		(((n) + ((d) - 1)) / (d))

#define ATTR_BOLD_FAINT (ATTR_BOLD | ATTR_FAINT)

char *argv0;
#include "third_party/st/arg.h"
#include "third_party/st/posix.h"

/* types used in config.h */
typedef union {
	int i;
	uint ui;
	float f;
	const void *v;
	char *s;
} Arg;

typedef struct {
	uint mod;
	KeySym keysym;
	void (*func)(TMint, const Arg *);
	const Arg arg;
} Shortcut;

typedef struct {
	uint mod;
	uint button;
	void (*func)(TMint, const Arg *);
	const Arg arg;
	uint  release;
} MouseShortcut;

typedef struct {
	KeySym k;
	uint mask;
	char *s;
	/* three-valued logic variables: 0 indifferent, 1 on, -1 off */
	signed char appkey;    /* application keypad */
	signed char appcursor; /* application cursor */
} Key;

/* X modifiers */
#define XK_ANY_MOD    UINT_MAX
#define XK_NO_MOD     0
#define XK_SWITCH_MOD (1<<13|1<<14)

/* function definitions used in config.h */
static void clipcopy(TMint, const Arg *);
static void clippaste(TMint, const Arg *);
static void numlock(TMint, const Arg *);
static void selpaste(TMint, const Arg *);
static void zoom(TMint, const Arg *);
static void zoomabs(TMint, const Arg *);
static void zoomreset(TMint, const Arg *);
static void ttysend(TMint, const Arg *);
static void printscreen(TMint, const Arg *);
static void printsel(TMint, const Arg *);
static void sendbreak(TMint, const Arg *);
static void toggleprinter(TMint, const Arg *);
static void ttyresize(TMint trm, int tw, int th);
static size_t ttyread(TMint trm);

/*
 * appearance
 *
 * font: see http://freedesktop.org/software/fontconfig/fontconfig-user.html
 */
static char *font = "Liberation Mono:pixelsize=12:antialias=true:autohint=true";

/*
 * What program is execed by st depends of these precedence rules:
 * 1: program passed with -e
 * 2: scroll and/or utmp
 * 3: SHELL environment variable
 * 4: value of shell in /etc/passwd
 * 5: value of shell in config.h
 */
static char *shell = "/bin/sh";

/* Kerning / character bounding-box multipliers */
static float cwscale = 1.0;
static float chscale = 1.0;

/*
 * draw latency range in ms - from new content/keypress/etc until drawing.
 * within this range, st draws when content stops arriving (idle). mostly it's
 * near minlatency, but it waits longer for slow updates to avoid partial draw.
 * low minlatency will tear/flicker more, as it can "detect" idle too early.
 */
static double minlatency = 8;
static double maxlatency = 33;

/*
 * blinking timeout (set to 0 to disable blinking) for the terminal blinking
 * attribute.
 */
static unsigned int blinktimeout = 800;

/*
 * bell volume. It must be a value between -100 and 100. Use 0 for disabling
 * it
 */
static int bellvolume = 0;

/*
 * Default columns and rows numbers
 */

static unsigned int cols = 80;
static unsigned int rows = 24;

/*
 * Default colour and shape of the mouse cursor
 */
static unsigned int mouseshape = XC_xterm;
static unsigned int mousefg = 7;
static unsigned int mousebg = 0;

/*
 * Color used to display font attributes when fontconfig selected a font which
 * doesn't match the ones requested.
 */
static unsigned int defaultattr = 11;

/*
 * Force mouse select/shortcuts while mask is active (when MODE_MOUSE is set).
 * Note that if you want to use ShiftMask with selmasks, set this to an other
 * modifier, set to 0 to not use it.
 */
static uint forcemousemod = ShiftMask;

static unsigned borderpx = 2;

/*
 * Internal mouse shortcuts.
 * Beware that overloading Button1 will disable the selection.
 */
static MouseShortcut mshortcuts[] = {
	/* mask                 button   function        argument       release */
	{ XK_ANY_MOD,           Button2, selpaste,       {.i = 0},      1 },
	{ ShiftMask,            Button4, ttysend,        {.s = "\033[5;2~"} },
	{ XK_ANY_MOD,           Button4, ttysend,        {.s = "\031"} },
	{ ShiftMask,            Button5, ttysend,        {.s = "\033[6;2~"} },
	{ XK_ANY_MOD,           Button5, ttysend,        {.s = "\005"} },
};

/* Internal keyboard shortcuts. */
#define MODKEY Mod1Mask
#define TERMMOD (ControlMask|ShiftMask)

static Shortcut shortcuts[] = {
	/* mask                 keysym          function        argument */
	{ XK_ANY_MOD,           XK_Break,       sendbreak,      {.i =  0} },
	{ ControlMask,          XK_Print,       toggleprinter,  {.i =  0} },
	{ ShiftMask,            XK_Print,       printscreen,    {.i =  0} },
	{ XK_ANY_MOD,           XK_Print,       printsel,       {.i =  0} },
	{ TERMMOD,              XK_Prior,       zoom,           {.f = +1} },
	{ TERMMOD,              XK_Next,        zoom,           {.f = -1} },
	{ TERMMOD,              XK_Home,        zoomreset,      {.f =  0} },
	{ TERMMOD,              XK_C,           clipcopy,       {.i =  0} },
	{ TERMMOD,              XK_V,           clippaste,      {.i =  0} },
	{ TERMMOD,              XK_Y,           selpaste,       {.i =  0} },
	{ ShiftMask,            XK_Insert,      selpaste,       {.i =  0} },
	{ TERMMOD,              XK_Num_Lock,    numlock,        {.i =  0} },
};

/*
 * Special keys (change & recompile st.info accordingly)
 *
 * Mask value:
 * * Use XK_ANY_MOD to match the key no matter modifiers state
 * * Use XK_NO_MOD to match the key alone (no modifiers)
 * appkey value:
 * * 0: no value
 * * > 0: keypad application mode enabled
 * *   = 2: term.numlock = 1
 * * < 0: keypad application mode disabled
 * appcursor value:
 * * 0: no value
 * * > 0: cursor application mode enabled
 * * < 0: cursor application mode disabled
 *
 * Be careful with the order of the definitions because st searches in
 * this table sequentially, so any XK_ANY_MOD must be in the last
 * position for a key.
 */

/*
 * If you want keys other than the X11 function keys (0xFD00 - 0xFFFF)
 * to be mapped below, add them to this array.
 */
static KeySym mappedkeys[] = { -1 };

/*
 * State bits to ignore when matching key or button events.  By default,
 * numlock (Mod2Mask) and keyboard layout (XK_SWITCH_MOD) are ignored.
 */
static uint ignoremod = Mod2Mask|XK_SWITCH_MOD;

/*
 * This is the huge key array which defines all compatibility to the Linux
 * world. Please decide about changes wisely.
 */
static Key key[] = {
	/* keysym           mask            string      appkey appcursor */
	{ XK_KP_Home,       ShiftMask,      "\033[2J",       0,   -1},
	{ XK_KP_Home,       ShiftMask,      "\033[1;2H",     0,   +1},
	{ XK_KP_Home,       XK_ANY_MOD,     "\033[H",        0,   -1},
	{ XK_KP_Home,       XK_ANY_MOD,     "\033[1~",       0,   +1},
	{ XK_KP_Up,         XK_ANY_MOD,     "\033Ox",       +1,    0},
	{ XK_KP_Up,         XK_ANY_MOD,     "\033[A",        0,   -1},
	{ XK_KP_Up,         XK_ANY_MOD,     "\033OA",        0,   +1},
	{ XK_KP_Down,       XK_ANY_MOD,     "\033Or",       +1,    0},
	{ XK_KP_Down,       XK_ANY_MOD,     "\033[B",        0,   -1},
	{ XK_KP_Down,       XK_ANY_MOD,     "\033OB",        0,   +1},
	{ XK_KP_Left,       XK_ANY_MOD,     "\033Ot",       +1,    0},
	{ XK_KP_Left,       XK_ANY_MOD,     "\033[D",        0,   -1},
	{ XK_KP_Left,       XK_ANY_MOD,     "\033OD",        0,   +1},
	{ XK_KP_Right,      XK_ANY_MOD,     "\033Ov",       +1,    0},
	{ XK_KP_Right,      XK_ANY_MOD,     "\033[C",        0,   -1},
	{ XK_KP_Right,      XK_ANY_MOD,     "\033OC",        0,   +1},
	{ XK_KP_Prior,      ShiftMask,      "\033[5;2~",     0,    0},
	{ XK_KP_Prior,      XK_ANY_MOD,     "\033[5~",       0,    0},
	{ XK_KP_Begin,      XK_ANY_MOD,     "\033[E",        0,    0},
	{ XK_KP_End,        ControlMask,    "\033[J",       -1,    0},
	{ XK_KP_End,        ControlMask,    "\033[1;5F",    +1,    0},
	{ XK_KP_End,        ShiftMask,      "\033[K",       -1,    0},
	{ XK_KP_End,        ShiftMask,      "\033[1;2F",    +1,    0},
	{ XK_KP_End,        XK_ANY_MOD,     "\033[4~",       0,    0},
	{ XK_KP_Next,       ShiftMask,      "\033[6;2~",     0,    0},
	{ XK_KP_Next,       XK_ANY_MOD,     "\033[6~",       0,    0},
	{ XK_KP_Insert,     ShiftMask,      "\033[2;2~",    +1,    0},
	{ XK_KP_Insert,     ShiftMask,      "\033[4l",      -1,    0},
	{ XK_KP_Insert,     ControlMask,    "\033[L",       -1,    0},
	{ XK_KP_Insert,     ControlMask,    "\033[2;5~",    +1,    0},
	{ XK_KP_Insert,     XK_ANY_MOD,     "\033[4h",      -1,    0},
	{ XK_KP_Insert,     XK_ANY_MOD,     "\033[2~",      +1,    0},
	{ XK_KP_Delete,     ControlMask,    "\033[M",       -1,    0},
	{ XK_KP_Delete,     ControlMask,    "\033[3;5~",    +1,    0},
	{ XK_KP_Delete,     ShiftMask,      "\033[2K",      -1,    0},
	{ XK_KP_Delete,     ShiftMask,      "\033[3;2~",    +1,    0},
	{ XK_KP_Delete,     XK_ANY_MOD,     "\033[P",       -1,    0},
	{ XK_KP_Delete,     XK_ANY_MOD,     "\033[3~",      +1,    0},
	{ XK_KP_Multiply,   XK_ANY_MOD,     "\033Oj",       +2,    0},
	{ XK_KP_Add,        XK_ANY_MOD,     "\033Ok",       +2,    0},
	{ XK_KP_Enter,      XK_ANY_MOD,     "\033OM",       +2,    0},
	{ XK_KP_Enter,      XK_ANY_MOD,     "\r",           -1,    0},
	{ XK_KP_Subtract,   XK_ANY_MOD,     "\033Om",       +2,    0},
	{ XK_KP_Decimal,    XK_ANY_MOD,     "\033On",       +2,    0},
	{ XK_KP_Divide,     XK_ANY_MOD,     "\033Oo",       +2,    0},
	{ XK_KP_0,          XK_ANY_MOD,     "\033Op",       +2,    0},
	{ XK_KP_1,          XK_ANY_MOD,     "\033Oq",       +2,    0},
	{ XK_KP_2,          XK_ANY_MOD,     "\033Or",       +2,    0},
	{ XK_KP_3,          XK_ANY_MOD,     "\033Os",       +2,    0},
	{ XK_KP_4,          XK_ANY_MOD,     "\033Ot",       +2,    0},
	{ XK_KP_5,          XK_ANY_MOD,     "\033Ou",       +2,    0},
	{ XK_KP_6,          XK_ANY_MOD,     "\033Ov",       +2,    0},
	{ XK_KP_7,          XK_ANY_MOD,     "\033Ow",       +2,    0},
	{ XK_KP_8,          XK_ANY_MOD,     "\033Ox",       +2,    0},
	{ XK_KP_9,          XK_ANY_MOD,     "\033Oy",       +2,    0},
	{ XK_Up,            ShiftMask,      "\033[1;2A",     0,    0},
	{ XK_Up,            Mod1Mask,       "\033[1;3A",     0,    0},
	{ XK_Up,         ShiftMask|Mod1Mask,"\033[1;4A",     0,    0},
	{ XK_Up,            ControlMask,    "\033[1;5A",     0,    0},
	{ XK_Up,      ShiftMask|ControlMask,"\033[1;6A",     0,    0},
	{ XK_Up,       ControlMask|Mod1Mask,"\033[1;7A",     0,    0},
	{ XK_Up,ShiftMask|ControlMask|Mod1Mask,"\033[1;8A",  0,    0},
	{ XK_Up,            XK_ANY_MOD,     "\033[A",        0,   -1},
	{ XK_Up,            XK_ANY_MOD,     "\033OA",        0,   +1},
	{ XK_Down,          ShiftMask,      "\033[1;2B",     0,    0},
	{ XK_Down,          Mod1Mask,       "\033[1;3B",     0,    0},
	{ XK_Down,       ShiftMask|Mod1Mask,"\033[1;4B",     0,    0},
	{ XK_Down,          ControlMask,    "\033[1;5B",     0,    0},
	{ XK_Down,    ShiftMask|ControlMask,"\033[1;6B",     0,    0},
	{ XK_Down,     ControlMask|Mod1Mask,"\033[1;7B",     0,    0},
	{ XK_Down,ShiftMask|ControlMask|Mod1Mask,"\033[1;8B",0,    0},
	{ XK_Down,          XK_ANY_MOD,     "\033[B",        0,   -1},
	{ XK_Down,          XK_ANY_MOD,     "\033OB",        0,   +1},
	{ XK_Left,          ShiftMask,      "\033[1;2D",     0,    0},
	{ XK_Left,          Mod1Mask,       "\033[1;3D",     0,    0},
	{ XK_Left,       ShiftMask|Mod1Mask,"\033[1;4D",     0,    0},
	{ XK_Left,          ControlMask,    "\033[1;5D",     0,    0},
	{ XK_Left,    ShiftMask|ControlMask,"\033[1;6D",     0,    0},
	{ XK_Left,     ControlMask|Mod1Mask,"\033[1;7D",     0,    0},
	{ XK_Left,ShiftMask|ControlMask|Mod1Mask,"\033[1;8D",0,    0},
	{ XK_Left,          XK_ANY_MOD,     "\033[D",        0,   -1},
	{ XK_Left,          XK_ANY_MOD,     "\033OD",        0,   +1},
	{ XK_Right,         ShiftMask,      "\033[1;2C",     0,    0},
	{ XK_Right,         Mod1Mask,       "\033[1;3C",     0,    0},
	{ XK_Right,      ShiftMask|Mod1Mask,"\033[1;4C",     0,    0},
	{ XK_Right,         ControlMask,    "\033[1;5C",     0,    0},
	{ XK_Right,   ShiftMask|ControlMask,"\033[1;6C",     0,    0},
	{ XK_Right,    ControlMask|Mod1Mask,"\033[1;7C",     0,    0},
	{ XK_Right,ShiftMask|ControlMask|Mod1Mask,"\033[1;8C",0,   0},
	{ XK_Right,         XK_ANY_MOD,     "\033[C",        0,   -1},
	{ XK_Right,         XK_ANY_MOD,     "\033OC",        0,   +1},
	{ XK_ISO_Left_Tab,  ShiftMask,      "\033[Z",        0,    0},
	{ XK_Return,        Mod1Mask,       "\033\r",        0,    0},
	{ XK_Return,        XK_ANY_MOD,     "\r",            0,    0},
	{ XK_Insert,        ShiftMask,      "\033[4l",      -1,    0},
	{ XK_Insert,        ShiftMask,      "\033[2;2~",    +1,    0},
	{ XK_Insert,        ControlMask,    "\033[L",       -1,    0},
	{ XK_Insert,        ControlMask,    "\033[2;5~",    +1,    0},
	{ XK_Insert,        XK_ANY_MOD,     "\033[4h",      -1,    0},
	{ XK_Insert,        XK_ANY_MOD,     "\033[2~",      +1,    0},
	{ XK_Delete,        ControlMask,    "\033[M",       -1,    0},
	{ XK_Delete,        ControlMask,    "\033[3;5~",    +1,    0},
	{ XK_Delete,        ShiftMask,      "\033[2K",      -1,    0},
	{ XK_Delete,        ShiftMask,      "\033[3;2~",    +1,    0},
	{ XK_Delete,        XK_ANY_MOD,     "\033[P",       -1,    0},
	{ XK_Delete,        XK_ANY_MOD,     "\033[3~",      +1,    0},
	{ XK_BackSpace,     XK_NO_MOD,      "\177",          0,    0},
	{ XK_BackSpace,     Mod1Mask,       "\033\177",      0,    0},
	{ XK_Home,          ShiftMask,      "\033[2J",       0,   -1},
	{ XK_Home,          ShiftMask,      "\033[1;2H",     0,   +1},
	{ XK_Home,          XK_ANY_MOD,     "\033[H",        0,   -1},
	{ XK_Home,          XK_ANY_MOD,     "\033[1~",       0,   +1},
	{ XK_End,           ControlMask,    "\033[J",       -1,    0},
	{ XK_End,           ControlMask,    "\033[1;5F",    +1,    0},
	{ XK_End,           ShiftMask,      "\033[K",       -1,    0},
	{ XK_End,           ShiftMask,      "\033[1;2F",    +1,    0},
	{ XK_End,           XK_ANY_MOD,     "\033[4~",       0,    0},
	{ XK_Prior,         ControlMask,    "\033[5;5~",     0,    0},
	{ XK_Prior,         ShiftMask,      "\033[5;2~",     0,    0},
	{ XK_Prior,         XK_ANY_MOD,     "\033[5~",       0,    0},
	{ XK_Next,          ControlMask,    "\033[6;5~",     0,    0},
	{ XK_Next,          ShiftMask,      "\033[6;2~",     0,    0},
	{ XK_Next,          XK_ANY_MOD,     "\033[6~",       0,    0},
	{ XK_F1,            XK_NO_MOD,      "\033OP" ,       0,    0},
	{ XK_F1, /* F13 */  ShiftMask,      "\033[1;2P",     0,    0},
	{ XK_F1, /* F25 */  ControlMask,    "\033[1;5P",     0,    0},
	{ XK_F1, /* F37 */  Mod4Mask,       "\033[1;6P",     0,    0},
	{ XK_F1, /* F49 */  Mod1Mask,       "\033[1;3P",     0,    0},
	{ XK_F1, /* F61 */  Mod3Mask,       "\033[1;4P",     0,    0},
	{ XK_F2,            XK_NO_MOD,      "\033OQ" ,       0,    0},
	{ XK_F2, /* F14 */  ShiftMask,      "\033[1;2Q",     0,    0},
	{ XK_F2, /* F26 */  ControlMask,    "\033[1;5Q",     0,    0},
	{ XK_F2, /* F38 */  Mod4Mask,       "\033[1;6Q",     0,    0},
	{ XK_F2, /* F50 */  Mod1Mask,       "\033[1;3Q",     0,    0},
	{ XK_F2, /* F62 */  Mod3Mask,       "\033[1;4Q",     0,    0},
	{ XK_F3,            XK_NO_MOD,      "\033OR" ,       0,    0},
	{ XK_F3, /* F15 */  ShiftMask,      "\033[1;2R",     0,    0},
	{ XK_F3, /* F27 */  ControlMask,    "\033[1;5R",     0,    0},
	{ XK_F3, /* F39 */  Mod4Mask,       "\033[1;6R",     0,    0},
	{ XK_F3, /* F51 */  Mod1Mask,       "\033[1;3R",     0,    0},
	{ XK_F3, /* F63 */  Mod3Mask,       "\033[1;4R",     0,    0},
	{ XK_F4,            XK_NO_MOD,      "\033OS" ,       0,    0},
	{ XK_F4, /* F16 */  ShiftMask,      "\033[1;2S",     0,    0},
	{ XK_F4, /* F28 */  ControlMask,    "\033[1;5S",     0,    0},
	{ XK_F4, /* F40 */  Mod4Mask,       "\033[1;6S",     0,    0},
	{ XK_F4, /* F52 */  Mod1Mask,       "\033[1;3S",     0,    0},
	{ XK_F5,            XK_NO_MOD,      "\033[15~",      0,    0},
	{ XK_F5, /* F17 */  ShiftMask,      "\033[15;2~",    0,    0},
	{ XK_F5, /* F29 */  ControlMask,    "\033[15;5~",    0,    0},
	{ XK_F5, /* F41 */  Mod4Mask,       "\033[15;6~",    0,    0},
	{ XK_F5, /* F53 */  Mod1Mask,       "\033[15;3~",    0,    0},
	{ XK_F6,            XK_NO_MOD,      "\033[17~",      0,    0},
	{ XK_F6, /* F18 */  ShiftMask,      "\033[17;2~",    0,    0},
	{ XK_F6, /* F30 */  ControlMask,    "\033[17;5~",    0,    0},
	{ XK_F6, /* F42 */  Mod4Mask,       "\033[17;6~",    0,    0},
	{ XK_F6, /* F54 */  Mod1Mask,       "\033[17;3~",    0,    0},
	{ XK_F7,            XK_NO_MOD,      "\033[18~",      0,    0},
	{ XK_F7, /* F19 */  ShiftMask,      "\033[18;2~",    0,    0},
	{ XK_F7, /* F31 */  ControlMask,    "\033[18;5~",    0,    0},
	{ XK_F7, /* F43 */  Mod4Mask,       "\033[18;6~",    0,    0},
	{ XK_F7, /* F55 */  Mod1Mask,       "\033[18;3~",    0,    0},
	{ XK_F8,            XK_NO_MOD,      "\033[19~",      0,    0},
	{ XK_F8, /* F20 */  ShiftMask,      "\033[19;2~",    0,    0},
	{ XK_F8, /* F32 */  ControlMask,    "\033[19;5~",    0,    0},
	{ XK_F8, /* F44 */  Mod4Mask,       "\033[19;6~",    0,    0},
	{ XK_F8, /* F56 */  Mod1Mask,       "\033[19;3~",    0,    0},
	{ XK_F9,            XK_NO_MOD,      "\033[20~",      0,    0},
	{ XK_F9, /* F21 */  ShiftMask,      "\033[20;2~",    0,    0},
	{ XK_F9, /* F33 */  ControlMask,    "\033[20;5~",    0,    0},
	{ XK_F9, /* F45 */  Mod4Mask,       "\033[20;6~",    0,    0},
	{ XK_F9, /* F57 */  Mod1Mask,       "\033[20;3~",    0,    0},
	{ XK_F10,           XK_NO_MOD,      "\033[21~",      0,    0},
	{ XK_F10, /* F22 */ ShiftMask,      "\033[21;2~",    0,    0},
	{ XK_F10, /* F34 */ ControlMask,    "\033[21;5~",    0,    0},
	{ XK_F10, /* F46 */ Mod4Mask,       "\033[21;6~",    0,    0},
	{ XK_F10, /* F58 */ Mod1Mask,       "\033[21;3~",    0,    0},
	{ XK_F11,           XK_NO_MOD,      "\033[23~",      0,    0},
	{ XK_F11, /* F23 */ ShiftMask,      "\033[23;2~",    0,    0},
	{ XK_F11, /* F35 */ ControlMask,    "\033[23;5~",    0,    0},
	{ XK_F11, /* F47 */ Mod4Mask,       "\033[23;6~",    0,    0},
	{ XK_F11, /* F59 */ Mod1Mask,       "\033[23;3~",    0,    0},
	{ XK_F12,           XK_NO_MOD,      "\033[24~",      0,    0},
	{ XK_F12, /* F24 */ ShiftMask,      "\033[24;2~",    0,    0},
	{ XK_F12, /* F36 */ ControlMask,    "\033[24;5~",    0,    0},
	{ XK_F12, /* F48 */ Mod4Mask,       "\033[24;6~",    0,    0},
	{ XK_F12, /* F60 */ Mod1Mask,       "\033[24;3~",    0,    0},
	{ XK_F13,           XK_NO_MOD,      "\033[1;2P",     0,    0},
	{ XK_F14,           XK_NO_MOD,      "\033[1;2Q",     0,    0},
	{ XK_F15,           XK_NO_MOD,      "\033[1;2R",     0,    0},
	{ XK_F16,           XK_NO_MOD,      "\033[1;2S",     0,    0},
	{ XK_F17,           XK_NO_MOD,      "\033[15;2~",    0,    0},
	{ XK_F18,           XK_NO_MOD,      "\033[17;2~",    0,    0},
	{ XK_F19,           XK_NO_MOD,      "\033[18;2~",    0,    0},
	{ XK_F20,           XK_NO_MOD,      "\033[19;2~",    0,    0},
	{ XK_F21,           XK_NO_MOD,      "\033[20;2~",    0,    0},
	{ XK_F22,           XK_NO_MOD,      "\033[21;2~",    0,    0},
	{ XK_F23,           XK_NO_MOD,      "\033[23;2~",    0,    0},
	{ XK_F24,           XK_NO_MOD,      "\033[24;2~",    0,    0},
	{ XK_F25,           XK_NO_MOD,      "\033[1;5P",     0,    0},
	{ XK_F26,           XK_NO_MOD,      "\033[1;5Q",     0,    0},
	{ XK_F27,           XK_NO_MOD,      "\033[1;5R",     0,    0},
	{ XK_F28,           XK_NO_MOD,      "\033[1;5S",     0,    0},
	{ XK_F29,           XK_NO_MOD,      "\033[15;5~",    0,    0},
	{ XK_F30,           XK_NO_MOD,      "\033[17;5~",    0,    0},
	{ XK_F31,           XK_NO_MOD,      "\033[18;5~",    0,    0},
	{ XK_F32,           XK_NO_MOD,      "\033[19;5~",    0,    0},
	{ XK_F33,           XK_NO_MOD,      "\033[20;5~",    0,    0},
	{ XK_F34,           XK_NO_MOD,      "\033[21;5~",    0,    0},
	{ XK_F35,           XK_NO_MOD,      "\033[23;5~",    0,    0},
};

/*
 * Selection types' masks.
 * Use the same masks as usual.
 * Button1Mask is always unset, to make masks match between ButtonPress.
 * ButtonRelease and MotionNotify.
 * If no match is found, regular selection is used.
 */
static uint selmasks[] = {
	[SEL_RECTANGULAR] = Mod1Mask,
};

/*
 * Printable characters in ASCII, used to estimate the advance width
 * of single wide characters.
 */
static char ascii_printable[] =
	" !\"#$%&'()*+,-./0123456789:;<=>?"
	"@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_"
	"`abcdefghijklmnopqrstuvwxyz{|}~";

static char termname[] = "st-256color";

/* XEMBED messages */
#define XEMBED_FOCUS_IN  4
#define XEMBED_FOCUS_OUT 5

/* macros */
#define TRUERED(x)		(((x) & 0xff0000) >> 8)
#define TRUEGREEN(x)		(((x) & 0xff00))
#define TRUEBLUE(x)		(((x) & 0xff) << 8)

typedef XftDraw *Draw;
typedef XftColor Color;
typedef XftGlyphFontSpec GlyphFontSpec;

/* Purely graphic info */
typedef struct {
	int tw, th; /* tty width and height */
	int w, h; /* window width and height */
} TermWindow;

typedef struct {
	Display *dpy;
	Colormap cmap;
	Window win;
	Drawable buf;
	GlyphFontSpec *specbuf; /* font spec buffer used for rendering */
	Atom xembed, wmdeletewin, netwmname, netwmiconname, netwmpid;
	struct {
		XIM xim;
		XIC xic;
		XPoint spot;
		XVaNestedList spotlist;
	} ime;
	Draw draw;
	Visual *vis;
	XSetWindowAttributes attrs;
	int scr;
	int isfixed; /* is fixed geometry? */
	int l, t; /* left and top offset */
	int gm; /* geometry mask */
} XWindow;

typedef struct {
	Atom xtarget;
	char *primary, *clipboard;
} XSelection;

/* Font structure */
#define Font Font_
typedef struct {
	int height;
	int width;
	int ascent;
	int descent;
	int badslant;
	int badweight;
	short lbearing;
	short rbearing;
	XftFont *match;
	FcFontSet *set;
	FcPattern *pattern;
} Font;

/* Drawing Context */
typedef struct {
	Color col[PALETTESIZ];
	Font font, bfont, ifont, ibfont;
	GC gc;
} DC;

static inline ushort sixd_to_16bit(int);
static int xmakeglyphfontspecs(
	TMint trm,		XftGlyphFontSpec *, const TMint *g, int len,
	int x, int y);
static void xdrawglyphfontspecs(
	TMint trm, const	XftGlyphFontSpec *, const TMint *base_, int len,
	int x, int y);

static void xclear(TMint, int, int, int, int);
static int xgeommasktogravity(int);
static int ximopen(Display *);
static void ximinstantiate(Display *, XPointer, XPointer);
static void ximdestroy(XIM, XPointer, XPointer);
static int xicdestroy(XIC, XPointer, XPointer);
static void xinit(TMint, int, int);
static void cresize(TMint, int, int);
static void xresize(TMint, int, int);
static void xhints(TMint trm);
static int xloadcolor(int rgb, Color *ncolor);
static int xloadfont(Font *, FcPattern *);
static void xloadfonts(TMint trm, const char *, double);
static void xunloadfont(Font *);
static void xunloadfonts(void);
static void xsetenv(void);
static void xseturgency(int);
static int evcol(TMint trm, XEvent *);
static int evrow(TMint trm, XEvent *);

static void expose(TMint, XEvent *);
static void visibility(TMint, XEvent *);
static void unmap(TMint, XEvent *);
static void kpress(TMint, XEvent *);
static void cmessage(TMint, XEvent *);
static void resize(TMint, XEvent *);
static void focus(TMint, XEvent *);
static uint buttonmask(uint);
static int mouseaction(TMint, XEvent *, uint);
static void brelease(TMint, XEvent *);
static void bpress(TMint, XEvent *);
static void bmotion(TMint, XEvent *);
static void propnotify(TMint, XEvent *);
static void selnotify(TMint, XEvent *);
static void selclear_(TMint, XEvent *);
static void selrequest(TMint, XEvent *);
static void setsel(TMint, char *, Time);
static void mousesel(TMint, XEvent *, int);
static void mousereport(TMint, XEvent *);
static char *kmap(TMint trm, KeySym, uint);
static int match(uint, uint);
static char *base64dec(const char *);
static char base64dec_getc(const char **);

static void run(TMint);
static void usage(void);

static void (*handler[LASTEvent])(TMint, XEvent *) = {
	[KeyPress] = kpress,
	[ClientMessage] = cmessage,
	[ConfigureNotify] = resize,
	[VisibilityNotify] = visibility,
	[UnmapNotify] = unmap,
	[Expose] = expose,
	[FocusIn] = focus,
	[FocusOut] = focus,
	[MotionNotify] = bmotion,
	[ButtonPress] = bpress,
	[ButtonRelease] = brelease,
/*
 * Uncomment if you want the selection to disappear when you select something
 * different in another window.
 */
/*	[SelectionClear] = selclear_, */
	[SelectionNotify] = selnotify,
/*
 * PropertyNotify is only turned on when there is some INCR transfer happening
 * for the selection retrieval.
 */
	[PropertyNotify] = propnotify,
	[SelectionRequest] = selrequest,
};

/* Globals */
static DC dc;
static XWindow xw;
static XSelection xsel;
static TermWindow win;

/* Font Ring Cache */
enum {
	FRC_NORMAL,
	FRC_ITALIC,
	FRC_BOLD,
	FRC_ITALICBOLD
};

typedef struct {
	XftFont *font;
	int flags;
	Rune unicodep;
} Fontcache;

/* Fontcache is an array now. A new font will be appended to the array. */
static Fontcache *frc = NULL;
static int frclen = 0;
static int frccap = 0;
static char *usedfont = NULL;
static double usedfontsize = 0;
static double defaultfontsize = 0;

static char *opt_class = NULL;
static char **opt_cmd  = NULL;
static char *opt_embed = NULL;
static char *opt_font  = NULL;
static char *opt_io    = NULL;
static char *opt_line  = NULL;
static char *opt_name  = NULL;
static char *opt_title = NULL;

static uint buttons; /* bit field of pressed buttons */

static void *
xmalloc(size_t len)
{
	void *p;

	if (!(p = malloc(len))) { perror("malloc"); sriously("memory?"); }

	return p;
}

char
base64dec_getc(const char **src)
{
	while (**src && !isprint((unsigned char)**src))
		(*src)++;
	return **src ? *((*src)++) : '=';  /* emulate padding if string ends */
}

char *
base64dec(const char *src)
{
	size_t in_len = strlen(src);
	char *result, *dst;
	static const char base64_digits[256] = {
		[43] = 62, 0, 0, 0, 63, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61,
		0, 0, 0, -1, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
		13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 0, 0, 0, 0,
		0, 0, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
		40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51
	};

	if (in_len % 4)
		in_len += 4 - (in_len % 4);
	result = dst = xmalloc(in_len / 4 * 3 + 1);
	while (*src) {
		int a = base64_digits[(unsigned char) base64dec_getc(&src)];
		int b = base64_digits[(unsigned char) base64dec_getc(&src)];
		int c = base64_digits[(unsigned char) base64dec_getc(&src)];
		int d = base64_digits[(unsigned char) base64dec_getc(&src)];

		/* invalid input. 'a' can be -1, e.g. if src is "\n" (c-str) */
		if (a == -1 || b == -1)
			break;

		*dst++ = (a << 2) | ((b & 0x30) >> 4);
		if (c == -1)
			break;
		*dst++ = ((b & 0x0f) << 4) | ((c & 0x3c) >> 2);
		if (d == -1)
			break;
		*dst++ = ((c & 0x03) << 6) | d;
	}
	*dst = '\0';
	return result;
}

char *
xstrdup(const char *s)
{
	char *p;

	if ((p = strdup(s)) == NULL)
		die("strdup: %s\n", strerror(errno));

	return p;
}

void
clipcopy(TMint, const Arg *dummy)
{
	Atom clipboard;

	free(xsel.clipboard);
	xsel.clipboard = NULL;

	if (xsel.primary != NULL) {
		xsel.clipboard = xstrdup(xsel.primary);
		clipboard = XInternAtom(xw.dpy, "CLIPBOARD", 0);
		XSetSelectionOwner(xw.dpy, clipboard, xw.win, CurrentTime);
	}
}

void
clippaste(TMint, const Arg *dummy)
{
	Atom clipboard;

	clipboard = XInternAtom(xw.dpy, "CLIPBOARD", 0);
	XConvertSelection(xw.dpy, clipboard, xsel.xtarget, clipboard,
			xw.win, CurrentTime);
}

void
selpaste(TMint, const Arg *dummy)
{
	XConvertSelection(xw.dpy, XA_PRIMARY, xsel.xtarget, XA_PRIMARY,
			xw.win, CurrentTime);
}

void
numlock(TMint trm, const Arg *dummy)
{
	term(trm,mode) ^= MODE_NUMLOCK;
}

void
zoom(TMint trm, const Arg *arg)
{
	Arg larg;

	larg.f = usedfontsize + arg->f;
	zoomabs(trm, &larg);
}

void
zoomabs(TMint trm, const Arg *arg)
{
	xunloadfonts();
	xloadfonts(trm, usedfont, arg->f);
	cresize(trm, 0, 0);
	redraw(trm);
	xhints(trm);
}

void
zoomreset(TMint trm, const Arg *arg)
{
	Arg larg;

	if (defaultfontsize > 0) {
		larg.f = defaultfontsize;
		zoomabs(trm, &larg);
	}
}

void
ttysend(TMint trm, const Arg *arg)
{
	static TMint argdeq;

	argdeq = deqsetutf8(argdeq, arg->s, -1);
	ttywrite(trm, argdeq, -1, 1);
}

int
evcol(TMint trm, XEvent *e)
{
	int x = e->xbutton.x - borderpx;
	LIMIT(x, 0, win.tw - 1);
	return x / term(trm,cw);
}

int
evrow(TMint trm, XEvent *e)
{
	int y = e->xbutton.y - borderpx;
	LIMIT(y, 0, win.th - 1);
	return y / term(trm,ch);
}

void
mousesel(TMint trm, XEvent *e, int done)
{
	int type, seltype = SEL_REGULAR;
	uint state = e->xbutton.state & ~(Button1Mask | forcemousemod);
	TMint selq;

	for (type = 1; type < LEN(selmasks); ++type) {
		if (match(selmasks[type], state)) {
			seltype = type;
			break;
		}
	}
	selextend(trm, evcol(trm, e), evrow(trm, e), seltype, done);
	if (!done) return;

	if (!(selq = getsel(trm))) return;

	setsel(trm, strndup(	deqtostring(selq, 0),
				deqbytsiz(selq)),
	       e->xbutton.time);
	tmfree(selq);
}

void
mousereport(TMint trm, XEvent *e)
{
	int len, btn, code;
	int x = evcol(trm, e), y = evrow(trm, e);
	int state = e->xbutton.state;
	char buf[40];
	static int ox, oy;
	static TMint mrepesc;

	if (e->type == MotionNotify) {
		if (x == ox && y == oy)
			return;
		if (!IS_SET(trm, MODE_MOUSEMOTION) && !IS_SET(trm, MODE_MOUSEMANY))
			return;
		/* MODE_MOUSEMOTION: no reporting if no button is pressed */
		if (IS_SET(trm, MODE_MOUSEMOTION) && buttons == 0)
			return;
		/* Set btn to lowest-numbered pressed button, or 12 if no
		 * buttons are pressed. */
		for (btn = 1; btn <= 11 && !(buttons & (1<<(btn-1))); btn++)
			;
		code = 32;
	} else {
		btn = e->xbutton.button;
		/* Only buttons 1 through 11 can be encoded */
		if (btn < 1 || btn > 11)
			return;
		if (e->type == ButtonRelease) {
			/* MODE_MOUSEX10: no button release reporting */
			if (IS_SET(trm, MODE_MOUSEX10))
				return;
			/* Don't send release events for the scroll wheel */
			if (btn == 4 || btn == 5)
				return;
		}
		code = 0;
	}

	ox = x;
	oy = y;

	/* Encode btn into code. If no button is pressed for a motion event in
	 * MODE_MOUSEMANY, then encode it as a release. */
	if ((!IS_SET(trm, MODE_MOUSESGR) && e->type == ButtonRelease) || btn == 12)
		code += 3;
	else if (btn >= 8)
		code += 128 + btn - 8;
	else if (btn >= 4)
		code += 64 + btn - 4;
	else
		code += btn - 1;

	if (!IS_SET(trm, MODE_MOUSEX10)) {
		code += ((state & ShiftMask  ) ?  4 : 0)
		      + ((state & Mod1Mask   ) ?  8 : 0) /* meta key: alt */
		      + ((state & ControlMask) ? 16 : 0);
	}

	if (IS_SET(trm, MODE_MOUSESGR)) {
		len = snprintf(buf, sizeof(buf), "\033[<%d;%d;%d%c",
				code, x+1, y+1,
				e->type == ButtonRelease ? 'm' : 'M');
	} else if (x < 223 && y < 223) {
		len = snprintf(buf, sizeof(buf), "\033[M%c%c%c",
				32+code, 32+x+1, 32+y+1);
	} else {
		return;
	}

	mrepesc = deqsetutf8(mrepesc, buf, len);
	ttywrite(trm, mrepesc, len, 0);
}

uint
buttonmask(uint button)
{
	return button == Button1 ? Button1Mask
	     : button == Button2 ? Button2Mask
	     : button == Button3 ? Button3Mask
	     : button == Button4 ? Button4Mask
	     : button == Button5 ? Button5Mask
	     : 0;
}

int
mouseaction(TMint trm, XEvent *e, uint release)
{
	MouseShortcut *ms;

	/* ignore Button<N>mask for Button<N> - it's set on release */
	uint state = e->xbutton.state & ~buttonmask(e->xbutton.button);

	for (ms = mshortcuts; ms < mshortcuts + LEN(mshortcuts); ms++) {
		if (ms->release == release &&
		    ms->button == e->xbutton.button &&
		    (match(ms->mod, state) ||  /* exact or forced */
		     match(ms->mod, state & ~forcemousemod))) {
			ms->func(trm, &(ms->arg));
			return 1;
		}
	}

	return 0;
}

void
bpress(TMint trm, XEvent *e)
{
	int btn = e->xbutton.button;

	if (1 <= btn && btn <= 11)
		buttons |= 1 << (btn-1);

	if (IS_SET(trm, MODE_MOUSE) && !(e->xbutton.state & forcemousemod)) {
		mousereport(trm, e);
		return;
	}

	if (mouseaction(trm, e, 0))
		return;

	if (btn == Button1) click2sel(trm, evrow(trm, e), evcol(trm, e));
}

void
propnotify(TMint trm, XEvent *e)
{
	XPropertyEvent *xpev;
	Atom clipboard = XInternAtom(xw.dpy, "CLIPBOARD", 0);

	xpev = &e->xproperty;
	if (xpev->state == PropertyNewValue &&
			(xpev->atom == XA_PRIMARY ||
			 xpev->atom == clipboard)) {
		selnotify(trm, e);
	}
}

void
selnotify(TMint trm, XEvent *e)
{
	ulong nitems, ofs, rem;
	int format;
	uchar *data, *last, *repl;
	Atom type, incratom, property = None;
	static TMint brkpas;

	incratom = XInternAtom(xw.dpy, "INCR", 0);

	ofs = 0;
	if (e->type == SelectionNotify)
		property = e->xselection.property;
	else if (e->type == PropertyNotify)
		property = e->xproperty.atom;

	if (property == None)
		return;

	do {
		if (XGetWindowProperty(xw.dpy, xw.win, property, ofs,
					BUFSIZ/4, False, AnyPropertyType,
					&type, &format, &nitems, &rem,
					&data)) {
			fprintf(stderr, "Clipboard allocation failed\n");
			return;
		}

		if (e->type == PropertyNotify && nitems == 0 && rem == 0) {
			/*
			 * If there is some PropertyNotify with no data, then
			 * this is the signal of the selection owner that all
			 * data has been transferred. We won't need to receive
			 * PropertyNotify events anymore.
			 */
			MODBIT(xw.attrs.event_mask, 0, PropertyChangeMask);
			XChangeWindowAttributes(xw.dpy, xw.win, CWEventMask,
					&xw.attrs);
		}

		if (type == incratom) {
			/*
			 * Activate the PropertyNotify events so we receive
			 * when the selection owner does send us the next
			 * chunk of data.
			 */
			MODBIT(xw.attrs.event_mask, 1, PropertyChangeMask);
			XChangeWindowAttributes(xw.dpy, xw.win, CWEventMask,
					&xw.attrs);

			/*
			 * Deleting the property is the transfer start signal.
			 */
			XDeleteProperty(xw.dpy, xw.win, (int)property);
			continue;
		}

		/*
		 * As seen in getsel:
		 * Line endings are inconsistent in the terminal and GUI world
		 * copy and pasting. When receiving some selection data,
		 * replace all '\n' with '\r'.
		 * FIXME: Fix the computer world.
		 */
		repl = data;
		last = data + nitems * format / 8;
		while ((repl = memchr(repl, '\n', last - repl))) {
			*repl++ = '\r';
		}

		if (IS_SET(trm, MODE_BRCKTPASTE) && ofs == 0) {
			brkpas = deqsetutf8(brkpas, "\033[200~", -1);
			ttywrite(trm, brkpas, -1, 0);
		}
		brkpas = deqsetutf8(brkpas, (char *)data, nitems * format / 8);
		ttywrite(trm, brkpas, -1, 1);
		if (IS_SET(trm, MODE_BRCKTPASTE) && rem == 0) {
			brkpas = deqsetutf8(brkpas, "\033[201~", -1);
			ttywrite(trm, brkpas, -1, 0);
		}
		XFree(data);
		/* number of 32-bit chunks returned */
		ofs += nitems * format / 32;
	} while (rem > 0);

	/*
	 * Deleting the property again tells the selection owner to send the
	 * next data chunk in the property.
	 */
	XDeleteProperty(xw.dpy, xw.win, (int)property);
}

void
selclear_(TMint trm, XEvent *e)
{
	selclear(trm);
}

void
selrequest(TMint trm, XEvent *e)
{
	XSelectionRequestEvent *xsre;
	XSelectionEvent xev;
	Atom xa_targets, string, clipboard;
	char *seltext;

	xsre = (XSelectionRequestEvent *) e;
	xev.type = SelectionNotify;
	xev.requestor = xsre->requestor;
	xev.selection = xsre->selection;
	xev.target = xsre->target;
	xev.time = xsre->time;
	if (xsre->property == None)
		xsre->property = xsre->target;

	/* reject */
	xev.property = None;

	xa_targets = XInternAtom(xw.dpy, "TARGETS", 0);
	if (xsre->target == xa_targets) {
		/* respond with the supported type */
		string = xsel.xtarget;
		XChangeProperty(xsre->display, xsre->requestor, xsre->property,
				XA_ATOM, 32, PropModeReplace,
				(uchar *) &string, 1);
		xev.property = xsre->property;
	} else if (xsre->target == xsel.xtarget || xsre->target == XA_STRING) {
		/*
		 * xith XA_STRING non ascii characters may be incorrect in the
		 * requestor. It is not our problem, use utf8.
		 */
		clipboard = XInternAtom(xw.dpy, "CLIPBOARD", 0);
		if (xsre->selection == XA_PRIMARY) {
			seltext = xsel.primary;
		} else if (xsre->selection == clipboard) {
			seltext = xsel.clipboard;
		} else {
			fprintf(stderr,
				"Unhandled clipboard selection 0x%lx\n",
				xsre->selection);
			return;
		}
		if (seltext != NULL) {
			XChangeProperty(xsre->display, xsre->requestor,
					xsre->property, xsre->target,
					8, PropModeReplace,
					(uchar *)seltext, strlen(seltext));
			xev.property = xsre->property;
		}
	}

	/* all done, send a notification to the listener */
	if (!XSendEvent(xsre->display, xsre->requestor, 1, 0, (XEvent *) &xev))
		fprintf(stderr, "Error sending SelectionNotify event\n");
}

void
setsel(TMint trm, char *str, Time t)
{
	if (!str)
		return;

	free(xsel.primary);
	xsel.primary = str;

	XSetSelectionOwner(xw.dpy, XA_PRIMARY, xw.win, t);
	if (XGetSelectionOwner(xw.dpy, XA_PRIMARY) != xw.win)
		selclear(trm);
}

void Xosc52copy(TMint trm, TMint deq, TMint byti)
{
	char *str = base64dec(deqtostring(deq, byti));
	if (str) {
		setsel(trm, str, CurrentTime);
		clipcopy(trm, NULL);
	}
	else {
		fprintf(stderr, "erresc: invalid base64\n");
	}
}

void
brelease(TMint trm, XEvent *e)
{
	int btn = e->xbutton.button;

	if (1 <= btn && btn <= 11)
		buttons &= ~(1 << (btn-1));

	if (IS_SET(trm, MODE_MOUSE) && !(e->xbutton.state & forcemousemod)) {
		mousereport(trm, e);
		return;
	}

	if (mouseaction(trm, e, 1))
		return;
	if (btn == Button1)
		mousesel(trm, e, 1);
}

void
bmotion(TMint trm, XEvent *e)
{
	if (IS_SET(trm, MODE_MOUSE) && !(e->xbutton.state & forcemousemod)) {
		mousereport(trm, e);
		return;
	}

	mousesel(trm, e, 0);
}

void
cresize(TMint trm, int width, int height)
{
	int col, row;

	if (width != 0)
		win.w = width;
	if (height != 0)
		win.h = height;

	col = (win.w - 2 * borderpx) / term(trm,cw);
	row = (win.h - 2 * borderpx) / term(trm,ch);
	col = MAX(1, col);
	row = MAX(1, row);

	tresize(trm, col, row);
	xresize(trm, col, row);
	ttyresize(trm, win.tw, win.th);
}

static void *xrealloc(void *p, size_t s)
{
	p = realloc(p, s);
	if (!p) { perror("realloc"); exit(1); }
	return p;
}

void
xresize(TMint trm, int col, int row)
{
	win.tw = col * term(trm,cw);
	win.th = row * term(trm,ch);

	XFreePixmap(xw.dpy, xw.buf);
	xw.buf = XCreatePixmap(xw.dpy, xw.win, win.w, win.h,
			DefaultDepth(xw.dpy, xw.scr));
	XftDrawChange(xw.draw, xw.buf);
	xclear(trm, 0, 0, win.w, win.h);

	/* resize to new width */
	xw.specbuf = xrealloc(xw.specbuf, col * sizeof(GlyphFontSpec));
}

ushort
sixd_to_16bit(int x)
{
	return x == 0 ? 0 : 0x3737 + 0x2828 * x;
}

#define expandrgb(rgb, c) do {			\
	(c)->red	= 0xff & (rgb)>>16;	\
	(c)->green	= 0xff & (rgb)>>8;	\
	(c)->blue	= 0xff & (rgb);		\
	(c)->red	|= (c)->red	<< 8;	\
	(c)->green	|= (c)->green	<< 8;	\
	(c)->blue	|= (c)->blue	<< 8;	} while (0)

int
xloadcolor(int rgb, Color *ncolor)
{
	XRenderColor color = { .alpha = 0xffff };

	expandrgb(rgb, &color);
	return XftColorAllocValue(xw.dpy, xw.vis, xw.cmap, &color, ncolor);
}

void
Xsetcolor(int trm, int pi, int rgb)
{
	Color ncolor, *d = dc.col+pi;

	if (!BETWEEN(pi, 0, PALETTESIZ - 1))
		sriously("palette index out of range: %d", pi);

	if (xloadcolor(rgb, &ncolor)) {
		XftColorFree(xw.dpy, xw.vis, xw.cmap, d);
		*d = ncolor;
	}
}

/*
 * Absolute coordinates.
 */
void
xclear(TMint trm, int x1, int y1, int x2, int y2)
{
	XftDrawRect(xw.draw,
			&dc.col[IS_SET(trm, MODE_REVERSE)? DEFAULTFG : DEFAULTBG],
			x1, y1, x2-x1, y2-y1);
}

void
xhints(TMint trm)
{
	XClassHint class = {opt_name ? opt_name : termname,
	                    opt_class ? opt_class : termname};
	XWMHints wm = {.flags = InputHint, .input = 1};
	XSizeHints *sizeh;

	sizeh = XAllocSizeHints();

	sizeh->flags = PSize | PResizeInc | PBaseSize | PMinSize;
	sizeh->height = win.h;
	sizeh->width = win.w;
	sizeh->height_inc = term(trm,ch);
	sizeh->width_inc = term(trm,cw);
	sizeh->base_height = 2 * borderpx;
	sizeh->base_width = 2 * borderpx;
	sizeh->min_height = term(trm,ch) + 2 * borderpx;
	sizeh->min_width = term(trm,cw) + 2 * borderpx;
	if (xw.isfixed) {
		sizeh->flags |= PMaxSize;
		sizeh->min_width = sizeh->max_width = win.w;
		sizeh->min_height = sizeh->max_height = win.h;
	}
	if (xw.gm & (XValue|YValue)) {
		sizeh->flags |= USPosition | PWinGravity;
		sizeh->x = xw.l;
		sizeh->y = xw.t;
		sizeh->win_gravity = xgeommasktogravity(xw.gm);
	}

	XSetWMProperties(xw.dpy, xw.win, NULL, NULL, NULL, 0, sizeh, &wm,
			&class);
	XFree(sizeh);
}

int
xgeommasktogravity(int mask)
{
	switch (mask & (XNegative|YNegative)) {
	case 0:
		return NorthWestGravity;
	case XNegative:
		return NorthEastGravity;
	case YNegative:
		return SouthWestGravity;
	}

	return SouthEastGravity;
}

int
xloadfont(Font *f, FcPattern *pattern)
{
	FcPattern *configured;
	FcPattern *match;
	FcResult result;
	XGlyphInfo extents;
	int wantattr, haveattr;

	/*
	 * Manually configure instead of calling XftMatchFont
	 * so that we can use the configured pattern for
	 * "missing glyph" lookups.
	 */
	configured = FcPatternDuplicate(pattern);
	if (!configured)
		return 1;

	FcConfigSubstitute(NULL, configured, FcMatchPattern);
	XftDefaultSubstitute(xw.dpy, xw.scr, configured);

	match = FcFontMatch(NULL, configured, &result);
	if (!match) {
		FcPatternDestroy(configured);
		return 1;
	}

	if (!(f->match = XftFontOpenPattern(xw.dpy, match))) {
		FcPatternDestroy(configured);
		FcPatternDestroy(match);
		return 1;
	}

	if ((XftPatternGetInteger(pattern, "slant", 0, &wantattr) ==
	    XftResultMatch)) {
		/*
		 * Check if xft was unable to find a font with the appropriate
		 * slant but gave us one anyway. Try to mitigate.
		 */
		if ((XftPatternGetInteger(f->match->pattern, "slant", 0,
		    &haveattr) != XftResultMatch) || haveattr < wantattr) {
			f->badslant = 1;
			fputs("font slant does not match\n", stderr);
		}
	}

	if ((XftPatternGetInteger(pattern, "weight", 0, &wantattr) ==
	    XftResultMatch)) {
		if ((XftPatternGetInteger(f->match->pattern, "weight", 0,
		    &haveattr) != XftResultMatch) || haveattr != wantattr) {
			f->badweight = 1;
			fputs("font weight does not match\n", stderr);
		}
	}

	XftTextExtentsUtf8(xw.dpy, f->match,
		(const FcChar8 *) ascii_printable,
		strlen(ascii_printable), &extents);

	f->set = NULL;
	f->pattern = configured;

	f->ascent = f->match->ascent;
	f->descent = f->match->descent;
	f->lbearing = 0;
	f->rbearing = f->match->max_advance_width;

	f->height = f->ascent + f->descent;
	f->width = DIVCEIL(extents.xOff, strlen(ascii_printable));

	return 0;
}

void
xloadfonts(TMint trm, const char *fontstr, double fontsize)
{
	FcPattern *pattern;
	double fontval;

	if (fontstr[0] == '-')
		pattern = XftXlfdParse(fontstr, False, False);
	else
		pattern = FcNameParse((const FcChar8 *)fontstr);

	if (!pattern)
		die("can't open font %s\n", fontstr);

	if (fontsize > 1) {
		FcPatternDel(pattern, FC_PIXEL_SIZE);
		FcPatternDel(pattern, FC_SIZE);
		FcPatternAddDouble(pattern, FC_PIXEL_SIZE, (double)fontsize);
		usedfontsize = fontsize;
	} else {
		if (FcPatternGetDouble(pattern, FC_PIXEL_SIZE, 0, &fontval) ==
				FcResultMatch) {
			usedfontsize = fontval;
		} else if (FcPatternGetDouble(pattern, FC_SIZE, 0, &fontval) ==
				FcResultMatch) {
			usedfontsize = -1;
		} else {
			/*
			 * Default font size is 12, if none given. This is to
			 * have a known usedfontsize value.
			 */
			FcPatternAddDouble(pattern, FC_PIXEL_SIZE, 12);
			usedfontsize = 12;
		}
		defaultfontsize = usedfontsize;
	}

	if (xloadfont(&dc.font, pattern))
		die("can't open font %s\n", fontstr);

	if (usedfontsize < 0) {
		FcPatternGetDouble(dc.font.match->pattern,
		                   FC_PIXEL_SIZE, 0, &fontval);
		usedfontsize = fontval;
		if (fontsize == 0)
			defaultfontsize = fontval;
	}

	/* Setting character width and height. */
	term(trm,cw) = ceilf(dc.font.width * cwscale);
	term(trm,ch) = ceilf(dc.font.height * chscale);

	FcPatternDel(pattern, FC_SLANT);
	FcPatternAddInteger(pattern, FC_SLANT, FC_SLANT_ITALIC);
	if (xloadfont(&dc.ifont, pattern))
		die("can't open font %s\n", fontstr);

	FcPatternDel(pattern, FC_WEIGHT);
	FcPatternAddInteger(pattern, FC_WEIGHT, FC_WEIGHT_BOLD);
	if (xloadfont(&dc.ibfont, pattern))
		die("can't open font %s\n", fontstr);

	FcPatternDel(pattern, FC_SLANT);
	FcPatternAddInteger(pattern, FC_SLANT, FC_SLANT_ROMAN);
	if (xloadfont(&dc.bfont, pattern))
		die("can't open font %s\n", fontstr);

	FcPatternDestroy(pattern);
}

void
xunloadfont(Font *f)
{
	XftFontClose(xw.dpy, f->match);
	FcPatternDestroy(f->pattern);
	if (f->set)
		FcFontSetDestroy(f->set);
}

void
xunloadfonts(void)
{
	/* Free the loaded fonts in the font cache.  */
	while (frclen > 0)
		XftFontClose(xw.dpy, frc[--frclen].font);

	xunloadfont(&dc.font);
	xunloadfont(&dc.bfont);
	xunloadfont(&dc.ifont);
	xunloadfont(&dc.ibfont);
}

int
ximopen(Display *dpy)
{
	XIMCallback imdestroy = { .client_data = NULL, .callback = ximdestroy };
	XICCallback icdestroy = { .client_data = NULL, .callback = xicdestroy };

	xw.ime.xim = XOpenIM(xw.dpy, NULL, NULL, NULL);
	if (xw.ime.xim == NULL)
		return 0;

	if (XSetIMValues(xw.ime.xim, XNDestroyCallback, &imdestroy, NULL))
		fprintf(stderr, "XSetIMValues: "
		                "Could not set XNDestroyCallback.\n");

	xw.ime.spotlist = XVaCreateNestedList(0, XNSpotLocation, &xw.ime.spot,
	                                      NULL);

	if (xw.ime.xic == NULL) {
		xw.ime.xic = XCreateIC(xw.ime.xim, XNInputStyle,
		                       XIMPreeditNothing | XIMStatusNothing,
		                       XNClientWindow, xw.win,
		                       XNDestroyCallback, &icdestroy,
		                       NULL);
	}
	if (xw.ime.xic == NULL)
		fprintf(stderr, "XCreateIC: Could not create input context.\n");

	return 1;
}

void
ximinstantiate(Display *dpy, XPointer client, XPointer call)
{
	if (ximopen(dpy))
		XUnregisterIMInstantiateCallback(xw.dpy, NULL, NULL, NULL,
		                                 ximinstantiate, NULL);
}

void
ximdestroy(XIM xim, XPointer client, XPointer call)
{
	xw.ime.xim = NULL;
	XRegisterIMInstantiateCallback(xw.dpy, NULL, NULL, NULL,
	                               ximinstantiate, NULL);
	XFree(xw.ime.spotlist);
}

int
xicdestroy(XIC xim, XPointer client, XPointer call)
{
	xw.ime.xic = NULL;
	return 1;
}

void
xinit(TMint trm, int cols, int rows)
{
	XGCValues gcvalues;
	Cursor cursor;
	Window parent;
	pid_t thispid = getpid();
	XColor xmousefg, xmousebg;
	int pi;

	if (!(xw.dpy = XOpenDisplay(NULL)))
		die("can't open display\n");
	xw.scr = XDefaultScreen(xw.dpy);
	xw.vis = XDefaultVisual(xw.dpy, xw.scr);

	/* font */
	if (!FcInit())
		die("could not init fontconfig.\n");

	usedfont = (opt_font == NULL)? font : opt_font;
	xloadfonts(trm, usedfont, 0);

	/* colors */
	xw.cmap = XDefaultColormap(xw.dpy, xw.scr);
	for (pi = 0; pi < PALETTESIZ; pi++)
		xloadcolor(fld(term(trm,palt), pi), dc.col+pi);

	/* adjust fixed window geometry */
	win.w = 2 * borderpx + cols * term(trm,cw);
	win.h = 2 * borderpx + rows * term(trm,ch);
	if (xw.gm & XNegative)
		xw.l += DisplayWidth(xw.dpy, xw.scr) - win.w - 2;
	if (xw.gm & YNegative)
		xw.t += DisplayHeight(xw.dpy, xw.scr) - win.h - 2;

	/* Events */
	xw.attrs.background_pixel = dc.col[DEFAULTBG].pixel;
	xw.attrs.border_pixel = dc.col[DEFAULTBG].pixel;
	xw.attrs.bit_gravity = NorthWestGravity;
	xw.attrs.event_mask = FocusChangeMask | KeyPressMask | KeyReleaseMask
		| ExposureMask | VisibilityChangeMask | StructureNotifyMask
		| ButtonMotionMask | ButtonPressMask | ButtonReleaseMask;
	xw.attrs.colormap = xw.cmap;

	if (!(opt_embed && (parent = strtol(opt_embed, NULL, 0))))
		parent = XRootWindow(xw.dpy, xw.scr);
	xw.win = XCreateWindow(xw.dpy, parent, xw.l, xw.t,
			win.w, win.h, 0, XDefaultDepth(xw.dpy, xw.scr), InputOutput,
			xw.vis, CWBackPixel | CWBorderPixel | CWBitGravity
			| CWEventMask | CWColormap, &xw.attrs);

	memset(&gcvalues, 0, sizeof(gcvalues));
	gcvalues.graphics_exposures = False;
	dc.gc = XCreateGC(xw.dpy, parent, GCGraphicsExposures,
			&gcvalues);
	xw.buf = XCreatePixmap(xw.dpy, xw.win, win.w, win.h,
			DefaultDepth(xw.dpy, xw.scr));
	XSetForeground(xw.dpy, dc.gc, dc.col[DEFAULTBG].pixel);
	XFillRectangle(xw.dpy, xw.buf, dc.gc, 0, 0, win.w, win.h);

	/* font spec buffer */
	xw.specbuf = xmalloc(cols * sizeof(GlyphFontSpec));

	/* Xft rendering context */
	xw.draw = XftDrawCreate(xw.dpy, xw.buf, xw.vis, xw.cmap);

	/* input methods */
	if (!ximopen(xw.dpy)) {
		XRegisterIMInstantiateCallback(xw.dpy, NULL, NULL, NULL,
	                                       ximinstantiate, NULL);
	}

	/* white cursor, black outline */
	cursor = XCreateFontCursor(xw.dpy, mouseshape);
	XDefineCursor(xw.dpy, xw.win, cursor);

	expandrgb(defaultpalette(mousefg), &xmousefg);
	expandrgb(defaultpalette(mousebg), &xmousebg);

	XRecolorCursor(xw.dpy, cursor, &xmousefg, &xmousebg);

	xw.xembed = XInternAtom(xw.dpy, "_XEMBED", False);
	xw.wmdeletewin = XInternAtom(xw.dpy, "WM_DELETE_WINDOW", False);
	xw.netwmname = XInternAtom(xw.dpy, "_NET_WM_NAME", False);
	xw.netwmiconname = XInternAtom(xw.dpy, "_NET_WM_ICON_NAME", False);
	XSetWMProtocols(xw.dpy, xw.win, &xw.wmdeletewin, 1);

	xw.netwmpid = XInternAtom(xw.dpy, "_NET_WM_PID", False);
	XChangeProperty(xw.dpy, xw.win, xw.netwmpid, XA_CARDINAL, 32,
			PropModeReplace, (uchar *)&thispid, 1);

	term(trm,mode) |= MODE_NUMLOCK;
	Xsettitle(0, 0);
	xhints(trm);
	XMapWindow(xw.dpy, xw.win);
	XSync(xw.dpy, False);

	xsel.primary = NULL;
	xsel.clipboard = NULL;
	xsel.xtarget = XInternAtom(xw.dpy, "UTF8_STRING", 0);
	if (xsel.xtarget == None)
		xsel.xtarget = XA_STRING;
}

int
xmakeglyphfontspecs(
	TMint trm, XftGlyphFontSpec *specs, const TMint *g, int len,
	int x, int y)
{
	float winx = borderpx + x * term(trm,cw);
	float winy = borderpx + y * term(trm,ch), xp, yp;
	ushort mode, prevmode = USHRT_MAX;
	Font *font = &dc.font;
	int frcflags = FRC_NORMAL;
	float runewidth = term(trm,cw);
	Rune rune;
	FT_UInt glyphidx;
	FcResult fcres;
	FcPattern *fcpattern, *fontpattern;
	FcFontSet *fcsets[] = { NULL };
	FcCharSet *fccharset;
	int i, f, numspecs = 0;

	for (i = 0, xp = winx, yp = winy + font->ascent; i < len;
	     ++i, g+=GLYPH_ELCNT) {
		/* Fetch rune and mode for current glyph. */
		rune = g[GLYPH_RUNE];
		mode = g[GLYPH_MODE];

		/* Skip dummy wide-character spacing. */
		if (mode == ATTR_WDUMMY)
			continue;

		/* Determine font for glyph if different from previous glyph. */
		if (prevmode != mode) {
			prevmode = mode;
			font = &dc.font;
			frcflags = FRC_NORMAL;
			runewidth = term(trm,cw) * ((mode & ATTR_WIDE) ? 2.0f : 1.0f);
			if ((mode & ATTR_ITALIC) && (mode & ATTR_BOLD)) {
				font = &dc.ibfont;
				frcflags = FRC_ITALICBOLD;
			} else if (mode & ATTR_ITALIC) {
				font = &dc.ifont;
				frcflags = FRC_ITALIC;
			} else if (mode & ATTR_BOLD) {
				font = &dc.bfont;
				frcflags = FRC_BOLD;
			}
			yp = winy + font->ascent;
		}

		/* Lookup character index with default font. */
		glyphidx = XftCharIndex(xw.dpy, font->match, rune);
		if (glyphidx) {
			specs[numspecs].font = font->match;
			specs[numspecs].glyph = glyphidx;
			specs[numspecs].x = (short)xp;
			specs[numspecs].y = (short)yp;
			xp += runewidth;
			numspecs++;
			continue;
		}

		/* Fallback on font cache, search the font cache for match. */
		for (f = 0; f < frclen; f++) {
			glyphidx = XftCharIndex(xw.dpy, frc[f].font, rune);
			/* Everything correct. */
			if (glyphidx && frc[f].flags == frcflags)
				break;
			/* We got a default font for a not found glyph. */
			if (!glyphidx && frc[f].flags == frcflags
					&& frc[f].unicodep == rune) {
				break;
			}
		}

		/* Nothing was found. Use fontconfig to find matching font. */
		if (f >= frclen) {
			if (!font->set)
				font->set = FcFontSort(0, font->pattern,
				                       1, 0, &fcres);
			fcsets[0] = font->set;

			/*
			 * Nothing was found in the cache. Now use
			 * some dozen of Fontconfig calls to get the
			 * font for one single character.
			 *
			 * Xft and fontconfig are design failures.
			 */
			fcpattern = FcPatternDuplicate(font->pattern);
			fccharset = FcCharSetCreate();

			FcCharSetAddChar(fccharset, rune);
			FcPatternAddCharSet(fcpattern, FC_CHARSET,
					fccharset);
			FcPatternAddBool(fcpattern, FC_SCALABLE, 1);

			FcConfigSubstitute(0, fcpattern,
					FcMatchPattern);
			FcDefaultSubstitute(fcpattern);

			fontpattern = FcFontSetMatch(0, fcsets, 1,
					fcpattern, &fcres);

			/* Allocate memory for the new cache entry. */
			if (frclen >= frccap) {
				frccap += 16;
				frc = xrealloc(frc, frccap * sizeof(Fontcache));
			}

			frc[frclen].font = XftFontOpenPattern(xw.dpy,
					fontpattern);
			if (!frc[frclen].font)
				die("XftFontOpenPattern failed seeking fallback font: %s\n",
					strerror(errno));
			frc[frclen].flags = frcflags;
			frc[frclen].unicodep = rune;

			glyphidx = XftCharIndex(xw.dpy, frc[frclen].font, rune);

			f = frclen;
			frclen++;

			FcPatternDestroy(fcpattern);
			FcCharSetDestroy(fccharset);
		}

		specs[numspecs].font = frc[f].font;
		specs[numspecs].glyph = glyphidx;
		specs[numspecs].x = (short)xp;
		specs[numspecs].y = (short)yp;
		xp += runewidth;
		numspecs++;
	}

	return numspecs;
}

void
xdrawglyphfontspecs(
	TMint trm, const XftGlyphFontSpec *specs, const TMint *base_,
	int len, int x, int y)
{
	int charlen = len * ((base_[GLYPH_MODE] & ATTR_WIDE) ? 2 : 1);
	int winx = borderpx + x * term(trm,cw), winy = borderpx + y * term(trm,ch),
	    width = charlen * term(trm,cw);
	XftColor *fg, *bg, *temp, revfg, revbg, truefg, truebg;
	XRenderColor colfg, colbg;
	XRectangle r;
	TMint base[GLYPH_ELCNT];

	memcpy(base, base_, sizeof(base));

	/* Fallback on color display for attributes not supported by the font */
	if (base[GLYPH_MODE] & ATTR_ITALIC && base[GLYPH_MODE] & ATTR_BOLD) {
		if (dc.ibfont.badslant || dc.ibfont.badweight)
			base[GLYPH_FG] = defaultattr;
	} else if ((base[GLYPH_MODE] & ATTR_ITALIC && dc.ifont.badslant) ||
	    (base[GLYPH_MODE] & ATTR_BOLD && dc.bfont.badweight)) {
		base[GLYPH_FG] = defaultattr;
	}

	if (IS_TRUECOL(base[GLYPH_FG])) {
		colfg.alpha = 0xffff;
		colfg.red = TRUERED(base[GLYPH_FG]);
		colfg.green = TRUEGREEN(base[GLYPH_FG]);
		colfg.blue = TRUEBLUE(base[GLYPH_FG]);
		XftColorAllocValue(xw.dpy, xw.vis, xw.cmap, &colfg, &truefg);
		fg = &truefg;
	} else {
		fg = &dc.col[base[GLYPH_FG]];
	}

	if (IS_TRUECOL(base[GLYPH_BG])) {
		colbg.alpha = 0xffff;
		colbg.green = TRUEGREEN(base[GLYPH_BG]);
		colbg.red = TRUERED(base[GLYPH_BG]);
		colbg.blue = TRUEBLUE(base[GLYPH_BG]);
		XftColorAllocValue(xw.dpy, xw.vis, xw.cmap, &colbg, &truebg);
		bg = &truebg;
	} else {
		bg = &dc.col[base[GLYPH_BG]];
	}

	/* Change basic system colors [0-7] to bright system colors [8-15] */
	if ((base[GLYPH_MODE] & ATTR_BOLD_FAINT) == ATTR_BOLD && BETWEEN(base[GLYPH_FG], 0, 7))
		fg = &dc.col[base[GLYPH_FG] + 8];

	if (IS_SET(trm, MODE_REVERSE)) {
		if (fg == &dc.col[DEFAULTFG]) {
			fg = &dc.col[DEFAULTBG];
		} else {
			colfg.red = ~fg->color.red;
			colfg.green = ~fg->color.green;
			colfg.blue = ~fg->color.blue;
			colfg.alpha = fg->color.alpha;
			XftColorAllocValue(xw.dpy, xw.vis, xw.cmap, &colfg,
					&revfg);
			fg = &revfg;
		}

		if (bg == &dc.col[DEFAULTBG]) {
			bg = &dc.col[DEFAULTFG];
		} else {
			colbg.red = ~bg->color.red;
			colbg.green = ~bg->color.green;
			colbg.blue = ~bg->color.blue;
			colbg.alpha = bg->color.alpha;
			XftColorAllocValue(xw.dpy, xw.vis, xw.cmap, &colbg,
					&revbg);
			bg = &revbg;
		}
	}

	if ((base[GLYPH_MODE] & ATTR_BOLD_FAINT) == ATTR_FAINT) {
		colfg.red = fg->color.red / 2;
		colfg.green = fg->color.green / 2;
		colfg.blue = fg->color.blue / 2;
		colfg.alpha = fg->color.alpha;
		XftColorAllocValue(xw.dpy, xw.vis, xw.cmap, &colfg, &revfg);
		fg = &revfg;
	}

	if (base[GLYPH_MODE] & ATTR_REVERSE) {
		temp = fg;
		fg = bg;
		bg = temp;
	}

	if (base[GLYPH_MODE] & ATTR_BLINK && IS_SET(trm, MODE_BLINK))
		fg = bg;

	if (base[GLYPH_MODE] & ATTR_INVISIBLE)
		fg = bg;

	/* Intelligent cleaning up of the borders. */
	if (x == 0) {
		xclear(trm, 0, (y == 0)? 0 : winy, borderpx,
			winy + term(trm,ch) +
			((winy + term(trm,ch) >= borderpx + win.th)? win.h : 0));
	}
	if (winx + width >= borderpx + win.tw) {
		xclear(trm, winx + width, (y == 0)? 0 : winy, win.w,
			((winy + term(trm,ch) >= borderpx + win.th)? win.h : (winy + term(trm,ch))));
	}
	if (y == 0)
		xclear(trm, winx, 0, winx + width, borderpx);
	if (winy + term(trm,ch) >= borderpx + win.th)
		xclear(trm, winx, winy + term(trm,ch), winx + width, win.h);

	/* Clean up the region we want to draw to. */
	XftDrawRect(xw.draw, bg, winx, winy, width, term(trm,ch));

	/* Set the clip region because Xft is sometimes dirty. */
	r.x = 0;
	r.y = 0;
	r.height = term(trm,ch);
	r.width = width;
	XftDrawSetClipRectangles(xw.draw, winx, winy, &r, 1);

	/* Render the glyphs. */
	XftDrawGlyphFontSpec(xw.draw, fg, specs, len);

	/* Render underline and strikethrough. */
	if (base[GLYPH_MODE] & ATTR_UNDERLINE) {
		XftDrawRect(xw.draw, fg, winx, winy + dc.font.ascent * chscale + 1,
				width, 1);
	}

	if (base[GLYPH_MODE] & ATTR_STRUCK) {
		XftDrawRect(xw.draw, fg, winx, winy + 2 * dc.font.ascent * chscale / 3,
				width, 1);
	}

	/* Reset clip to none. */
	XftDrawSetClip(xw.draw, 0);
}

void
Xdrawrect(TMint clor, TMint x0, TMint y0, TMint w, TMint h)
{
	XftDrawRect(xw.draw, dc.col + clor, x0+borderpx, y0+borderpx, w, h);
}

void
Xdrawglyph(TMint trm, TMint g_, int x, int y)
{
	int numspecs;
	XftGlyphFontSpec spec;
	TMint g[GLYPH_ELCNT];

	memcpy(g, &fld(term(trm,scr), g_), sizeof(g));

	numspecs = xmakeglyphfontspecs(trm, &spec, g, 1, x, y);
	xdrawglyphfontspecs(trm, &spec, g, numspecs, x, y);
}

void
xsetenv(void)
{
	char buf[sizeof(long) * 8 + 1];

	snprintf(buf, sizeof(buf), "%lu", xw.win);
	setenv("WINDOWID", buf, 1);
}

void
Xicontitl(TMint deq, TMint off)
{
	XTextProperty prop;
	char *p = deq ? deqtostring(deq, off) : opt_title;

	if (Xutf8TextListToTextProperty(xw.dpy, &p, 1, XUTF8StringStyle,
	                                &prop) != Success)
		return;
	XSetWMIconName(xw.dpy, xw.win, &prop);
	XSetTextProperty(xw.dpy, xw.win, &prop, xw.netwmiconname);
	XFree(prop.value);
}

void
Xsettitle(TMint deq, TMint off)
{
	XTextProperty prop;
	char *p = deq ? deqtostring(deq, off) : opt_title;

	if (Xutf8TextListToTextProperty(xw.dpy, &p, 1, XUTF8StringStyle,
	                                &prop) != Success)
		return;
	XSetWMName(xw.dpy, xw.win, &prop);
	XSetTextProperty(xw.dpy, xw.win, &prop, xw.netwmname);
	XFree(prop.value);
}

void
Xdrawline(TMint trm, int x1, int y1, int x2)
{
	int i, x, ox, numspecs;
	TMint base[GLYPH_ELCNT], new[GLYPH_ELCNT], scr = term(trm,scr);
	XftGlyphFontSpec *specs = xw.specbuf;
	TMint *cel = &fld(scr, term_cellf(trm, y1, x1));

	numspecs = xmakeglyphfontspecs(trm, specs, cel, x2 - x1, x1, y1);
	i = ox = 0;
	for (x = x1; x < x2 && i < numspecs; x++, cel += GLYPH_ELCNT) {
		memcpy(new, cel, GLYPH_ELCNT << 2);
		if (new[GLYPH_MODE] == ATTR_WDUMMY)
			continue;
		if (selected(trm, x, y1))
			new[GLYPH_MODE] ^= ATTR_REVERSE;
		if (i > 0 && ATTRCMP(base, new)) {
			xdrawglyphfontspecs(trm, specs, base, i, ox, y1);
			specs += i;
			numspecs -= i;
			i = 0;
		}
		if (i == 0) {
			ox = x;
			memcpy(base, new, sizeof(base));
		}
		i++;
	}
	if (i > 0)
		xdrawglyphfontspecs(trm, specs, base, i, ox, y1);
}

void
Xfinishdraw(TMint trm)
{
	XCopyArea(xw.dpy, xw.buf, xw.win, dc.gc, 0, 0, win.w,
			win.h, 0, 0);
	XSetForeground(
		xw.dpy, dc.gc,
		dc	.col[	IS_SET(trm, MODE_REVERSE)
				? DEFAULTFG
				: DEFAULTBG
			].pixel);
}

void
Xximspot(TMint trm, int x, int y)
{
	if (xw.ime.xic == NULL)
		return;

	xw.ime.spot.x = borderpx + x		* term(trm,cw);
	xw.ime.spot.y = borderpx + (y + 1)	* term(trm,ch);

	XSetICValues(xw.ime.xic, XNPreeditAttributes, xw.ime.spotlist, NULL);
}

void
expose(TMint trm, XEvent *ev)
{
	redraw(trm);
}

void
visibility(TMint trm, XEvent *ev)
{
	XVisibilityEvent *e = &ev->xvisibility;

	MODBIT(term(trm,mode), e->state == VisibilityFullyObscured,
	       MODE_INVISIBLE);
}

void
unmap(TMint trm, XEvent *ev)
{
	term(trm,mode) |= MODE_INVISIBLE;
}

void
Xsetpointermotion(int set)
{
	MODBIT(xw.attrs.event_mask, set, PointerMotionMask);
	XChangeWindowAttributes(xw.dpy, xw.win, CWEventMask, &xw.attrs);
}

void
xseturgency(int add)
{
	XWMHints *h = XGetWMHints(xw.dpy, xw.win);

	MODBIT(h->flags, add, XUrgencyHint);
	XSetWMHints(xw.dpy, xw.win, h);
	XFree(h);
}

void
Xbell(TMint trm)
{
	if (!(IS_SET(trm, MODE_FOCUSED)))
		xseturgency(1);
	if (bellvolume)
		XkbBell(xw.dpy, xw.win, bellvolume, (Atom)NULL);
}

void
focus(TMint trm, XEvent *ev)
{
	XFocusChangeEvent *e = &ev->xfocus;
	static TMint focusi, focuso;

	if (!focusi) focusi = deqsetutf8(0, "\033[I", -1);
	if (!focuso) focuso = deqsetutf8(0, "\033[O", -1);

	if (e->mode == NotifyGrab)
		return;

	if (ev->type == FocusIn) {
		if (xw.ime.xic)
			XSetICFocus(xw.ime.xic);
		term(trm,mode) |= MODE_FOCUSED;
		xseturgency(0);
		if (IS_SET(trm, MODE_FOCUS))
			ttywrite(trm, focusi, -1, 0);
	} else {
		if (xw.ime.xic)
			XUnsetICFocus(xw.ime.xic);
		term(trm,mode) &= ~MODE_FOCUSED;
		if (IS_SET(trm, MODE_FOCUS))
			ttywrite(trm, focuso, -1, 0);
	}
}

int
match(uint mask, uint state)
{
	return mask == XK_ANY_MOD || mask == (state & ~ignoremod);
}

char*
kmap(TMint trm, KeySym k, uint state)
{
	Key *kp;
	int i;

	/* Check for mapped keys out of X11 function keys. */
	for (i = 0; i < LEN(mappedkeys); i++) {
		if (mappedkeys[i] == k)
			break;
	}
	if (i == LEN(mappedkeys)) {
		if ((k & 0xFFFF) < 0xFD00)
			return NULL;
	}

	for (kp = key; kp < key + LEN(key); kp++) {
		if (kp->k != k)
			continue;

		if (!match(kp->mask, state))
			continue;

		if (IS_SET(trm, MODE_APPKEYPAD) ? kp->appkey < 0 : kp->appkey > 0)
			continue;
		if (IS_SET(trm, MODE_NUMLOCK) && kp->appkey == 2)
			continue;

		if (IS_SET(trm, MODE_APPCURSOR) ? kp->appcursor < 0 : kp->appcursor > 0)
			continue;

		return kp->s;
	}

	return NULL;
}

int
utf8encode(Rune u, char *c)
{
	TMint s = deqmk(), len;
	s = deqpushcop(s, u);
	len = deqbytsiz(s);
	memcpy(c, deqtostring(s, 0), len);
	tmfree(s);

	return len;
}

void
kpress(TMint trm, XEvent *ev)
{
	XKeyEvent *e = &ev->xkey;
	KeySym ksym = NoSymbol;
	char buf[64], *customkey;
	int len;
	Rune c;
	Status status;
	Shortcut *bp;
	static TMint keydq;

	if (IS_SET(trm, MODE_KBDLOCK))
		return;

	if (xw.ime.xic) {
		len = XmbLookupString(xw.ime.xic, e, buf, sizeof buf, &ksym, &status);
		if (status == XBufferOverflow)
			return;
	} else {
		len = XLookupString(e, buf, sizeof buf, &ksym, NULL);
	}
	/* 1. shortcuts */
	for (bp = shortcuts; bp < shortcuts + LEN(shortcuts); bp++) {
		if (ksym == bp->keysym && match(bp->mod, e->state)) {
			bp->func(trm, &(bp->arg));
			return;
		}
	}

	/* 2. custom keys from config.h */
	if ((customkey = kmap(trm, ksym, e->state))) {
		keydq = deqsetutf8(keydq, customkey, -1);
		ttywrite(trm, keydq, -1, 1);
		return;
	}

	/* 3. composed string from input method */
	if (len == 0)
		return;
	if (len == 1 && e->state & Mod1Mask) {
		if (IS_SET(trm, MODE_8BIT)) {
			if (*buf < 0177) {
				c = *buf | 0x80;
				len = utf8encode(c, buf);
			}
		} else {
			buf[1] = buf[0];
			buf[0] = '\033';
			len = 2;
		}
	}
	keydq = deqsetutf8(keydq, buf, len);
	ttywrite(trm, keydq, -1, 1);
}

void
cmessage(TMint trm, XEvent *e)
{
	/*
	 * See xembed specs
	 *  http://standards.freedesktop.org/xembed-spec/xembed-spec-latest.html
	 */
	if (e->xclient.message_type == xw.xembed && e->xclient.format == 32) {
		if (e->xclient.data.l[1] == XEMBED_FOCUS_IN) {
			term(trm,mode) |= MODE_FOCUSED;
			xseturgency(0);
		} else if (e->xclient.data.l[1] == XEMBED_FOCUS_OUT) {
			term(trm,mode) &= ~MODE_FOCUSED;
		}
	} else if (e->xclient.data.l[0] == xw.wmdeletewin) {
		ttyhangup();
		exit(0);
	}
}

void
resize(TMint trm, XEvent *e)
{
	if (e->xconfigure.width == win.w && e->xconfigure.height == win.h)
		return;

	cresize(trm, e->xconfigure.width, e->xconfigure.height);
}

void Now(int ms)
{
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	fld(ms,1)	= ts.tv_nsec / 1000000
			+ (ts.tv_sec * 1000	) & 0x7fffffff;

	fld(ms,0)	= (ts.tv_sec & 0xffff	) * 1000 >> 31
			+ (ts.tv_sec >> 16	) * 1000 >> 15;
}

fn2(tattrset, trm, attr)
{
	TMint i, j;

	for (i = 0; i < term(trm,row)-1; i++) {
		for (j = 0; j < term(trm,col)-1; j++) {
			if (term_glyph(trm, i, j, GLYPH_MODE, -1) & attr)
				return 1;
		}
	}

	return 0;
}

fn2(tsetdirtattr, trm, attr)
{
	TMint i, j;

	for (i = 0; i < term(trm,row)-1; i++) {
		for (j = 0; j < term(trm,col)-1; j++) {
			if (term_glyph(trm, i, j, GLYPH_MODE, -1) & attr) {
				tsetdirt(trm, i, i);
				break;
			}
		}
	}
}

void _Noreturn
run(TMint trm)
{
	XEvent ev;
	int w = win.w, h = win.h;
	fd_set rfd;
	int xfd = XConnectionNumber(xw.dpy), ttyfd, xev, drawing;
	double timeout;
	int	now		= tmalloc(2),
		lastblink	= tmalloc(2),
		trigger		= tmalloc(2);
	struct timespec tv;

	/* Waiting for window mapping */
	do {
		XNextEvent(xw.dpy, &ev);
		/*
		 * This XFilterEvent call is required because of XOpenIM. It
		 * does filter out the key event and some client message for
		 * the input method too.
		 */
		if (XFilterEvent(&ev, None))
			continue;
		if (ev.type == ConfigureNotify) {
			w = ev.xconfigure.width;
			h = ev.xconfigure.height;
		}
	} while (ev.type != MapNotify);

	if (opt_io) term(trm,mode) |= MODE_PRINT;
	ttyfd = ttynew(termname, opt_line, shell, opt_io, opt_cmd);
	cresize(trm, w, h);

	for (timeout = -1, drawing = 0;;) {
		FD_ZERO(&rfd);
		FD_SET(ttyfd, &rfd);
		FD_SET(xfd, &rfd);

		if (XPending(xw.dpy))
			timeout = 0;  /* existing events might not set xfd */

		tv.tv_sec = timeout / 1000;
		tv.tv_nsec = fmod(timeout, 1000) * 1e6;

		if (0>pselect(	MAX(xfd, ttyfd)+1, &rfd, NULL, NULL,
				timeout >= 0 ? &tv : 0, NULL)) {
			if (errno == EINTR)
				continue;
			die("select failed: %s\n", strerror(errno));
		}
		Now(now);

		if (FD_ISSET(ttyfd, &rfd))
			ttyread(trm);

		xev = 0;
		while (XPending(xw.dpy)) {
			xev = 1;
			XNextEvent(xw.dpy, &ev);
			if (XFilterEvent(&ev, None))
				continue;
			if (handler[ev.type])
				(handler[ev.type])(trm, &ev);
		}

		/*
		 * To reduce flicker and tearing, when new content or event
		 * triggers drawing, we first wait a bit to ensure we got
		 * everything, and if nothing new arrives - we draw.
		 * We start with trying to wait minlatency ms. If more content
		 * arrives sooner, we retry with shorter and shorter periods,
		 * and eventually draw even without idle after maxlatency ms.
		 * Typically this results in low latency while interacting,
		 * maximum latency intervals during `cat huge.txt`, and perfect
		 * sync with periodic updates from animations/key-repeats/etc.
		 */
		if (FD_ISSET(ttyfd, &rfd) || xev) {
			if (!drawing) {
				trigger = now;
				drawing = 1;
			}
			timeout = (maxlatency - timediff(now, trigger)) \
			          / maxlatency * minlatency;
			if (timeout > 0)
				continue;  /* we have time, try to find idle */
		}

		/* idle detected or maxlatency exhausted -> draw */
		timeout = -1;
		if (blinktimeout && tattrset(trm, ATTR_BLINK)) {
			timeout = blinktimeout - timediff(now, lastblink);
			if (timeout <= 0) {
				if (-timeout > blinktimeout) /* start visible */
					term(trm,mode) |= MODE_BLINK;
				term(trm,mode) ^= MODE_BLINK;
				tsetdirtattr(trm, ATTR_BLINK);
				fld(lastblink,0) = fld(now,0);
				fld(lastblink,1) = fld(now,1);
				timeout = blinktimeout;
			}
		}

		draw(trm);
		XFlush(xw.dpy);
		drawing = 0;
	}
}

void
usage(void)
{
	die("usage: %s [-aiv] [-c class] [-f font] [-g geometry]"
	    " [-n name] [-o file]\n"
	    "          [-T title] [-t title] [-w windowid]"
	    " [[-e] command [args ...]]\n"
	    "       %s [-aiv] [-c class] [-f font] [-g geometry]"
	    " [-n name] [-o file]\n"
	    "          [-T title] [-t title] [-w windowid] -l line"
	    " [stty_args ...]\n", argv0, argv0);
}

void
sendbreak(TMint, const Arg *arg)
{
	if (tcsendbreak(cmdfd, 0))
		perror("Error sending break");
}

void
toggleprinter(TMint trm, const Arg *arg)
{
	term(trm,mode) ^= MODE_PRINT;
}

size_t
ttyread(TMint trm)
{
	static TMint buf;
	static int buflen;
	int ret, written;

	if (!buf) {
		buf = deqmk();
		for (buflen = BUFSIZ; buflen; buflen--)
			buf = deqpushbyt(buf, 0);
	}

	/* append read bytes to unprocessed bytes */
	ret = read(cmdfd, deqtostring(buf, buflen), BUFSIZ-buflen);

	switch (ret) {
	case 0:
		exit(0);
	case -1:
		perror("read from shell");
		exit(1);
	default:
		buflen += ret;
		written = twrite(trm, buf, buflen, 0);
		buflen -= written;
		/* keep any incomplete UTF-8 byte sequence for the next call */
		if (buflen > 0)
			memmove(deqtostring(buf, 0),
				deqtostring(buf, written),
				buflen);
		return ret;
	}
}

void
Ttywriteraw(TMint trm, TMint dq, TMint of, TMint sz)
{
	fd_set wfd, rfd;
	ssize_t r;
	size_t lim = 256;
	const char *s = deqtostring(dq, of);

	/*
	 * Remember that we are using a pty, which might be a modem line.
	 * Writing too much will clog the line. That's why we are doing this
	 * dance.
	 * FIXME: Migrate the world to Plan 9.
	 */
	while (sz > 0) {
		FD_ZERO(&wfd);
		FD_ZERO(&rfd);
		FD_SET(cmdfd, &wfd);
		FD_SET(cmdfd, &rfd);

		/* Check if we can write. */
		if (pselect(cmdfd+1, &rfd, &wfd, NULL, NULL, NULL) < 0) {
			if (errno == EINTR)
				continue;
			perror("see if we can write (select)");
			exit(1);
		}
		if (FD_ISSET(cmdfd, &wfd)) {
			/*
			 * Only write the bytes written by ttywrite() or the
			 * default of 256. This seems to be a reasonable value
			 * for a serial line. Bigger values might clog the I/O.
			 */
			if ((r = write(cmdfd, s, (sz < lim)? sz : lim)) < 0)
				goto write_error;
			if (r < sz) {
				/*
				 * We weren't able to write out everything.
				 * This means the buffer is getting full
				 * again. Empty it.
				 */
				if (sz < lim)
					lim = ttyread(trm);
				sz -= r;
				s += r;
			} else {
				/* All bytes have been written. */
				break;
			}
		}
		if (FD_ISSET(cmdfd, &rfd))
			lim = ttyread(trm);
	}
	return;

write_error:
	perror("write on tty");
	exit(1);
}

void
ttyresize(TMint trm, int tw, int th)
{
	struct winsize w;

	w.ws_row = term(trm,row);
	w.ws_col = term(trm,col);
	w.ws_xpixel = tw;
	w.ws_ypixel = th;
	if (ioctl(cmdfd, TIOCSWINSZ, &w) < 0) {
		perror("set window size");
		exit(1);
	}
}
void
printscreen(TMint trm, const Arg *arg)
{
	tdump(trm);
}

void
printsel(TMint trm, const Arg *arg)
{
	tdumpsel(trm);
}

static ssize_t
xwrite(int fd, const char *s, size_t len)
{
	size_t aux = len;
	ssize_t r;

	while (len > 0) {
		r = write(fd, s, len);
		if (r < 0)
			return r;
		len -= r;
		s += r;
	}

	return aux;
}

void Xprint(TMint deq) { xwrite(iofd, deqtostring(deq, 0), deqbytsiz(deq)); }

int
main(int argc, char *argv[])
{
	TMint trm = term_new();

	xw.l = xw.t = 0;
	xw.isfixed = False;

	ARGBEGIN {
	case 'a':
		term(trm,allowaltscr) = 0;
		break;
	case 'c':
		opt_class = EARGF(usage());
		break;
	case 'e':
		if (argc > 0)
			--argc, ++argv;
		goto run;
	case 'f':
		opt_font = EARGF(usage());
		break;
	case 'g':
		xw.gm = XParseGeometry(EARGF(usage()),
				&xw.l, &xw.t, &cols, &rows);
		break;
	case 'i':
		xw.isfixed = 1;
		break;
	case 'o':
		opt_io = EARGF(usage());
		break;
	case 'l':
		opt_line = EARGF(usage());
		break;
	case 'n':
		opt_name = EARGF(usage());
		break;
	case 't':
	case 'T':
		opt_title = EARGF(usage());
		break;
	case 'w':
		opt_embed = EARGF(usage());
		break;
	case 'v':
		die("%s " VERSION "\n", argv0);
		break;
	default:
		usage();
	} ARGEND;

run:
	if (argc > 0) /* eat all remaining arguments */
		opt_cmd = argv;

	if (!opt_title)
		opt_title = (opt_line || !opt_cmd) ? "st" : opt_cmd[0];

	setlocale(LC_CTYPE, "");
	XSetLocaleModifiers("");
	cols = MAX(cols, 1);
	rows = MAX(rows, 1);
	tnew(trm, cols, rows);
	xinit(trm, cols, rows);
	xsetenv();
	run(trm);

	return 0;
}
