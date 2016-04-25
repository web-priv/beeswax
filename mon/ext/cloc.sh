#!/bin/bash -x 

# Beeswax - Anti-Exfiltration Web Platform
# Copyright (C) 2016  Jean-Sebastien Legare
#
# Beeswax is free software: you can redistribute it and/or modify it
# under the terms of the GNU Lesser General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# Beeswax is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
# Lesser General Public License for more details.

# You should have received a copy of the GNU Lesser General Public
# License along with Beeswax.  If not, see
# <http://www.gnu.org/licenses/>.

EXCLUDE_LIST=(
#./vault.js
#./config.h
./yahoo-min.js
#./utils.js
#./contentscript.js
#./popup.html
./sjcl.js
./jquery-1.11.3.min.js
./cloc.sh
#./popup.js
#./background.js
./monitor.png
./logo
./logo/logo128.png
./logo/logo16.png
./logo/logo19.png
./logo/logo32.png
./logo/logo38.png
./logo/logo48.png
#./Makefile
#./keyclasses.js
./pageapi/runtime.min.js.map
./pageapi/runtime.body.js
./pageapi/runtime.js
#./pageapi/runtime.js.in
#./pageapi/runtime.body.js.in
./pageapi/runtime.globals.js
#./pageapi/runtime.globals.js.in
./pageapi/runtime.min.js
./jsrsasign.min.js
./closure-compiler
./closure-compiler/compiler.jar
./closure-compiler/.hgplaceholder
./closure-compiler/README.md
./closure-compiler/COPYING
./closure-compiler/tmp_compiler-20150126.zip
#./ui.js
./pageapi/Makefile
./pageapi/out3_flymake.js
./pageapi/out.js
)

cd $(dirname $0)
cloc --force-lang="Javascript",in --exclude-list-file=<(set +x; for x in ${EXCLUDE_LIST[@]}; do echo "$x"; done) --by-file .
cloc --force-lang="Javascript",in --exclude-list-file=<(set +x; for x in ${EXCLUDE_LIST[@]}; do echo "$x"; done) .
