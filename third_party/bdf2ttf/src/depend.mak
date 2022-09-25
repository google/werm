# vim:set ts=8 sts=8 sw=8 tw=0:
#
# �\���t�@�C���ƈˑ��֌W
#
# Last Change:	10-Oct-2003.
# Written By:	MURAOKA Taro <koron.kaoriya@gmail.com>

##############################################################################
# �\���t�@�C��
#
SRCS = $(srcdir)bdf.c		\
       $(srcdir)bdf2ttf.cpp	\
       $(srcdir)main.c		\
       $(srcdir)rcfile.c	\
       $(srcdir)table.cpp	\
       $(srcdir)ucsconv.c

OBJS = $(objdir)bdf.$(O)	\
       $(objdir)bdf2ttf.$(O)	\
       $(objdir)main.$(O)	\
       $(objdir)rcfile.$(O)	\
       $(objdir)table.$(O)	\
       $(objdir)ucsconv.$(O)

LIBS =

TARGET = $(outdir)bdf2ttf$(EXE)

HDRS = $(srcdir)bdf.h $(srcdir)rcfile.h $(srcdir)table.h $(srcdir)ucsconv.h

##############################################################################
# �t���O
#
CCFLAGS  = $(CFLAGS) $(DEFS) $(INCDIRS)
CPPFLAGS = $(CFLAGS) $(DEFS) $(INCDIRS)
LDFLAGS  = $(LFLAGS) $(LIBDIRS)

##############################################################################
# �ˑ��֌W�̐ݒ�
#
$(objdir)bdf.$(O): $(srcdir)bdf.c  $(srcdir)bdf.h $(srcdir)ucsconv.h $(srcdir)debug.h

$(objdir)bdf2ttf.$(O): $(srcdir)bdf2ttf.cpp $(srcdir)version.h $(srcdir)table.h $(srcdir)bdf.h $(srcdir)bdf2ttf.h $(srcdir)debug.h

$(objdir)main.$(O): $(srcdir)main.c $(srcdir)rcfile.h $(srcdir)bdf.h $(srcdir)bdf2ttf.h $(srcdir)debug.h

$(objdir)rcfile.$(O): $(srcdir)rcfile.c  $(srcdir)rcfile.h

$(objdir)table.$(O): $(srcdir)table.cpp  $(srcdir)table.h

$(objdir)ucsconv.$(O): $(srcdir)ucsconv.c  $(srcdir)ucsconv.h
