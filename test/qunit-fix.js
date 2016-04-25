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


/*global
  define
*/
/*jshint es5:true */

define(['QUnit-orig'], function (QUnit) {
    "use strict";
    QUnit.assert.micasaError = function (value, expected, message) {
        function extractCode(val) {
            // returns a string code or undefined
            if ((typeof val) === "string") {
                return val;
            }
            if (val instanceof String) {
                return "" + val;
            }

            if (val instanceof Object) {
                return ((val.code) === undefined) ? val.code : ("" + val.code);
            }
            return undefined;
        }

        var isError = (value instanceof Error);
        var errorCode = extractCode(value);
        var expectedCode = extractCode(expected);

        if (expectedCode === undefined) {
            expectedCode = ({x: "Not a suitable error value"});
        }
        if (isError && expectedCode !== errorCode) {
            errorCode += " (msg was:" + value.message + ")";
            expectedCode += " (msg was:" + value.message + ")";

            // Help debugging syntax or type errors in the tests themselves
            if (!value.code) {
                console.debug("Probable harness bug in test(", this.test.testName, "):\n", value.stack);
            }
        }
        this.push(isError && (expectedCode === errorCode), errorCode, expectedCode, message);
    };

    QUnit.precondTest = function (name, precond, test) {
        return QUnit.asyncTest(name, function (assert) {
            precond().then(function (precondResult) {
                return test(assert, precondResult);
            }, function (err) {
                console.error("Precondition for test", name, "failed.", err);
                assert.ok(false, "Precondition fail.");
                QUnit.start();
            }).catch(function (err) {
                console.error("Uncaught error in test:", name, "\n", err.stack);
                throw err;
            });
        });
    };

    return QUnit;
});