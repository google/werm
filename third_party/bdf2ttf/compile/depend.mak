# vim:set ts=8 sts=8 sw=8 tw=0:
#
# ��{�ˑ��֌W
#
# Last Change:	06-Jun-2003.
# Written By:	MURAOKA Taro <koron.kaoriya@gmail.com>

TAGS = tags

$(TARGET): $(OBJS)

#tags: $(TAGS)

$(TAGS): $(SRCS) $(HDRS)
	$(CTAGS) -f $@ $(SRCS) $(HDRS)

clean-compile:
	-$(RM) $(OBJS)

distclean-compile: clean-compile
	-$(RM) $(TARGET)
	-$(RM) $(TAGS)
