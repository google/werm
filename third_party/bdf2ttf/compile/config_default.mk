# vim:set ts=8 sts=8 sw=8 tw=0:
#
# �f�t�H���g�R���t�B�M�����[�V�����t�@�C��
#
# Last Change:	03-Jan-2003.
# Written By:	MURAOKA Taro <koron.kaoriya@gmail.com>

srcdir = ./src/
objdir = ./src/
outdir = ./

##############################################################################
# �C���X�g�[���f�B���N�g���̐ݒ�
#
prefix		= /usr/local
bindir		= $(prefix)/bin
libdir		= $(prefix)/lib
incdir		= $(prefix)/include
# �x��: $(ucstabledir)�̓A���C���X�g�[�����s���Ƀf�B���N�g�����Ə�������܂��B
ucstabledir	= $(prefix)/share/bdf2ttf

##############################################################################
# �R�}���h�ݒ�
#
RM		= rm -f
CP		= cp
MKDIR		= mkdir -p
RMDIR		= rm -rf
CTAGS		= ctags
INSTALL		= /usr/bin/install -c
INSTALL_PROGRAM	= $(INSTALL) -m 755
INSTALL_DATA	= $(INSTALL) -m 644

##############################################################################
# �萔
#
O = o
EXE =
