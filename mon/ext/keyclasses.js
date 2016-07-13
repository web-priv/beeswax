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
  sjcl, RSAKey,
  Fail, escape,
  _extends, Utils
*/

/**
 * KEY CLASSES
 *
 * Each type of key has an associated storage class, whose code is
 * responsible for providing (un)marshalling methods in and out of
 * storage, in addition to functionality provided by keys of this
 * type.
 *
 * To define a new class of key:
 *
 *   1 - Define a constructor. If no parameters are provided to the
 *     constructor, the constructor should initialize a new random
 *     key.
 *
 *   2 - Define a fromStore(obj) method taking in a JSON-parsed object
 *     and returning an initialized instance of the key class.
 *
 *   3 - Define a toStore() method taking no arguments and producing a
 *     JSON'able object (that can be fed back into fromStore()). In
 *     addition, the produced output should have a "typ" key with a
 *     unique value designating that class.
 *
 *   4 - Register the keyclass with the KeyLoader using the typ key
 *     defined in (3)
 */

/* singleton */
function KeyLoader() {}
KeyLoader.classes = {};
KeyLoader.registerClass = function (typId, klass) {
    "use strict";
    KeyLoader.classes[typId] = klass;
};
KeyLoader.fromStore = function (obj) {
    "use strict";

    var typ = obj.typ;
    if (!typ || KeyLoader.classes[typ] === undefined) {
        return null;
    }
    return KeyLoader.classes[typ].fromStore(obj);
};


// encodes a flat structure in a JSON string with sorted keys.
if (sjcl.json.encodeStable === undefined) {
    sjcl.json.encodeStable = function (obj) {
        "use strict";

        var i, out = '{', comma = '';
        var names = [];
        var idx;

        for (i in obj) {
            if (obj.hasOwnProperty(i)) {
                names.push(i);
            }
        }

        names.sort();

        for (idx = 0; idx < names.length; idx++) {
            i = names[idx];
            if (obj.hasOwnProperty(i)) {
                if (!i.match(/^[a-z0-9]+$/i)) {
                    throw new sjcl.exception.invalid("json encode: invalid property name");
                }
                out += comma + '"' + i + '":';
                comma = ',';

                switch (typeof obj[i]) {
                case 'number':
                case 'boolean':
                    out += obj[i];
                    break;

                case 'string':
                    out += '"' + escape(obj[i]) + '"';
                    break;

                case 'object':
                    out += '"' + sjcl.codec.base64.fromBits(obj[i], 0) + '"';
                    break;

                default:
                    throw new sjcl.exception.bug("json encode: unsupported type");
                }
            }
        }
        return out + '}';
    };
    // monkey patch
    sjcl.json.encode = sjcl.json.encodeStable;
}

/**
 * Symmetric AES key
 */
function AESKey(b64key) {
    "use strict";
    var randomWords, bits;

    this.key = null;

    if (!b64key) {
        randomWords = sjcl.random.randomWords(AESKey.KEYSIZE_BITS / 32, ECCKeyPair.getParanoia());
        bits = sjcl.bitArray.clamp(randomWords, AESKey.KEYSIZE_BITS);
        this.keySize = AESKey.KEYSIZE_BITS;
        this.key = bits;
    } else {
        bits = sjcl.codec.base64.toBits(b64key);
        var bitLength = sjcl.bitArray.bitLength(bits);
        if (bitLength !== AESKey.KEYSIZE_BITS) {
            console.error("Invalid number of bits in key.");
            throw new Fail(Fail.INVALIDKEY, "Invalid number of bits in key. Expected " + AESKey.KEYSIZE_BITS + " but got " +
                           bitLength + " bits.");
        }
        this.keySize = bitLength;
        this.key = sjcl.bitArray.clamp(bits, bitLength);
    }

    // names of users with access to this key
    // {"alice": true, "bob": true}
    this.principals = {};

    // names of principals with invalid keys
    this.invalid = {};

    // filled in when loading the key from storage
    this.keyid = null;
}

AESKey.KEYSIZE_BITS = 256;

AESKey.prototype = {
    toStore: function () {
        "use strict";

        return {
            typ: "aes",
            key: sjcl.codec.base64.fromBits(this.key),
            principals: this.principals,
            invalid: this.invalid
        };
    },

    invalidate: function (principal) {
        "use strict";
        this.invalid[principal] = true;
    },

    /**
       returns null if valid, otherwise the dictionary of
       invalidated username
    **/
    isInvalid: function () {
        "use strict";

        if (this.invalid === undefined || this.invalid === null) {
            return null;
        }

        for (var p in this.invalid) {
            if (this.invalid.hasOwnProperty(p)) {
                return this.invalid;
            }
        }
        return null;
    },
            
    toHex: function () {
        "use strict";
        return sjcl.codec.hex.fromBits(this.key);
    },

    /* returns a string that can be encrypted */
    getMaterial: function () {
        "use strict";
        return this.key;
    },

    getPrincipals: function () {
        "use strict";
        return this.principals;
    },

    encryptText: function (plainText) {
        "use strict";

        return sjcl.encrypt(this.key, plainText);
    },

    decryptText: function (cipherText) {
        "use strict";
        
        return sjcl.decrypt(this.key, cipherText);
    },

    /* returns a new key that is the XORed result of this key and @otherKey */
    xorKey: function (otherKey) {
        /*jshint bitwise: false */

        "use strict";
        var i;
        var newKey = [], newBits;

        if (otherKey === null || otherKey.keySize !== this.keySize) {
            throw new Error("key is incompatible");
        }
        if (this.keySize % 32 !== 0) {
            throw new Error("NOT IMPLEMENTED");
        }

        for (i = 0; i < this.key.length; i++) {
            newKey.push(this.key[i] ^ otherKey.key[i]);
        }

        //fixme -- study implementation more closely. looks right.
        if (sjcl.bitArray.bitLength(newKey) !== this.keySize) {
            throw new Error("Assertion failed. changed number of bits.");
        }

        newBits = sjcl.codec.base64.fromBits(newKey);
        return new AESKey(newBits);
    },
    
    // derive a new key from this key, using @text as input.  calling
    // this function again with the same @text value will produce the
    // same key.
    deriveKey: function (text) {
        "use strict";

        var hmac = new sjcl.misc.hmac(this.key, sjcl.hash.sha256);
        var bits = hmac.encrypt(text);
        var b64bits = sjcl.codec.base64.fromBits(bits);
        return new AESKey(b64bits, this.principals);
    },

    /* returns the SHA256 HMAC hexdigest of this key over @text. */
    hmac256: function (text) {
        "use strict";

        var hmac = new sjcl.misc.hmac(this.key, sjcl.hash.sha256);
        var bits = hmac.encrypt(text);
        return sjcl.codec.hex.fromBits(bits);
    },

    // Gets the hexdigest sha256 hash of this key's material
    sha256: function () {
        "use strict";
        var hash = sjcl.hash.sha256.hash(this.key);
        return sjcl.codec.hex.fromBits(hash);
    }
};

AESKey.fromHex = function (hexString) {
    "use strict";
    var material = sjcl.codec.hex.toBits(hexString);
    return new AESKey(sjcl.codec.base64.fromBits(material));
};

AESKey.fromStore = function (obj) {
    "use strict";
    
    if (obj.typ !== "aes") {
        return null;
    }

    var key = new AESKey(obj.key);
    if (obj.principals) {
        key.principals = obj.principals;
    }
    if (obj.invalid) {
        key.invalid = obj.invalid;
    }
    return key;
};

KeyLoader.registerClass("aes", AESKey);


/**
 * Asymmetric keys with only 'public' information
 */
function PubKey(signPem, encryptPem) {
    "use strict";

    this.sign = new RSAKey();
    if (signPem) {
        this.sign.readPublicKeyFromPEMString(signPem.pub);
    } else {
        this.sign.generate(512, "03");
    }

    this.encrypt = new RSAKey();
    if (encryptPem) {
        this.encrypt.readPublicKeyFromPEMString(encryptPem.pub);
    } else {
        this.encrypt.generate(512, "03");
    }
}

PubKey.prototype = {
    toStore: function () {
        "use strict";

        return {
            typ: "pubk",
            sign: {pub: this.sign.exportPublic()},
            encrypt: {pub: this.encrypt.exportPublic()}
        };
    },

    xport: function () {
        "use strict";

        var out = this.toStore();
        delete out.typ;
        return out;
    },

    verifySignature: function (message, signature) {
        "use strict";
        return this.sign.verify(message,
                                signature);
    },

    encryptSymmetric: function (aesKey) {
        "use strict";
        return this.encrypt.encrypt(aesKey);
    }
};

PubKey.fromStore = function (obj) {
    "use strict";

    if (obj.typ !== "pubk") {
        return null;
    }

    return new PubKey(obj.sign, obj.encrypt);
};

KeyLoader.registerClass("pubk", PubKey);


/**
 * Asymmetric keys with both 'public' and 'private' information.
 *
 */
function KeyPair(signPem, encryptPem) {
    "use strict";

    KeyPair.__super__.constructor.apply(this, arguments);

    if (signPem) {
        this.sign.readPrivateKeyFromPEMString(signPem.priv);
    }

    if (encryptPem) {
        this.encrypt.readPrivateKeyFromPEMString(encryptPem.priv);
    }
}
_extends(KeyPair, PubKey, {
    toStore: function () {
        "use strict";

        return {
            typ: "kp",
            sign: {pub: this.sign.exportPublic(), priv: this.sign.exportPrivate()},
            encrypt: {pub: this.encrypt.exportPublic(), priv: this.encrypt.exportPrivate()}
        };
    },

    signText: function (message, signType) {
        "use strict";
        return this.sign.signString(message, signType || "sha1");
    },

    decryptSymmetric: function (keyCipher) {
        "use strict";
        return this.encrypt.decrypt(keyCipher);
    }
});

KeyPair.fromStore = function (obj) {
    "use strict";

    if (obj.typ !== "kp") {
        return null;
    }

    return new KeyPair(obj.sign, obj.encrypt);
};


KeyLoader.registerClass("kp", KeyPair);


/**
 * Asymmetric keys with only 'public' information.
 *
 */
function ECCPubKey(signBits, encryptBits) {
    "use strict";
    var pub_xy, pub_pointbits, pubkey;

    if (!signBits) {
        console.warn("ECCPubKey contructor called without signBits.");
        //this.sign = {pub: x, sec: y}
        this.sign = sjcl.ecc.ecdsa.generateKeys(ECCKeyPair.curve, ECCKeyPair.getParanoia());
    } else {
        pub_xy = signBits.pub;
        pub_pointbits = sjcl.bitArray.concat(pub_xy.x, pub_xy.y);
        pubkey = new sjcl.ecc.ecdsa.publicKey(ECCKeyPair.curve, pub_pointbits);
        this.sign = { pub: pubkey, sec: null};
    }

    if (!encryptBits) {
        console.warn("ECCPubKey contructor called without encryptBits.");
        //this.encrypt = {pub: x, sec: y}
        this.encrypt = sjcl.ecc.elGamal.generateKeys(ECCKeyPair.curve, ECCKeyPair.getParanoia());
    } else {
        pub_xy = encryptBits.pub;
        pub_pointbits = sjcl.bitArray.concat(pub_xy.x, pub_xy.y);
        pubkey = new sjcl.ecc.elGamal.publicKey(ECCKeyPair.curve, pub_pointbits);

        // this.encrypt = {pub: x, sec: y}
        this.encrypt = {pub: pubkey, sec: null};
    }
    this.valid = true;
}

 /* constructs ECCPubKey from the output of minify */
ECCPubKey.unminify = function (minified) {
    "use strict";

    function unpackPoint(ptstring) {
        var toks = ptstring.split(":");
        var hexX = toks[0], hexY = toks[1];
        return {x: sjcl.codec.hex.toBits(hexX), y: sjcl.codec.hex.toBits(hexY)};
    }

    var storeFormat = {
        typ: "eccPubk",
        sign: {pub: unpackPoint(minified.sign)},
        encrypt: {pub: unpackPoint(minified.encrypt)},
        valid: true
    };

    return ECCPubKey.fromStore(storeFormat);
};

ECCPubKey.prototype = {
    toStore: function () {
        "use strict";

        return {
            typ: "eccPubk",
            sign: {pub: this.sign.pub.get()},
            encrypt: {pub: this.encrypt.pub.get()},
            valid: this.valid
        };
    },

    /*
      Returns digests of this public key
    */
    digests: function () {
        "use strict";

        var minif = this.minify();
        return [sjcl.hash.sha256.hash(minif.encrypt), sjcl.hash.sha256.hash(minif.sign)];
    },

    /* outputs:
      {encrypt: <short string>,
       sign: <short string>
       }
    */
    minify: function () {
        "use strict";

        var out = this.toStore();

        function packPoint(pt) {
            return sjcl.codec.hex.fromBits(pt.x) + ":" + sjcl.codec.hex.fromBits(pt.y);
        }

        return {
            encrypt: packPoint(out.encrypt.pub),
            sign: packPoint(out.sign.pub)
        };
    },

    xport: function () {
        "use strict";

        var out = this.toStore();
        delete out.typ;
        delete out.valid;
        return out;
    },

    verifySignature: function (message, signature) {
        "use strict";
        var sigBits = sjcl.codec.hex.toBits(signature);
        var hashMsg = sjcl.hash.sha256.hash(message);
        var pKey = this.sign.pub;
        return pKey.verify(hashMsg, sigBits);
    },

    encryptSymmetric: function (aesKey) {
        "use strict";
        // {key: bitarray, tag: bitarray}
        var pKem = this.encrypt.pub.kem();
        // stringified json
        var ct = sjcl.json.encrypt(pKem.key, sjcl.codec.base64.fromBits(aesKey.key));
        var ret = sjcl.codec.hex.fromBits(pKem.tag) + ":" + btoa(ct);
        return ret;
    },

    encryptMessage: function (message) {
        "use strict";
        var pKem = this.encrypt.pub.kem();
        // stringified json
        var ct = sjcl.json.encrypt(pKem.key, btoa(message));
        var ret = sjcl.codec.hex.fromBits(pKem.tag) + ":" + btoa(ct);
        return ret;
    },

    equalTo: function (other) {
        if (!other) {
            return false;
        }
        if (typeof this != typeof other) {
            return false;
        }
        
        function arrayEquals(a, b) {
            if (a.length != b.length) {
                return false;
            }
            for (var i = 0; i < a.length; i++) {
                if (a[i] != b[i]) {
                    return false;
                }
            }
            return true;
        }

        return arrayEquals(this.sign.pub.get().x, other.sign.pub.get().x) &&
            arrayEquals(this.sign.pub.get().y, other.sign.pub.get().y) &&
            arrayEquals(this.encrypt.pub.get().x, other.encrypt.pub.get().x) &&
            arrayEquals(this.encrypt.pub.get().y, other.encrypt.pub.get().y);
    }
};

ECCPubKey.fromStore = function (obj) {
    "use strict";

    if (obj.typ !== "eccPubk") {
        return null;
    }

    var key = new ECCPubKey(obj.sign, obj.encrypt);
    key.valid = obj.valid;
    return key;
};

KeyLoader.registerClass("eccPubk", ECCPubKey);

/**
 * Asymmetric keys with both 'public' and 'private' information.
 *
 */
function ECCKeyPair(signBits, encryptBits) {
    "use strict";

    if (!signBits) {
        this.sign = sjcl.ecc.ecdsa.generateKeys(ECCKeyPair.curve, ECCKeyPair.getParanoia());
    } else {
        var s_exp = sjcl.bn.fromBits(signBits.priv);
        // this.sign = {pub: x, sec: y}
        this.sign = sjcl.ecc.ecdsa.generateKeys(ECCKeyPair.curve, ECCKeyPair.getParanoia(), s_exp);
    }

    if (!encryptBits) {
        this.encrypt = sjcl.ecc.elGamal.generateKeys(ECCKeyPair.curve, ECCKeyPair.getParanoia());
    } else {
        var e_exp = sjcl.bn.fromBits(encryptBits.priv);
        // this.encrypt = {pub: x, sec: y}
        this.encrypt = sjcl.ecc.elGamal.generateKeys(ECCKeyPair.curve, ECCKeyPair.getParanoia(), e_exp);
    }
}

ECCKeyPair.getRandBN = function () {
    "use strict";

    var NIST_curve = sjcl.ecc.curves.c192;
    return sjcl.bn.random(NIST_curve.r, ECCKeyPair.getParanoia());
};

ECCKeyPair.getParanoia = function () {
    "use strict";
    return 6;
};

/* memoize curve generation: retrieve with ECCKeyPair.curve */
Object.defineProperty(ECCKeyPair, "curve", {
    enumerable: true,
    get: function () {
        "use strict";
/*
        ECCKeyPair._curve = ECCKeyPair._curve || new sjcl.ecc.curve(sjcl.bn.prime.p192k,
                                                                    sjcl.bn.prime.p224k,
                                                                    ECCKeyPair.getRandBN(),
                                                                    ECCKeyPair.getRandBN(),
                                                                    ECCKeyPair.getRandBN(),
                                                                    ECCKeyPair.getRandBN());

        var s = sjcl.bn.pseudoMersennePrime;
	var p192 = sjcl.bn.prime.p192k;
	var p224 = sjcl.bn.prime.p224k;
	var rnd = ECCKeyPair.getRandBN();

        var phex = "C302F41D932A36CDA7A3463093D18DB78FCE476DE1A86297";
        var p = sjcl.bn.fromBits(sjcl.codec.hex.toBits(phex));
        var rhex = "C302F41D932A36CDA7A3462F9E9E916B5BE8F1029AC4ACC1";
        var r = sjcl.bn.fromBits(sjcl.codec.hex.toBits(rhex));
        var ahex = "6A91174076B1E0E19C39C031FE8685C1CAE040E5C69A28EF";
        var a = sjcl.bn.fromBits(sjcl.codec.hex.toBits(ahex));
        var bhex = "469A28EF7C28CCA3DC721D044F4496BCCA7EF4146FBF25C9";
        var b = sjcl.bn.fromBits(sjcl.codec.hex.toBits(bhex));
        var xhex = "C0A0647EAAB6A48753B033C56CB0F0900A2F5C4853375FD6";
        var x = sjcl.bn.fromBits(sjcl.codec.hex.toBits(xhex));
        var yhex = "14B690866ABD5BB88B5F4828C1490002E6773FA2FA299B8F";
        var y = sjcl.bn.fromBits(sjcl.codec.hex.toBits(yhex));

        ECCKeyPair._curve = ECCKeyPair._curve || new sjcl.ecc.curve(p,r,a,b,x,y);
*/
        ECCKeyPair._curve =  sjcl.ecc.curves.c192;
        return ECCKeyPair._curve;
    }
});

_extends(ECCKeyPair, ECCPubKey, {
    toStore: function () {
        "use strict";

        return {
            typ: "ecckp",
            //public key generated from private. don't store pub:
            sign: {priv: this.sign.sec.get()},
            encrypt: {priv: this.encrypt.sec.get()}
        };
    },

    decryptSymmetric: function (keyCipher) {
        "use strict";
        var first = keyCipher.indexOf(":");
        var hexTag = keyCipher.substr(0, first);
        var ct = atob(keyCipher.substr(first + 1));

        var sKem = this.encrypt.sec.unkem(sjcl.codec.hex.toBits(hexTag));
        var b64Key = sjcl.decrypt(sKem, ct);
        return new AESKey(b64Key);
    },

    decryptMessage: function (keyCipher) {
       "use strict";
        var first = keyCipher.indexOf(":");
        var hexTag = keyCipher.substr(0, first);
        var ct = atob(keyCipher.substr(first + 1)); 
        var sKem = this.encrypt.sec.unkem(sjcl.codec.hex.toBits(hexTag));
        return atob(sjcl.decrypt(sKem, ct));
    },

    signText: function (message) {
        "use strict";
        var hashMsg = sjcl.hash.sha256.hash(message);
        var sKey = this.sign.sec;
        return sjcl.codec.hex.fromBits(sKey.sign(hashMsg, ECCKeyPair.getParanoia()));
    },

    toPubKey: function () {
        "use strict";
        var pub = ECCPubKey.prototype.toStore.apply(this);
        return ECCPubKey.fromStore(pub);
    },

    minify: function () {
        "use strict";

        return this.toPubKey().minify();
    }
});

ECCKeyPair.fromStore = function (obj) {
    "use strict";

    // obj has the format returned by toStore().

    if (obj.typ !== "ecckp") {
        return null;
    }

    return new ECCKeyPair(obj.sign, obj.encrypt);
};

KeyLoader.registerClass("ecckp", ECCKeyPair);

function AnonKey(key) {

    if (!key) {
    this.principals = [];
    this.keyid = null;
    }
    else {
        this.principals = key.principals;
        this.keyid = key.keyid;
    }
}

AnonKey.prototype.toStore = function (keyid) {
        "use strict";

        return {
            typ: "anon",
            principals: this.principals,
            keyid: keyid
        };
    };

AnonKey.fromStore = function (obj) {
    "use strict";
    
    if (obj.typ !== "anon") {
        return null;
    }

    var key = new AnonKey(obj.key);
    if (obj.principals) {
        key.principals = obj.principals;
    }
    if (obj.keyid) {
        key.keyid = obj.keyid;
    }
    return key;
};

KeyLoader.registerClass("anon", AnonKey);

function Friendship(opts) {
    "use strict";

    this.self = opts.self;               // username 1
    this.other = opts.other;             // username 2
    this.initiated = opts.initiated;     // true if initiated by (1)
    this.masterKey = opts.masterKey;
    this.aId = opts.aId;
    this.bId = opts.bId;
    this.fEnc = opts.fEnc;
    this.fMac = opts.fMac;
}
Friendship.fromStore = function (obj) {
    "use strict";

    if (obj.typ !== "fr") {
        return null;
    }
    var opts = obj.opts;
    var reconst = {
        self: opts.self, // username
        other: opts.other, // username
        initiated: opts.initiated,
        masterKey: KeyLoader.fromStore(opts.masterKey),
        aId: opts.aId,
        bId: opts.bId,
        fEnc: KeyLoader.fromStore(opts.fEnc),
        fMac: KeyLoader.fromStore(opts.fMac)
    };
    return new Friendship(reconst);
};

Friendship._serializeMsg = function (msg) {
    "use strict";
    var obj = [];
    obj.push(msg.type);
    obj.push(msg.hdr.to);
    obj.push(msg.hdr.from);
    obj.push((msg.hdr.AFID === undefined) ? "" : msg.hdr.AFID);
    obj.push((msg.hdr.BFID === undefined) ? "" : msg.hdr.BFID);
    if (msg.payload !== undefined) {
        obj.push(msg.payload.convid);
        obj.push(msg.payload.convkey);
    }
    return JSON.stringify(obj);
};

Friendship.makeKeyid = function (obj) {
    "use strict";
    return btoa(obj.aId) + ":" + btoa(obj.bId) + ":" + btoa(obj.self) + ":" + btoa(obj.other);
};

/*
 * Usually there is just one, but there may be more than one
 * friendship channel being established simultaneously. So in the
 * storage they need to be uniquely keyed within the account's
 * namespace.
 */
Friendship.prototype.getKeyid = function () {
    "use strict";
    return Friendship.makeKeyid(this);
};

Friendship.prototype._hmacMsg = function (msg) {
    "use strict";

    var s = Friendship._serializeMsg(msg);
    var digest = this.fMac.hmac256(s);
    return digest;
};

Friendship.prototype.genInvite = function (convId, convKey) {
    "use strict";

    var msg = {
        type: "INVITE",
        hdr: { from: this.self,
               to: this.other,
               AFID: this.aId,
               BFID: this.bId
             },
        payload: {
            convid: convId,
            convkey: btoa(this.fEnc.encryptText(convKey.toHex()))
        }
    };
    msg.hmac = this._hmacMsg(msg);
    return msg;
};

Friendship.prototype.verifyInvite = function (msg) {
    "use strict";

    if (msg.type !== "INVITE") {
        throw new Fail(Fail.BADTYPE, "expected INVITE");
    }

    // no need to verify this. friendship is symmetrical.
    // if (msg.hdr.to !== this.self || msg.hdr.from !== this.other) {
    //     throw new Fail(Fail.BADPARAM, "invalid source/target");
    // }


    if (msg.hdr.AFID !== this.aId || msg.hdr.BFID !== this.bId) {
        throw new Fail(Fail.BADPARAM, "invalid friendship id");
    }

    var expectedMac = this._hmacMsg(msg);
    if (expectedMac !== msg.hmac) {
        throw new Fail(Fail.BADPARAM, "invalid message hmac");
    }

    var convid = msg.payload.convid;

    // fixme verify that convid starts with from user

    var convkey = AESKey.fromHex(this.fEnc.decryptText(atob(msg.payload.convkey)));
    return {convid: convid, convkey: convkey};
},


Friendship.prototype.toStore = function () {
    "use strict";
    return {
        typ: "fr",
        opts: {
            self: this.self,
            other: this.other,
            initiated: this.initiated,
            masterKey: this.masterKey.toStore(),
            aId: this.aId,
            bId: this.bId,
            fEnc: this.fEnc.toStore(),
            fMac: this.fMac.toStore()
        }
    };
};

KeyLoader.registerClass("fr", Friendship);
