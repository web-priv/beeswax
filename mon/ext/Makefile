all: js

JS_TARGETS = pageapi/runtime.js


CLEANUP = pageapi/runtime.js pageapi/runtime.body.js pageapi/runtime.globals.js pageapi/*.sed

CLOSURE_FLAGS = \
	--compilation_level SIMPLE_OPTIMIZATIONS \
	--language_in ECMASCRIPT5_STRICT \
	--accept_const_keyword \
	--create_source_map $@.map --source_map_format=V3
CPP_FLAGS =

# --compilation_level ADVANCED_OPTIMIZATIONS SIMPLE_OPTIMIZATIONS WHITESPACE_ONLY

ifneq ($(DEBUG),)
	CPP_FLAGS += -D 'ENABLE_TEST=1'
	CLOSURE_FLAGS += --formatting=PRETTY_PRINT
endif

CLOSURE_URL := http://dl.google.com/closure-compiler/compiler-20150126.zip
CLOSURE_BASE := compiler-20150126.zip

JS_MINIFIED = $(JS_TARGETS:.js=.min.js)

js: $(JS_TARGETS) $(JS_MINIFIED)

%.js: %.js.in
	rm -f "$@" && \
	sed -e s@^//#@#@g "$<" > "$@.sed" && \
	$(CPPJS) $(CPP_FLAGS) "$@.sed" "$@" && \
	chmod -w "$@" && rm "$@.sed"

pageapi/runtime.js: pageapi/runtime.js.in pageapi/runtime.body.js pageapi/runtime.globals.js

# echo "//# sourceMappingURL=./$$(basename $@.map)" >> "$@".tmp
%.min.js: %.js $(CLOSURE_JAR)
	$(MAKE) $(CLOSURE_JAR)
	$(CLOSURE) $(CLOSURE_FLAGS) --js=$< >$@.tmp && \
	rm -f "$@" && mv $@.tmp $@ && \
	chmod -w $@

clean:
	rm -f $(JS_MINIFIED) $(JS_MIN_GZIP) $(CLEANUP)

CLOSURE_DIR := closure-compiler
CLOSURE_JAR := closure-compiler/compiler.jar
$(CLOSURE_JAR):
	if [ ! -e "$(CLOSURE_DIR)/$(CLOSURE_BASE)" ]; then \
	rm -f "$(CLOSURE_DIR)/tmp_$(CLOSURE_BASE)" && \
	wget "$(CLOSURE_URL)" -O "$(CLOSURE_DIR)/tmp_$(CLOSURE_BASE)" && \
	unzip -d "$(CLOSURE_DIR)" "$(CLOSURE_DIR)/tmp_$(CLOSURE_BASE)"; \
	fi

CLOSURE = java -jar $(CLOSURE_JAR)
CPPJS = cpp -P -undef -Wundef -std=c99 -nostdinc -Wtrigraphs -fdollars-in-identifiers -CC

.PHONY: all js clean
