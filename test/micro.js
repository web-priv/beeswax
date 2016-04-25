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
  Promise, define, escape
  _M,
*/

/*jshint
 es5: true
*/

function encrypt_roundtrip(convid) {
    "use strict";

    _M.collect();
    var REPEATS = 51;

    var tarea = document.getElementById("results");
    function log(s) {
        tarea.value += s + "\n";
    }

    function do_round(repeats, plaintext) {
        var i = 0;

        var encryptBox = document.getElementById("encryptthis");
        encryptBox.value = plaintext;

        function do_one() {
            if ((i + 1) % 10 === 0) {
                log("# i=" + i);
            }
            if (i < repeats) {
                i += 1;
                return _M.encrypt_node("encryptthis", convid).then(function (/* ciphertext */) {
                    return true;
                }).catch(function (err) {
                    console.error("one failed", err);
                    throw err;
                });
            } else {
                return Promise.resolve(false);
            }
        }

        return new Promise(function (resolve, reject) {
            function _loop() {
                do_one().then(function (more) {
                    if (!more) {
                        resolve(_M.collect());
                    } else {
                        _loop();
                    }
                }).catch(function (err) {
                    reject(err);
                });
            }
            _loop();
        });
    }

    function process_timing(timing) {
        // microseconds
        ['start', 'end', 'csin', 'csout', 'bgin', 'bgout'].map(function (nam) {
            timing[nam] = Math.round(timing[nam] * 1000);
        });

        var rt = timing.end - timing.start;
        var bgtime = timing.bgout - timing.bgin;
        var cstime = (timing.csout - timing.csin) - bgtime;
        var prtime = rt - (timing.csout - timing.csin);
        return {
            rt: rt,
            bg: bgtime,
            cs: cstime,
            pr: prtime
        };
    }

    var results = [];
    var sizesKiB = [];
    while (sizesKiB.length < 10) {
        sizesKiB.push(sizesKiB.length * 64);
    }

    var kb = '****************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************';

    function getString(size) {
        if (size < 1) {
            return "";
        }
        var s = kb;
        while (s.length < size) {
            s = s + kb;
        }
        return s;
    }

    function doNext() {
        if (sizesKiB.length <= 0) {
            return Promise.resolve(false);
        }
        var sizeKiB = sizesKiB.shift();
        var plaintext = getString(sizeKiB * 1024);
        return do_round(REPEATS, plaintext).then(function (timings) {
            timings = timings.map(process_timing);
            results.push([sizeKiB, timings]);
            tarea.value += "# done with " + sizeKiB + "kiB plaintext\n";
            return true;
        }).catch(function (err) {
            console.error("round failed", err);
        });
    }

    var gotResults = new Promise(function (resolve, reject) {
        function _loop() {
            doNext().then(function (more) {
                if (!more) {
                    console.log(results);
                    resolve(results);
                } else {
                    _loop();
                }
            }).catch(function (err) {
                reject(err);
            });
        }
        _loop();
    });

    gotResults.then(function (results) {
        log("#Results:");
        log(["#sizekb", "pr", "cs", "bg", "rt"].join("\t"));
        var si, ti;
        for (si = 0; si < results.length; si += 1) {
            var sizeKiB = results[si][0];
            var timings = results[si][1];
            for (ti = 0; ti < timings.length; ti += 1) {
                var t = timings[ti];
                log(["" + sizeKiB, t.pr, t.cs, t.bg, t.rt].join("\t"));
            }
        }
    }).catch(function (err) {
        console.error(err);
        throw err;
    });
}

var keypress = function (k, elt) {
    "use strict";
    var oEvent = document.createEvent('KeyboardEvent');

    // Chromium Hack
    Object.defineProperty(oEvent, 'keyCode', {
        get: function () {
            return this.keyCodeVal;
        }
    });
    Object.defineProperty(oEvent, 'which', {
        get: function () {
            return this.keyCodeVal;
        }
    });

    if (oEvent.initKeyboardEvent) {
        oEvent.initKeyboardEvent("keypress", true, true, document.defaultView, false, false, false, false, k, k);
    } else {
        oEvent.initKeyEvent("keypress", true, true, document.defaultView, false, false, false, false, k, 0);
    }

    oEvent.keyCodeVal = k;

    if (oEvent.keyCode !== k) {
        alert("keyCode mismatch " + oEvent.keyCode + "(" + oEvent.which + ")");
    }

    elt.dispatchEvent(oEvent);
};

function keyboard_events() {
    var start, end;
    var loadTimes = [];
    var N = 100;
    var REPEATS = 1000;
    var i, j;

    var tarea = document.getElementById("results");
    var isMicasa = !!window._M;
    if (isMicasa) {
        tarea.value += " keypresses (with micasa) N=" + N + " rounds of " + REPEATS + "events\n";
    } else {
        tarea.value += " keypresses (without micasa) N=" + N + " rounds of " + REPEATS + "events\n";
    }

    var elt = document.getElementById("typeinthis");
    if (!elt) {
        throw new Error("can't find the box");
    }

    for (i = 0; i < N; i += 1) {
        start = Date.now();
        for (j = 0; j < REPEATS; j++) {
            keypress(65, elt);
        }
        end = Date.now();
        loadTimes.push(end - start);
    }
    tarea.value += loadTimes.join(",") + "\n";
}

function load_times() {
    "use strict";

    var start, end;
    var loadTimes = [];
    var REPEATS = 1;
    var i = 0;
    var container = document.getElementById("foo");
    //var tmpl = document.getElementById("inner").childNodes[0].nodeValue;
    //var txt = escape(tmpl.replace("<!--", "").replace(" -->", ""));
    //console.log(txt);
    function addIframe() {
        var iframe = document.createElement("iframe");
        iframe.setAttribute("width", 500);
        iframe.setAttribute("height", 600);
        iframe.setAttribute("style", "display: none;");
        container.appendChild(iframe);
        start = Date.now();

        //iframe.src = "data:text/html;charset-utf8," + txt;
        iframe.src = "innerframe.html";
    }
    
    function done() {
        console.log("all done", loadTimes);
        var tarea = document.getElementById("results");
        var isMicasa = !!window._M;
        if (isMicasa) {
            tarea.value += "Page load times (with micasa) \n";
        } else {
            tarea.value += "Page load times (without micasa) \n";
        }
        tarea.value += "N=" + REPEATS + "\n";
        tarea.value += loadTimes.join(",") + "\n";
    }

    function _iter() {
        if (i < REPEATS) {
            i += 1;
            addIframe();
        } else {
            done();
        }
    }

    window.onmessage = function (msg) {
        //console.log(msg.data);
        end = msg.data.loaded;
        loadTimes.push(end - start);
        container.removeChild(container.firstElementChild);
        _iter();
    };

    _iter();
}


window.onload = function () {
    "use strict";
    console.log("LOADED!");

    if (!window._M) {
        return start();
    }

    function start() {
        console.log("start");
        //load_times();
        //keyboard_events();
        if (window._M) {
            _M.new_conv().then(function (convid) {
                return encrypt_roundtrip(convid);
            }).catch(function (err) {
                console.error("Encrypt roundtrip failed.", err);
                throw err;
            });
        }
    }

    _M.use_keyring("foo").then(function () {
        start();
    }).catch(function (err) {
        if (err.code === "NOKEYRING") {
            return _M.new_keyring("foo").then(start);
        }
        throw err;
    }).catch(function (err) {
        console.error("asdasd", err);
    });
            
};