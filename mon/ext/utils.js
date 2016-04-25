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


/*jshint
  unused: false
*/
/*global
  sjcl
  escape, unescape,
  Promise
*/
/**
 *  Makes @child inherit from @parent


    Ex:

    function Animal() {}
    Animal.prototype = {
       canTalk: function () { return false; }
    };

    function Parrot() {
        Parrot.__super__.constructor.apply(this, arguments);
    }
    _extends(Parrot, Animal, {
       canTalk: function () { return true; }
    });
 */
var _extends = function (child, parent, childmethods) {
    "use strict";
    var key;

    for (key in parent) {
        // Copy class methods from parent (if child doesn't have them
        // already)
        if (Object.prototype.hasOwnProperty.call(parent, key) &&
            !Object.prototype.hasOwnProperty.call(child, key)) {
            child[key] = parent[key];
        }
    }

    function ctor() {
        /*jshint validthis: true */
        this.constructor = child;
    }

    ctor.prototype = parent.prototype;
    child.prototype = new ctor();
    child.__super__ = parent.prototype;

    if (childmethods !== undefined) {
        for (key in childmethods) {
            if (Object.prototype.hasOwnProperty.call(childmethods, key)) {
                child.prototype[key] = childmethods[key];
            }
        }
    }

    return child;
};

var DateUtil = {
    toDate: function (val) {
        "use strict";
        if ((typeof val) === "string" || (val instanceof String)) {
            // some iso date string
            return new Date(val);
        } else if ((typeof val) === "number") {
            // assume unix timestamp in seconds
            return new Date(val * 1000);
        } else if (val instanceof Date) {
            // noop
            return val;
        }
    },

    //  Feb 4 '09 at 8:23
    //  Mmm DD 'YY at HH:MM
    toShort: function (date) {
        "use strict";

        date = DateUtil.toDate(date);
        var mnames = ["January", "February", "March",
                      "April", "May", "June", "July",
                      "August", "September", "October",
                      "November", "December"];
        var day = date.getDate();
        var month = mnames[date.getMonth()].substr(0, 3);
        var year = ("" + date.getFullYear()).substr(-2);
        var h = date.getHours();
        var m = ("0" + date.getMinutes()).substr(-2);
        return month + " " + day + " '" + year + " at " + h + ":" + m;
    },

    //
    // Returns an easy-to-relate-to string for a given date,
    // relative to now. Returned values are in the browser's time
    // zone.
    //
    // Less than an hour:
    //   "1 min ago"
    //   "in 1 min"
    //
    // Less than a day:
    //   "14 hours ago"
    //   "in 2 hours"
    //
    // Less than a week:
    //   "3 days ago"
    //   "in 4 days"
    //
    // Else:
    //    Feb 4 '09 at 8:23
    //
    fromNow: function (date, absoluteDateOK) {
        "use strict";

        absoluteDateOK = (absoluteDateOK === undefined) ? true : !!absoluteDateOK;

        date = DateUtil.toDate(date);
        var now = new Date();
        var delta_ms = Math.abs(now - date);

        var qty = 0;
        var quanta = "min";

        var quanta_min = 60 * 1000;
        var quanta_hour = quanta_min * 60;
        var quanta_day = quanta_hour * 24;
        var quanta_week = quanta_day * 7;

        if (delta_ms < quanta_hour) {
            quanta = "min";
            qty = Math.floor((delta_ms + quanta_min / 2) / quanta_min);
        } else if (delta_ms < quanta_day) {
            qty = Math.floor((delta_ms + quanta_hour / 2) / quanta_hour);
            quanta = (qty > 1) ? "hours" : "hour";
        } else if (delta_ms < quanta_week) {
            qty = Math.floor((delta_ms + quanta_day / 2) / quanta_day);
            quanta = (qty > 1) ? "days" : "day";
        } else {
            if (absoluteDateOK) {
                return DateUtil.toShort(date);
            } else {
                return null;
            }
        }

        if (now - date > 0) {
            return "~" + qty + " " + quanta + " ago";
        } else {
            return "in ~" + qty + " " + quanta;
        }
    },

    //
    // if the date is not too distant, returns:
    //    "Mmm DD 'YY at HH:MM (x unit ago)"
    //
    // if the date is distant, only:
    //    "Mmm DD 'YY at HH:MM"
    //
    fromNowBoth: function (date) {
        "use strict";

        var fromNow = DateUtil.fromNow(date, false);
        if (fromNow === null) {
            // distant date
            return DateUtil.toShort(date);
        } else {
            return DateUtil.toShort(date) + " (" + fromNow + ") ";
        }
    }
};


function Fail(code, message) {
    "use strict";
    var stack = (new Error().stack);

    this.message = message || "Fail";
    this.code = (code === undefined) ? null:code;
    this.name = "Fail";
    // pop first frame off the stack
    this.stack = "Fail" + stack.substr(stack.indexOf("\n", stack.indexOf("\n") + 1));
}
_extends(Fail, Error, {});

Fail.INVALID_RPC = "INVALID_RPC";
Fail.BADPARAM    = "BADPARAM";
Fail.KAPERROR    = "KAPERROR";
Fail.NOKEY       = "NOKEY";
Fail.NOENT       = "NOENT"; // could not find entity
Fail.GENERIC     = "GENERIC";
Fail.NOKEYRING   = "NOKEYRING";
Fail.EXISTS      = "EXISTS";
Fail.OPENKEYRING = "OPENKEYRING";
Fail.BADTYPE     = "BADTYPE";
Fail.MAIMED      = "MAIMED"; /* Crypto Context should not be used anymore. */
Fail.INVALIDPAREA = "INVALIDPAREA";
Fail.INVALIDKEY  = "INVALIDKEY";
Fail.REFUSED     = "REFUSED";
Fail.NOIDENT     = "NOIDENT"; // could not resolve the recipient's identity */
Fail.STALE       = "STALE"; // stale key
Fail.PUBSUB      = "PUBSUB"; // fail to authenticate or to post to the pub/sub service
Fail.toRPC = function (err) {
    "use strict";

    return {code: err.code || Fail.GENERIC,
            message: err.message || ""};
};

Fail.fromVal = function (thing) {
    "use strict";

    switch (typeof thing) {
    case "undefined":
        console.error("undefined error value.");
        return new Fail(Fail.GENERIC);
    case "object":
        if (thing === null) {
            console.error("null error value");
            return new Fail(Fail.GENERIC);
        }

        if (thing instanceof String) {
            return new Fail(thing);
        }

        if (thing.code) {
            return new Fail(thing.code, thing.message);
        } else {
            console.error("unfamiliar error value");
            return new Fail(Fail.GENERIC);
        }
        break;
    case "string":
        return new Fail(thing);
    }
};

function getHost(url) {
    "use strict";

    var a =  document.createElement('a');
    a.href = url;
    return a.host;
}


function typeToString(t) {
    "use strict";

    if (t === null || t === undefined) {
        return "" + t;
    } else if ((typeof t) === "string" || (t instanceof String)) {
        return "string";
    } else if ((typeof t) === "boolean" || (t instanceof Boolean)) {
        return "boolean";
    } else if ((typeof t) === "number" || (t instanceof Number)) {
        return "number";
    } else if ((typeof t) === "function") {
        return t.name;
    } else if ((typeof t) === "object") {
        if (t instanceof Array) {
            return "array";
        } else if (t.constructor === Object) {
            var fields = [];
            for (var prop in t) {
                if (t.hasOwnProperty(prop)) {
                    fields.push("" + prop + ":" + typeToString(t[prop]));
                }
            }
            return "{" + fields.join(", ") + "}";
        } else {
            return t.constructor.name || t.toString();
        }
    }
}

function OneOf() {
    "use strict";

    if (this === window || this === null || this === undefined) {
        // allow 'new' to be omitted for brevity
        OneOf._expand = Array.prototype.slice.call(arguments, 0);
        return new OneOf();
    }

    if (arguments.length === 0) {
        if (OneOf._expand) {
            this.types = OneOf._expand;
            OneOf._expand = null;
        } else {
            throw new Error("You must specify at least one type item.");
        }
    } else {
        this.types = Array.prototype.slice.call(arguments, 0);
    }
}

OneOf._expand = null;
OneOf.prototype.toString = function () {
    "use strict";

    return "[" + this.types.map(typeToString).join("|") + "]";
};


/**
 * Type checks @val against @expectedVal, recursing into expectedVal
 * for checking sub-properties (but not through arrays). returns @val,
 * or throws BADTYPE error if type checking fails.
 *
 *   OneOf objects can be used in expectedVal to allow for variable
 *   type properties.
 *
 *   @val may contain (extra) properties not covered by
 *   @expectedVal. They are preserved in the return value.
 *
 *   Does not check for cycles.
 *
//
// Example tests [val, expectedVal, shouldPass]
//
[
    [{a: {b: true}}, {a: {c: OneOf(null, undefined)}}, true],
    [null, undefined, false],
    [{}, {}, true],
    [{a: true}, {}, true],
    [null, null, true],
    [2, 0, true],
    ["foo", "", true],
    ["foo", OneOf("", null), true],
    [2, OneOf("", null), false],
    [{a: ""}, {b: 2}, false],
    [[], [], true],
    [[], OneOf([]), true],
    [{a: {b: null}}, {a: {b: {}}}, false],
    [{a: {b: null}}, {a: OneOf({b: 2}, {b: false})}, false]
].map(function (x) {
    "use strict";
    var val = x[0], exp = x[1], res = x[2];
    try {
        typeCheck(val, exp);
        if (res) { console.log("OK", x); }
        else { console.log("Oops", x, "Should have failed."); }
    } catch (err) {
        if (res) { console.log("Oops", x, err.message, "Should have passed"); }
        else { console.log("OK", x, err.message); }
    }
});

 */
function assertType(val, expectedVal, _path) {
    "use strict";

    _path = _path || "val";

    function fail(notType) {
        throw new Fail(Fail.BADTYPE, "type(" + _path + ")" +
                       " (" + typeToString(val) + ") is not " + typeToString(notType));
    }

    switch (typeof expectedVal) {
    case "undefined":
        if (val !== undefined) {
            fail(undefined);
        }
        return val;
    case "boolean":
        if ((typeof val) !== "boolean" && !(val instanceof Boolean)) {
            fail(true);
        }
        return val;
    case "string":
        if ((typeof val) !== "string" && !(val instanceof String)) {
            fail("");
        }
        return val;
    case "number":
        if ((typeof val) !== "number" && !(val instanceof Number)) {
            fail(0);
        }
        return val;
    case "function":
        // constructor
        if (!(val instanceof expectedVal)) {
            fail(expectedVal);
        }
        return val;
    case "object":
        if (expectedVal === null) {
            if (val !== null) {
                fail(null);
            } else {
                return val;
            }
        }
        
        if (expectedVal instanceof Array) {
            if (!(val instanceof Array)) {
                fail([]);
            }
            return val;
        }

        if (expectedVal instanceof OneOf) {
            var i;

            for (i = 0; i < expectedVal.types.length; i += 1) {
                try {
                    return assertType(val, expectedVal.types[i], _path);
                } catch (err) {
                    if (err instanceof Fail) { continue; }
                    throw err;
                }
            }
            fail(expectedVal);
        }

        if (!(val instanceof Object)) {
            fail(expectedVal);
        }

        if (val.constructor !== Object) {
            // Don't recurse into complex objects
            fail(expectedVal);
        }

        //recurse
        for (var prop in expectedVal) {
            if (expectedVal.hasOwnProperty(prop)) {
                val[prop] = assertType(val[prop], expectedVal[prop], _path + "." + prop);
            }
        }
        return val;
    default:
        throw new Error("Unsupported type:", typeof expectedVal, expectedVal);
    }
}

/* extracts the owner:hex part of the keyid */
function keyidShortHex(keyid) {
    "use strict";

    var toks = keyid.split(/:/);
    if (toks.length !== 3) {
        throw new Fail(Fail.INVALIDKEY, "wrong format");
    }

    return decodeURIComponent(toks[0]) + ":" + toks[1];
}

var KH_TYPE = {keyid: ""};
var MSG_TYPE = {type: "", hdr: { to: "", from: "" }};

var Utils = {
    // string made from 128 random bits
    randomStr128: function () {
        "use strict";
        var arr = sjcl.random.randomWords(4);
        return sjcl.codec.hex.fromBits(arr);
    },
    typeToString: typeToString,

    defer: function () {
        "use strict";
        var defer = {};
        defer.promise = new Promise(function (resolve, reject) {
            defer.resolve = resolve;
            defer.reject = reject;
        });
        return defer;
    },

    /* empty object */
    isEmpty: function (d) {
        "use strict";

        var k;
        for (k in d) {
            if (d.hasOwnProperty(k)) {
                return false;
            }
        }
        return true;
    },

    sortedKeys: function (d) {
        "use strict";
        var keys = Object.getOwnPropertyNames(d);
        keys.sort();
        return keys;
    },

    utf8_to_b64: function (s) {
        "use strict";
        return window.btoa(unescape(encodeURIComponent(s)));
    },

    b64_to_utf8: function (s) {
        "use strict";
        return decodeURIComponent(escape(window.atob(s)));
    },

    DateUtil: DateUtil,

    keyidShortHex: keyidShortHex
};
