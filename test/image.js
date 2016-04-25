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
  escape, _M, Promise
*/

/*jshint
  es5: true
*/

document.addEventListener("DOMContentLoaded", start);



function start() {
    "use strict";

    _M.use_keyring("imagetest").then(function () {
        gotKeyring();
    }).catch(function (err) {
        console.error("Error opening keyring:", err);
        if (err.code === "NOKEYRING") {
            return _M.new_keyring("imagetest").then(function () {
                gotKeyring();
            }).catch(function (err) {
                console.log("new keyring failed:", err);
            });
        }
    });
}

function gotKeyring() {
    "use strict";
    console.log("keyring open.");

    // For the images
    Promise.all([_M.new_conv()]).then(function (convs) {
        console.log("Conversation created: ", convs);
        var imgtest = document.getElementById('imagetest');
        var imgtest2 = document.getElementById('imagetest2');

        _M.mark_private(imgtest, convs[0]);
        _M.mark_private(imgtest2, convs[0]);

        document.getElementById("copy").addEventListener("click", function () {
            _M.lighten(imgtest).then(function (blob) {
                return _M.darken(imgtest2, blob).then(function () {
                    console.log("photo copied from top box to bottom box");
                });
            }).catch(function (err) {
                console.error("could not get picture blob.", err);
            });
        });
    }).catch(function (err) {
        console.error("no conv created.", err);
    });

    // for the text
    Promise.all([_M.new_conv()]).then(function (convs) {
        console.log("Conversation created: ", convs);
        var htest = document.getElementById('someinput');
        var htest2 = document.getElementById('someoutput');

        _M.mark_private(htest, convs[0]);
        _M.mark_private(htest2, convs[0]);
        document.getElementById("dohighlight").addEventListener("click", function () {
            _M.lighten(htest).then(function (blob) {
                return _M.darken(htest2, blob).then(function () {
                    console.log("text copied from top box to bottom box");
                    return _M.exec_plugin(htest2, "highlight", {re: "foo"}).then(function () {
                        console.log("highlighted output");
                    });
                });
            }).catch(function (err) {
                console.error("could not get picture blob.", err);
            });
        });
    }).catch(function (err) {
        console.error("no conv created.", err);
    });

}

function handleImgClick(selector) {
    "use strict";

    return function handleClickEvt(evt) {
        if (evt) {
            evt.preventDefault();
        }

        selector.forEach(function (s) {
            console.log("BEFORE CLICK");
            //s.focus();
            s.click();
            //var x = confirm("nothing");
            console.log("AFTER CLICK");
        });
    };
}

function handleFileSelect(img) {
    "use strict";
    return function changeHandler(evt) {
        if (evt) {
            evt.preventDefault();
        }

        var files = evt.target.files; // FileList object
        var f = files[0];

        if (!f) {
            return;
        }

        console.log("type", f.type, "size", f.size, "name", f.name);

        var reader = new FileReader();
        reader.onload = function (e) {
            var x = e.target.result;
            console.log("result: ", x.length, x.substr(0, 600));
            img.src = x;
        };
        reader.readAsDataURL(f);
    };
}


function resplit(re, s, f) {
    "use strict";

    var r = new RegExp(re);
    var idx = s.search(r);
    f = f || function (tok, isDelim) { return; };

    while (idx !== -1) {
        var initLen = s.length;
        var front = s.substr(0, idx);
        s = s.substr(idx);
        if (front) {
            f(front, false);
        }
        var delim = s.match(r);
        f(delim[0], true);
        s = s.substr(delim[0].length);
        idx = s.search(r);
        if (s.length >= initLen) {
            throw new Error("Invalid tokenization");
        }
    }
    if (s) {
        f(s, false);
    }
}
