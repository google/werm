# Copyright 2013 Joe Walnes and the websocketd team.
# All rights reserved.
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file.

# Self contained Go build file that will download and install (locally) the correct
# version of Go, and build our programs. Go does not need to be installed on the
# system (and if it already is, it will be ignored).

# To manually invoke the locally installed Go, use ./go

# Go installation config.
WERMGOLANGVER?=1.11.5
WERMGOLANGDIR?=go-$(WERMGOLANGVER)
SYSTEM_NAME:=$(shell uname -s | tr '[:upper:]' '[:lower:]')
SYSTEM_ARCH:=$(shell uname -m)
GO_ARCH:=$(if $(filter x86_64, $(SYSTEM_ARCH)),amd64,386)
GO_VERSION:=$(WERMGOLANGVER).$(SYSTEM_NAME)-$(GO_ARCH)
GO_DOWNLOAD_URL:=https://dl.google.com/go/go$(GO_VERSION).tar.gz

# Build websocketd binary
websocketd: $(WERMGOLANGDIR)/bin/go $(wildcard *.go) $(wildcard ../gorillaws/*.go)
	$(WERMGOLANGDIR)/bin/go build

localgo: $(WERMGOLANGDIR)/bin/go

# Download and unpack Go distribution.
$(WERMGOLANGDIR)/bin/go:
	mkdir -p $(WERMGOLANGDIR)
	rm -f $@
	@echo Downloading and unpacking Go $(GO_VERSION) to $(WERMGOLANGDIR)
	curl -s $(GO_DOWNLOAD_URL) | tar xfz - --strip-components=1 -C $(WERMGOLANGDIR)

# Clean up binary
clean:
	rm -rf websocketd

.PHONY: clean

# Also clean up downloaded Go
clobber: clean
	rm -rf $(wildcard go-v*)

.PHONY: clobber
