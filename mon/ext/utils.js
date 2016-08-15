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

var hexcase = 0;  /* hex output format. 0 - lowercase; 1 - uppercase        */
var b64pad  = "="; /* base-64 pad character. "=" for strict RFC compliance   */

/*
 * These are the functions you'll usually want to call
 * They take string arguments and return either hex or base-64 encoded strings
 */
function hex_sha1(s)    { return rstr2hex(rstr_sha1(str2rstr_utf8(s))); }
function b64_sha1(s)    { return rstr2b64(rstr_sha1(str2rstr_utf8(s))); }
function any_sha1(s, e) { return rstr2any(rstr_sha1(str2rstr_utf8(s)), e); }
function hex_hmac_sha1(k, d)
  { return rstr2hex(rstr_hmac_sha1(str2rstr_utf8(k), str2rstr_utf8(d))); }
function b64_hmac_sha1(k, d)
  { return rstr2b64(rstr_hmac_sha1(str2rstr_utf8(k), str2rstr_utf8(d))); }
function any_hmac_sha1(k, d, e)
  { return rstr2any(rstr_hmac_sha1(str2rstr_utf8(k), str2rstr_utf8(d)), e); }

/*
 * Perform a simple self-test to see if the VM is working
 */
function sha1_vm_test()
{
  return hex_sha1("abc") == "a9993e364706816aba3e25717850c26c9cd0d89d";
}

/*
 * Calculate the SHA1 of a raw string
 */
function rstr_sha1(s)
{
  return binb2rstr(binb_sha1(rstr2binb(s), s.length * 8));
}

/*
 * Calculate the HMAC-SHA1 of a key and some data (raw strings)
 */
function rstr_hmac_sha1(key, data)
{
  var bkey = rstr2binb(key);
  if(bkey.length > 16) bkey = binb_sha1(bkey, key.length * 8);

  var ipad = Array(16), opad = Array(16);
  for(var i = 0; i < 16; i++)
  {
    ipad[i] = bkey[i] ^ 0x36363636;
    opad[i] = bkey[i] ^ 0x5C5C5C5C;
  }

  var hash = binb_sha1(ipad.concat(rstr2binb(data)), 512 + data.length * 8);
  return binb2rstr(binb_sha1(opad.concat(hash), 512 + 160));
}

/*
 * Convert a raw string to a hex string
 */
function rstr2hex(input)
{
  var hex_tab = hexcase ? "0123456789ABCDEF" : "0123456789abcdef";
  var output = "";
  var x;
  for(var i = 0; i < input.length; i++)
  {
    x = input.charCodeAt(i);
    output += hex_tab.charAt((x >>> 4) & 0x0F)
           +  hex_tab.charAt( x        & 0x0F);
  }
  return output;
}

/*
 * Convert a raw string to a base-64 string
 */
function rstr2b64(input)
{
  var tab = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var output = "";
  var len = input.length;
  for(var i = 0; i < len; i += 3)
  {
    var triplet = (input.charCodeAt(i) << 16)
                | (i + 1 < len ? input.charCodeAt(i+1) << 8 : 0)
                | (i + 2 < len ? input.charCodeAt(i+2)      : 0);
    for(var j = 0; j < 4; j++)
    {
      if(i * 8 + j * 6 > input.length * 8) output += b64pad;
      else output += tab.charAt((triplet >>> 6*(3-j)) & 0x3F);
    }
  }
  return output;
}

/*
 * Convert a raw string to an arbitrary string encoding
 */
function rstr2any(input, encoding)
{
  var divisor = encoding.length;
  var remainders = Array();
  var i, q, x, quotient;

  /* Convert to an array of 16-bit big-endian values, forming the dividend */
  var dividend = Array(Math.ceil(input.length / 2));
  for(i = 0; i < dividend.length; i++)
  {
    dividend[i] = (input.charCodeAt(i * 2) << 8) | input.charCodeAt(i * 2 + 1);
  }

  /*
   * Repeatedly perform a long division. The binary array forms the dividend,
   * the length of the encoding is the divisor. Once computed, the quotient
   * forms the dividend for the next step. We stop when the dividend is zero.
   * All remainders are stored for later use.
   */
  while(dividend.length > 0)
  {
    quotient = Array();
    x = 0;
    for(i = 0; i < dividend.length; i++)
    {
      x = (x << 16) + dividend[i];
      q = Math.floor(x / divisor);
      x -= q * divisor;
      if(quotient.length > 0 || q > 0)
        quotient[quotient.length] = q;
    }
    remainders[remainders.length] = x;
    dividend = quotient;
  }

  /* Convert the remainders to the output string */
  var output = "";
  for(i = remainders.length - 1; i >= 0; i--)
    output += encoding.charAt(remainders[i]);

  /* Append leading zero equivalents */
  var full_length = Math.ceil(input.length * 8 /
                                    (Math.log(encoding.length) / Math.log(2)))
  for(i = output.length; i < full_length; i++)
    output = encoding[0] + output;

  return output;
}

/*
 * Encode a string as utf-8.
 * For efficiency, this assumes the input is valid utf-16.
 */
function str2rstr_utf8(input)
{
  var output = "";
  var i = -1;
  var x, y;

  while(++i < input.length)
  {
    /* Decode utf-16 surrogate pairs */
    x = input.charCodeAt(i);
    y = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
    if(0xD800 <= x && x <= 0xDBFF && 0xDC00 <= y && y <= 0xDFFF)
    {
      x = 0x10000 + ((x & 0x03FF) << 10) + (y & 0x03FF);
      i++;
    }

    /* Encode output as utf-8 */
    if(x <= 0x7F)
      output += String.fromCharCode(x);
    else if(x <= 0x7FF)
      output += String.fromCharCode(0xC0 | ((x >>> 6 ) & 0x1F),
                                    0x80 | ( x         & 0x3F));
    else if(x <= 0xFFFF)
      output += String.fromCharCode(0xE0 | ((x >>> 12) & 0x0F),
                                    0x80 | ((x >>> 6 ) & 0x3F),
                                    0x80 | ( x         & 0x3F));
    else if(x <= 0x1FFFFF)
      output += String.fromCharCode(0xF0 | ((x >>> 18) & 0x07),
                                    0x80 | ((x >>> 12) & 0x3F),
                                    0x80 | ((x >>> 6 ) & 0x3F),
                                    0x80 | ( x         & 0x3F));
  }
  return output;
}

/*
 * Encode a string as utf-16
 */
function str2rstr_utf16le(input)
{
  var output = "";
  for(var i = 0; i < input.length; i++)
    output += String.fromCharCode( input.charCodeAt(i)        & 0xFF,
                                  (input.charCodeAt(i) >>> 8) & 0xFF);
  return output;
}

function str2rstr_utf16be(input)
{
  var output = "";
  for(var i = 0; i < input.length; i++)
    output += String.fromCharCode((input.charCodeAt(i) >>> 8) & 0xFF,
                                   input.charCodeAt(i)        & 0xFF);
  return output;
}

/*
 * Convert a raw string to an array of big-endian words
 * Characters >255 have their high-byte silently ignored.
 */
function rstr2binb(input)
{
  var output = Array(input.length >> 2);
  for(var i = 0; i < output.length; i++)
    output[i] = 0;
  for(var i = 0; i < input.length * 8; i += 8)
    output[i>>5] |= (input.charCodeAt(i / 8) & 0xFF) << (24 - i % 32);
  return output;
}

/*
 * Convert an array of little-endian words to a string
 */
function binb2rstr(input)
{
  var output = "";
  for(var i = 0; i < input.length * 32; i += 8)
    output += String.fromCharCode((input[i>>5] >>> (24 - i % 32)) & 0xFF);
  return output;
}

/*
 * Calculate the SHA-1 of an array of big-endian words, and a bit length
 */
function binb_sha1(x, len)
{
  /* append padding */
  x[len >> 5] |= 0x80 << (24 - len % 32);
  x[((len + 64 >> 9) << 4) + 15] = len;

  var w = Array(80);
  var a =  1732584193;
  var b = -271733879;
  var c = -1732584194;
  var d =  271733878;
  var e = -1009589776;

  for(var i = 0; i < x.length; i += 16)
  {
    var olda = a;
    var oldb = b;
    var oldc = c;
    var oldd = d;
    var olde = e;

    for(var j = 0; j < 80; j++)
    {
      if(j < 16) w[j] = x[i + j];
      else w[j] = bit_rol(w[j-3] ^ w[j-8] ^ w[j-14] ^ w[j-16], 1);
      var t = safe_add(safe_add(bit_rol(a, 5), sha1_ft(j, b, c, d)),
                       safe_add(safe_add(e, w[j]), sha1_kt(j)));
      e = d;
      d = c;
      c = bit_rol(b, 30);
      b = a;
      a = t;
    }

    a = safe_add(a, olda);
    b = safe_add(b, oldb);
    c = safe_add(c, oldc);
    d = safe_add(d, oldd);
    e = safe_add(e, olde);
  }
  return Array(a, b, c, d, e);

}

/*
 * Perform the appropriate triplet combination function for the current
 * iteration
 */
function sha1_ft(t, b, c, d)
{
  if(t < 20) return (b & c) | ((~b) & d);
  if(t < 40) return b ^ c ^ d;
  if(t < 60) return (b & c) | (b & d) | (c & d);
  return b ^ c ^ d;
}

/*
 * Determine the appropriate additive constant for the current iteration
 */
function sha1_kt(t)
{
  return (t < 20) ?  1518500249 : (t < 40) ?  1859775393 :
         (t < 60) ? -1894007588 : -899497514;
}

/*
 * Add integers, wrapping at 2^32. This uses 16-bit operations internally
 * to work around bugs in some JS interpreters.
 */
function safe_add(x, y)
{
  var lsw = (x & 0xFFFF) + (y & 0xFFFF);
  var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
  return (msw << 16) | (lsw & 0xFFFF);
}

/*
 * Bitwise rotate a 32-bit number to the left.
 */
function bit_rol(num, cnt)
{
  return (num << cnt) | (num >>> (32 - cnt));
}



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
    if (toks.length !== 4) {
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

    hmac_sha1: function(k, d) {
        "use strict";
        return rstr2b64(rstr_hmac_sha1(str2rstr_utf8(k), str2rstr_utf8(d)));
    },

    DateUtil: DateUtil,

    keyidShortHex: keyidShortHex
};
