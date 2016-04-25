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
  define, _M
*/
/*jshint es5:true */

define(["QUnit", "utils"], function (QUnit, U) {
    "use strict";
    
    QUnit.module("Private Area Tests");

    QUnit.precondTest("Textarea as a private element", U.openKeyring, function (assert) {

        var controls = U.getTemplate("test-inputarea");
        var testZone = document.getElementById("private-test-zone");
        var timer = new U.TestTimer(assert, 1000 * 10, 1); // 2min

        // add the textarea to the DOM
        testZone.appendChild(controls);

        function keypress(evt) {

            var checkProps = {
                keyCode: 0,
                charCode: 0,
                target: null
                //currentTarget is changing.
            };

            assert.ok(true, "keyboard event received");
            for (var prop in checkProps) {
                if (checkProps.hasOwnProperty(prop)) {
                    assert.equal(evt[prop], checkProps[prop], "Expected prop " + prop + " to have been erased.");
                }
            }

            textArea.removeEventListener("keypress", keypress, true);
            timer.finish();
        }

        var textArea = controls.getElementsByClassName("private")[0];
        textArea.addEventListener("keypress", keypress, true);

        _M.gen_aes_key(U.UUID4()).then(function (kh) {
            assert.ok(kh !== null, "Got keyhandle back");
            _M.mark_private(textArea, kh);
            assert.ok(textArea.shadowRoot === undefined, "No shadowroot anymore");
            assert.ok(textArea.hasOwnProperty("_micasa_getter_shadowRoot"), "Shadowroot hidden");
            try {
                delete textArea._micasa_getter_shadowRoot;
                assert.ok(false, "deleting the attribute succeeded");
            } catch (err) {
                assert.ok(true, "deleting the mask attribute failed expectedly.");
            }
            assert.ok(textArea.shadowRoot === undefined, "Still no shadowroot after deletion.");

        }).catch(function (err) {
            assert.micasaError(err, "OK", "Creation unexpectedly failed.");
            timer.finish();
        });
    });
});
