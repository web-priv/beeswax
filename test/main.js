/**
    Beeswax - Anti-Exfiltration Web Platform
    Copyright (C) 2016  Jean-Sebastien Legare

    Beeswax is free software: you can redistribute it and/or modify it
    under the terms of the GNU Lesser General Public License as
    published by the Free Software Foundation, either version 3 of the
    License, or (at your option) any later version.

    Beeswax is distributed in the hope that it will be useful, but
    WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
    Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public
    License along with Beeswax.  If not, see
    <http://www.gnu.org/licenses/>.
**/


"use strict";

/*jshint
  globalstrict: true
*/
/*global require, QUnit*/

require.config({
    paths: {
        'QUnit-orig': "libs/qunit-1.15.0",
        'QUnit': "qunit-fix"
    },
    shim: {
        'QUnit-orig': {
            exports: 'QUnit',
            init: function () {
                //QUnit.config.autoload = false;
                QUnit.config.autostart = false;
                //QUnit.config.autorun = false;
            }
        }
    }
});

require(["QUnit",
         "tests/crypto",
         "tests/events",
         "tests/private"
        ], function (QUnit /*, tests */) {
    // Start the test engine.
    // All tests have to be defined by this point.
    QUnit.load();
    QUnit.start();
});