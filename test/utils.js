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


/*global define, _M
  Promise
*/
/*jshint es5:true */

define(['QUnit'], function (QUnit) {
    "use strict";

    //
    // Parse query parameters
    //
    var exports = {};
    exports.QPARAMS = {};
    (function () {
        var URL = window.location.toString();
        var matches = URL.match(/\?([^#]+)(#.*)?$/);
        if (!matches || matches.length < 2) {
            return;
        }

        var qparams_str = matches[1];
        var qparams_toks = qparams_str.split("&");
        var key, val;
    
        for (var i = 0; i < qparams_toks.length; i++) {
            if (!qparams_toks[i]) {
                continue;
            }
            var tmp = qparams_toks[i].split("=");
            key = tmp[0];
            val = decodeURIComponent(tmp[1]);

            if (!exports.QPARAMS.hasOwnProperty(key)) {
                exports.QPARAMS[key] = [val];
            } else {
                exports.QPARAMS[key].push(val);
            }
        }
    })();

    exports.UUID4 = function UUID4() {
        function s4() {
            return Math.floor((1 + Math.random()) * 0x10000)
                .toString(16)
                .substring(1);
        }
        return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
            s4() + '-' + s4() + s4() + s4();
    };

    exports.gKeyringId = exports.UUID4();
    exports.gKeyringOpen = false;

    exports.openKeyring = function () {
        if (exports.gKeyringOpen) {
            return Promise.resolve();
        }

        return _M.new_keyring(exports.gKeyringId).then(function () {
            exports.gKeyringOpen = true;
        }).catch(function (err) {
            console.error("Failed to open new keyring.", err);
            throw err;
        });
    };

    // Timer that restarts the test engine after ms milliseconds. Call
    // finish() a number of times equal to integer barrier (default=1) to
    // indicate that the operation completed in time.
    //
    exports.TestTimer = function (assert, ms, barrier) {
        if (barrier === undefined) {
            barrier = 1;
        }
        this.count = barrier;
        this.assert = assert;
        
        var that = this;
        var timeout = function () {
            if (that.count > 0) {
                console.log("test timed out with count=" + that.count);
                that.assert.ok(false, "Timed out!");
                that.count = 0;
                QUnit.start();
            }
        };
        this.timer = setTimeout(timeout, ms);
    };

    exports.TestTimer.prototype.finish = function (name) {
        if (this.count > 0) {
            this.count -= 1;
            if (name) {
                this.assert.ok(true, "operation '" + name + "' completed in time");
            }

            if (this.count === 0) {
                this.assert.ok(true, "Completed in time");
                clearTimeout(this.timer);
                QUnit.start();
            }
        }
    };

    exports.deepClone = function (rootNode) {
        /* Clones a node and its descendents */
        var clone = rootNode.cloneNode();
        var i;
        for (i = 0; i < rootNode.childNodes.length; i++) {
            clone.appendChild(exports.deepClone(rootNode.childNodes[i]));
        }
        return clone;
    };

    exports.getTemplate = function (templateName) {
        var selected = document.querySelector("[data-template='" + templateName + "']");
        if (!selected) {
            return null;
        }
        if (selected.children.length === 0) {
            console.error("Template should have at least one child element.");
        }
        return exports.deepClone(selected.children[0]);
    };

    return exports;
});
