all: ext


ext:
	$(MAKE) -C mon/ext

.PHONY: ext