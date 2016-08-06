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
  es5: true
*/

/*global
  chrome, Promise, performance
  PubKey, ECCPubKey, KeyPair, AESKey, KeyLoader, ECCKeyPair, Friendship
  UI, Utils, Vault
  getHost, Fail, assertType, OneOf, KH_TYPE, MSG_TYPE, _extends
*/

console.log("Micasa External Monitor - background script init");

var storageArea = chrome.storage.local;

//some relevent chrome bugs (dupes)
//http://code.google.com/p/chromium/issues/detail?id=141716
//http://code.google.com/p/chromium/issues/detail?id=85584

var cryptoCtxSerial = 0;
var bgCallSerial = 0;

var API;

function KAP(kapEngine, myName, myIdent, otherName, otherIdent) {
    "use strict";

    this.self  = myName;
    this.selfIdent = myIdent; //keypair
    this.other = otherName;
    this.otherIdent = otherIdent || null; // public key
    this.state = 0;
    this.engine = kapEngine;
    this.initiated = false;

    this.challengeNonce = Utils.randomStr128();
    this.masterKey = null;
    this.masterKeyContrib = null;
    this.aId = null;
    this.aCommitment = null;
    this.bId = null;
    this.fEnc = null;
    this.fMac = null;
    this.extCallId = -1;
    this.friendship = Utils.defer();
}

KAP.KAP_MSG1 = "KAP_MSG1";
KAP.KAP_MSG2 = "KAP_MSG2";
KAP.KAP_MSG3 = "KAP_MSG3";
KAP.KAP_MSG4 = "KAP_MSG4";

// custom serialization of the KAP messages.
// json stringification has unreliable attribute ordering,
// so we transform into an array first and stringify.
KAP._serializeMsg = function (msg) {
    "use strict";

    var obj = [];
    obj.push(msg.type);
    obj.push(msg.hdr.to);
    obj.push(msg.hdr.from);
    obj.push((msg.hdr.AFID === undefined) ? "" : msg.hdr.AFID);
    obj.push((msg.hdr.BFID === undefined) ? "" : msg.hdr.BFID);
    obj.push((msg.payload === undefined) ? "" : msg.payload);
    return JSON.stringify(obj);
};

KAP._verifySignature = function (msgObj, pubkey) {
    "use strict";
    var s = KAP._serializeMsg(msgObj);
    return pubkey.verifySignature(s, msgObj.signature);
};

KAP._verifyHMAC = function (msgObj, aeskey) {
    "use strict";
    var s = KAP._serializeMsg(msgObj);
    var digest = aeskey.hmac256(s);
    return digest === msgObj.hmac;
};

// augments the message with a signature
KAP._signMsg = function (msgObj, privkey) {
    "use strict";

    var s = KAP._serializeMsg(msgObj);
    var signature = privkey.signText(s);
    msgObj.signature = signature;
    return msgObj;
};

KAP._hmacMsg = function (msgObj, aeskey) {
    "use strict";

    var s = KAP._serializeMsg(msgObj);
    var digest = aeskey.hmac256(s);
    msgObj.hmac = digest;
    return msgObj;
};

KAP.prototype = {
    initiate: function () {
        "use strict";

        var that = this;

        try {
            var start = that._genKAP1();
            that.state += 1;
            that.engine.send(start);
        } catch (err) {
            console.error("cannot start protocol", err);
            that.friendship.reject(err);
        }
    },

    // takes masterkey and creates channel keys
    _deriveFriendshipKeys: function () {
        "use strict";

        if (!this.masterKey) {
            throw new Error("no master key yet");
        }
        this.fMac = this.masterKey.deriveKey("mac");
        this.fEnc = this.masterKey.deriveKey("enc");
        console.log("Derived friendship keys fMac:", this.fMac.toStore(), "fEnc:", this.fEnc.toStore());
    },

    _genKAP1: function () {
        "use strict";

        this.initiated = true;

        if (this.aId === null) {
            this.aId = this.challengeNonce;
        }

        if (this.masterKeyContrib === null) {
            this.masterKeyContrib = new AESKey();
        }

        var msg = {
            type: KAP.KAP_MSG1,
            hdr: {
                to: this.other,
                from: this.self,
                AFID: this.aId
            }
        };
        // aCommitment
        var payload = this.masterKeyContrib.sha256();
        msg.payload = payload;
        return msg;
    },

    _genKAP2: function () {
        "use strict";

        if (this.bId === null) {
            this.bId = this.challengeNonce;
        }

        if (this.masterKeyContrib === null) {
            this.masterKeyContrib = new AESKey();
        }

        var msg = {
            type: KAP.KAP_MSG2,
            hdr: {
                to: this.other,
                from: this.self,
                AFID: this.aId,
                BFID: this.bId
            }
        };
        //payload: enc(k=Aenc+, m=Bmk)
        var payload = this.otherIdent.encryptSymmetric(this.masterKeyContrib);
        msg.payload = payload;
        var signed = KAP._signMsg(msg, this.selfIdent);
        this.selfIdent.verifySignature(KAP._serializeMsg(signed), signed.signature);
        return signed;
    },

    _genKAP3: function () {
        "use strict";

        var msg = {
            type: KAP.KAP_MSG3,
            hdr: {
                to: this.other,
                from: this.self,
                AFID: this.aId,
                BFID: this.bId
            }
        };
        //payload: enc(k=Benc+, m=Amk)
        var payload = this.otherIdent.encryptSymmetric(this.masterKeyContrib);
        msg.payload = payload;
        return KAP._signMsg(msg, this.selfIdent);
    },

    _genKAP4: function () {
        "use strict";

        var msg = {
            type: KAP.KAP_MSG4,
            hdr: {
                to: this.other,
                from: this.self,
                AFID: this.aId,
                BFID: this.bId
            },
            payload: null
        };

        return KAP._hmacMsg(msg, this.fMac);
    }
};

/**
   KAPEngine

   @constructor
   @param {string} username
   @param {ECCKeyPair} account the account on this end of the friendships
*/
function KAPEngine(username, account) {
    "use strict";

    // Keyed by friend username
    this.kaps = {};
    this.onmessage = null;
    this.username = username;
    this.ident = account;
}

KAPEngine.prototype = {

    _friendKey: function (username) {
        "use strict";

        return "friend." + btoa(username);
    },

    _identKey: function (username) {
        "use strict";
        
        return "ident." + btoa(username);
    },

    // promises the object after storing it
    _storeFriendship: function (friendship) {
        "use strict";

        var storageKey = CryptoCtx.userKeyName(this.username, friendship.getKeyid(), "fr");
        return API.storeKey(storageKey, friendship).then(function () {
            return friendship;
        });
    },

    // Promises a Friendship object
    requestFriendship: function (username, pubkey) {
        "use strict";

        var fk = this._friendKey(username);
        var that = this;

        if (!that.kaps[fk]) {
            var kap = new KAP(that, that.username, that.ident, username, pubkey);
            that.kaps[fk] = kap;
            kap.friendship.promise.catch(function (err) {
                console.error("KAP failed to complete. Removing from active list. Error:", err);
                delete that.kaps[fk];
            });
            window.setTimeout(function () { kap.initiate(); }, 0);
        }
        return that.kaps[fk].friendship.promise;
    },

    send: function (msg) {
        "use strict";

        if (this.onmessage) {
            this.onmessage(msg, this);
        } else {
            console.log("[KAP] outgoing message dropped:", msg, JSON.stringify(msg));
        }
    },

    _recvKAP1: function (msg) {
        "use strict";
        var friendName = msg.hdr.from;
        var that = this;
        var fk = that._friendKey(friendName);

        if (!that.kaps[fk]) {
            API.fetchPublic(friendName).then(function (pubKey) {
                var kap = new KAP(that, that.username, that.ident, friendName, pubKey);
                kap.state = 1;
                kap.initiated = false;
                kap.aId = msg.hdr.AFID;
                kap.aCommitment = msg.payload;
                var msg2 = kap._genKAP2();

                var fk = that._friendKey(friendName);
                that.kaps[fk] = kap;

                that.onmessage(msg2);
            }).catch(function (err) {
                console.error("Could not retrieve ", friendName, "public key", err);
            });
        }
    },

    _recvKAP2: function (msg) {
        "use strict";

        var that = this;
        var from = msg.hdr.from;

        var fk = this._friendKey(from);
        var kap = this.kaps[fk];
        if (!kap) {
            throw new Fail(Fail.KAPERROR, "no friendship request for", from);
        }

        function failKAP(kap, err) {
            kap.friendship.reject(err);
            throw err;
        }
        
        console.log("received kap2 in state:", kap.state, kap);

        if (msg.hdr.AFID !== kap.aId) {
            console.error("msg AFID:", msg.hdr.AFID, "kap.aId:", kap.aId);
            failKAP(kap, new Fail(Fail.KAPERROR, "different AFID expected"));
        }

        kap.bId = msg.hdr.BFID;

        if (!KAP._verifySignature(msg, kap.otherIdent)) {
            failKAP(kap, new Fail(Fail.KAPERROR, "bad signature"));
        }

        var payload = msg.payload;
        var Bmk = kap.selfIdent.decryptSymmetric(payload);
        var masterKey = kap.masterKeyContrib.xorKey(Bmk);
        kap.masterKey = masterKey;
        kap._deriveFriendshipKeys();

        var msg3 = kap._genKAP3();
        that.onmessage(msg3);
    },

    _recvKAP3: function (msg) {
        "use strict";
        var that = this;
        var from = msg.hdr.from;

        var fk = this._friendKey(from);
        var kap = this.kaps[fk];
        if (!kap) {
            throw new Fail(Fail.KAPERROR, "no friendship request for", from);
        }
        console.log("received kap3 in state:", kap.state, kap);

        function failKAP(kap, err) {
            kap.friendship.reject(err);
            throw err;
        }

        if (!KAP._verifySignature(msg, kap.otherIdent)) {
            failKAP(new Fail(Fail.KAPERROR, "bad signature"));
        }
        
        if (msg.hdr.AFID !== kap.aId) {
            console.error("msg AFID:", msg.hdr.AFID, "kap.aId:", kap.aId);
            failKAP(kap, new Fail(Fail.KAPERROR, "different AFID expected"));
        }

        if (msg.hdr.BFID !== kap.bId) {
            console.error("msg BFID:", msg.hdr.BFID, "kap.bId:", kap.bId);
            failKAP(kap, new Fail(Fail.KAPERROR, "different BFID expected"));
        }

        var payload = msg.payload;
        var Amk = kap.selfIdent.decryptSymmetric(payload);

        // recompute commitment
        var commitment = Amk.sha256();
        if (commitment !== kap.aCommitment) {
            failKAP(kap, new Fail(Fail.KAPERROR, "invalid commitment value"));
        }

        // compute master key
        var masterKey = kap.masterKeyContrib.xorKey(Amk);
        kap.masterKey = masterKey;
        kap._deriveFriendshipKeys();
        
        var msg4 = kap._genKAP4();

        // Friendship object created here.
        // Friendship created here.
        var friend = new Friendship({
            self: kap.self,
            other: kap.other,
            initiated: kap.initiated,
            masterKey: kap.masterKey,
            aId: kap.aId,
            bId: kap.bId,
            fEnc: kap.fEnc,
            fMac: kap.fMac
        });

        that._storeFriendship(friend).then(function (friendship) {
            console.log("KAP (msg3) completed with " + kap.other + ":", friendship);
            kap.friendship.resolve(friendship);
            that.onmessage(msg4);
        });

        delete that.kaps[that._friendKey(from)];
    },

    _recvKAP4: function (msg) {
        "use strict";

        var that = this;
        var from = msg.hdr.from;

        var fk = this._friendKey(from);
        var kap = this.kaps[fk];
        if (!kap) {
            throw new Fail(Fail.KAPERROR, "no friendship request for", from);
        }

        function failKAP(kap, err) {
            kap.friendship.reject(err);
            throw err;
        }

        console.log("received kap4 in state:", kap.state, kap);

        if (msg.hdr.AFID !== kap.aId) {
            console.error("msg AFID:", msg.hdr.AFID, "kap.aId:", kap.aId);
            failKAP(kap, new Fail(Fail.KAPERROR, "different AFID expected"));
        }

        if (msg.hdr.BFID !== kap.bId) {
            console.error("msg BFID:", msg.hdr.BFID, "kap.bId:", kap.bId);
            failKAP(kap, new Fail(Fail.KAPERROR, "different BFID expected"));
        }

        if (!KAP._verifyHMAC(msg, kap.fMac)) {
            failKAP(kap, new Fail(Fail.KAPERROR, "bad hmac"));
        }

        // Friendship created here.
        var friend = new Friendship({
            self: kap.self,
            other: kap.other,
            initiated: kap.initiated,
            masterKey: kap.masterKey,
            aId: kap.aId,
            bId: kap.bId,
            fEnc: kap.fEnc,
            fMac: kap.fMac
        });

        that._storeFriendship(friend).then(function (friendship) {
            console.log("KAP completed with " + kap.other + ":", friendship);
            kap.friendship.resolve(friendship);
        });

        delete that.kaps[that._friendKey(from)];
    },

    // Moves the protocol one step forward.
    //
    // check the completion status to determine if the friendship
    // channel is open after this resolves.
    receive: function (msg) {
        "use strict";

        if (!msg || !msg.type || !msg.hdr) {
            throw new Fail(Fail.BADPARAM, "missing hdr");
        }

        var hdr = msg.hdr;
        if (!hdr.from || !hdr.to) {
            throw new Fail(Fail.BADPARAM, "missing from/to");
        }

        if (msg.hdr.to !== this.username) {
            throw new Fail(Fail.BADPARAM, "bad To:");
        }

        switch (msg.type) {
        case KAP.KAP_MSG1:
            this._recvKAP1(msg);
            break;
        case KAP.KAP_MSG2:
            this._recvKAP2(msg);
            break;
        case KAP.KAP_MSG3:
            this._recvKAP3(msg);
            break;
        case KAP.KAP_MSG4:
            this._recvKAP4(msg);
            break;
        default:
            throw new Fail(Fail.BADTYPE, "invalid message type");
        }
    }
};

function CryptoCtx(port) {
    "use strict";

    this.serial = cryptoCtxSerial;
    cryptoCtxSerial += 1;
    CryptoCtx.all[this.serial] = this;

    this._keyring = null;
    this.app = getHost(port.sender.tab.url);
    this.port = port;
    this.tabId = port.sender.tab.id;
    this.kr = null;
    this.isMaimed = false;
    this.kapEngine = null;
    this.extCallId = -1;
    this.promptId = 0;

    // content script pending call structures
    this._csCalls = {};
}

CryptoCtx.all = {};

CryptoCtx.globalKeyName = function (keyid, typ) {
    "use strict";
    typ = ((typ === undefined || typ === null) ? "k" : typ);
    return "$global-" + typ + "." + btoa(keyid);
};

CryptoCtx.userKeyName = function (username, keyid, typ) {
    "use strict";
    typ = ((typ === undefined || typ === null) ? "k" : typ);
    return "user." + btoa(username) + "-" + typ + "." + btoa(keyid);
};


// return an array of contexts for which the given
// function returns true.
// fn :=  function (ctx) -> bool;
//
CryptoCtx.filter = function (fn) {
    "use strict";

    var serial;
    var ctx;

    fn = fn || function () {};
    var matching = [];

    for (serial in CryptoCtx.all) {
        if (CryptoCtx.all.hasOwnProperty(serial)) {
            ctx = CryptoCtx.all[serial];
            if (fn(ctx)) {
                matching.push(ctx);
            }
        }
    }
    return matching;
};

CryptoCtx.notifyAll = function (rpc, params) {
    "use strict";

    var serial, ctx;
    for (serial in CryptoCtx.all) {
        if (CryptoCtx.all.hasOwnProperty(serial)) {
            ctx = CryptoCtx.all[serial];
            ctx.callCS(rpc, params);
        }
    }
};

CryptoCtx.prototype = {
    close: function () {
        "use strict";
        this.port = null;
        this.tabId = -1;
        if (this.kapEngine) {
            this.kapEngine.onmessage = null;
            this.kapEngine = null;
        }

        this.isMaimed = true;
        UI.closeCtx(this);

        var callid;
        var pending;
        for (callid in this._csCalls) {
            if (this._csCalls.hasOwnProperty(callid)) {
                pending = this._csCalls[callid];
                delete this._csCalls[callid];
                if (pending.errorcb) {
                    pending.errorcb(new Fail(Fail.MAIMED, "cancelled due to context closing."));
                }
            }
        }

        delete CryptoCtx.all[this.serial];
        
        KeyCache.cleanup();

        return Promise.resolve();
    },

    maim: function () {
        "use strict";
        this.isMaimed = true;
        return Promise.resolve();
    },

    /**
       Invoke a function in the content script.
       
       rpcName: string
       params: rpc-specific parameters

       Promises the response value from the RPC, or rejects
       with a Fail object.
    */
    callCS: function (rpcName, params) {
        "use strict";
        bgCallSerial += 1;
        var callSerial = bgCallSerial;

        var that = this;
        return new Promise(function (resolve, reject) {
            if (that.isMaimed) {
                return reject(new Fail(Fail.MAIMED, "ctx is maimed already."));
            }

            that._csCalls[callSerial] = {
                bgcallid: callSerial,
                cb: resolve,
                errorcb: reject
            };

            that.port.postMessage({cmd: rpcName, callid: null, params: params, bgcallid: callSerial});
        });
    },

    _setKeyring: function (keyringObj) {
        "use strict";
        
        var that = this;
        var account = Vault.getAccount(keyringObj.username);
        console.log("Keyring", keyringObj.name, "open.", keyringObj);
        if (!account) {
            // FIXME: existence check insufficient. should verify key hasn't changed.
            console.error("Identity " + keyringObj.username + "is no longer configured.");
            throw new Fail(Fail.NOIDENT, "identity for this keyring no longer configured");
        }
        that.kr = keyringObj;
        that.kapEngine = new KAPEngine(keyringObj.username, account);
        that.kapEngine.onmessage = that._onExtMessage.bind(that);
    },

    newKeyring: function (keyringName) {
        "use strict";
        var that = this;

        return new Promise(function (resolve, reject) {
            // TODO check storage for non existence of keyring
            if (!keyringName) {
                return reject(new Fail(Fail.NOKEYRING));
            }

            if (that.kr) {
                return reject(new Fail(Fail.OPENKEYRING));
            }

            var canon = that.getStorageName(keyringName, "kr");
            API.getStorageVal(canon).then(function (/*obj*/) {
                reject(new Fail(Fail.EXISTS));
            }, function (err) {
                if (err.code === Fail.NOKEY) {
                    var username = Vault.getUsername();
                    if (!username) {
                        reject(new Fail(Fail.NOIDENT, "No identities configured."));
                        return;
                    }

                    var keyring = {name: keyringName, username: username, app: that.app};
                    API.setStorageVal(canon, keyring).then(function () {
                        // XXX: possible race here where two tabs on the same domain
                        // create the same keyring at the same time
                        that._setKeyring(keyring);
                        resolve();
                    }).catch(function (err) {
                        reject(err);
                    });
                } else {
                    reject(err);
                }
            });
        });
    },

    openKeyring: function (keyringName) {
        "use strict";

        var that = this;
        return new Promise(function (resolve, reject) {
            // TODO check storage for existence of keyring
            if (!keyringName) {
                return reject(new Fail(Fail.NOKEYRING));
            }

            if (that.kr) {
                if (that.kr.name === keyringName) {
                    return resolve(true); // same one open
                }
                return reject(new Fail(Fail.OPENKEYRING));
            }

            var canon = that.getStorageName(keyringName, "kr");
            API.getStorageVal(canon).then(function (kr) {
                that._setKeyring(kr);
                resolve(true);
            }).catch(function (err) {
                if (err.code === Fail.NOKEY) {
                    reject(new Fail(Fail.NOKEYRING));
                } else {
                    reject(err);
                }
            });
        });
    },

    /*
      promises an unused keyid

      keyid is signed with this user's private signing key
      
           keyid := <prefix> : <b64user> : <randompart> : <signature>

        signature over message:

           <prefix> : <b64user> : <randompart> : [<extra>]
    */
    genKeyid: function (extra, prefix) {
        "use strict";
        var that = this;
        extra = extra || "";
        prefix = prefix || "";

        return new Promise(function (resolve, reject) {
            if (that.kr === null) {
                return reject(new Fail(Fail.NOKEYRING, "Keyring not open."));
            }
            var account = Vault.getAccount(that.kr.username);
            var randomHex = Utils.randomStr128();
            var encodedUser = encodeURIComponent(that.kr.username);
            var encodedPrefix = encodeURIComponent(prefix);
            var message = encodedPrefix + ":" + encodedUser + ":" + randomHex + ":" + extra;
            var signature = account.signText(message);
            resolve( encodedPrefix + ":" + encodedUser + ":" + randomHex + ":" + signature);
        });
    },

    verifyKeyid: function (keyid, extra) {
        "use strict";

        var that = this;
        extra = extra || "";

        return new Promise(function (resolve, reject) {
            if (that.kr === null) {
                return reject(new Fail(Fail.NOKEYRING, "Keyring not open."));
            }
            var toks = keyid.split(/:/);
            if (toks.length !== 4) {
                return reject(new Fail(Fail.INVALIDKEY, "wrong format"));
            }
            var keyUser = decodeURIComponent(toks[1]);
            var encodedPrefix = toks[0];
            var encodedUser = toks[1];
            var hexBits = toks[2];
            var signature = toks[3];
            var message = encodedPrefix + ":" + encodedUser + ":" + hexBits + ":" + extra;

            API.fetchPublic(keyUser).then(function (pubKey) {
                try {
                    pubKey.verifySignature(message, signature);
                } catch (err) {
                    return reject(new Fail(Fail.INVALIDKEY, "bad signature"));
                }
                resolve({keyid: keyid, creator: keyUser, pubkey: pubKey});
            }).catch(function (err) {
                reject(err);
            });
        });
    },

    // Promises a handle if you are friends with this user, otherwise
    // null
    isFriend: function (username) {
        "use strict";

        if (this.kr === null) {
            return Promise.reject(new Fail(Fail.NOKEYRING, "Keyring not open."));
        }

        var selfUser = this.kr.username;

        function _friendFinder(obj) {
            return (obj.self === selfUser && obj.other === username);
        }

        return API.filterFriendships(_friendFinder).then(function (matching) {
            var keys = Utils.sortedKeys(matching);
            var keyid = null;

            if (keys.length === 0) {
                return null;
            } else {
                keyid = matching[keys[0]].getKeyid();
                // not cached yet.
                return {keyid: keyid};
            }
        });
    },
    
    // Debugging function to clear out any existing friendship with
    // the given user.
    //
    // @username: Any friendship object involving username will be deleted.
    //
    clearFriendships: function (username) {
        "use strict";
        
        return API.clearFriendships(username);
    },

    // Promise a pubkey keyhandle for a (possibly new) friend `username`
    // This might trigger the KAP.
    getFriend: function (username) {
        "use strict";
        var that = this;

        if (that.kr === null) {
            return Promise.reject(new Fail(Fail.NOKEYRING, "Keyring not open."));
        }

        console.debug("[friend] user=" + this.kr.username + " getFriend(" + username + ")");

        var selfUser = that.kr.username;

        function _friendFinder(obj) {
            return (obj.self === selfUser && obj.other === username);
        }

        return API.filterFriendships(_friendFinder).then(function (matching) {
            var keys = Utils.sortedKeys(matching);
            var keyid = null;

            if (keys.length === 0) {
                return getPublicKey().catch(function (err) {
                    console.error("Failed to initiate KAP", err);
                    throw err;
                });
            } else {
                keyid = matching[keys[0]].getKeyid();
                // not cached yet.
                return {keyid: keyid};
            }
        });

        function getPublicKey() {
            console.log("[friend] user=" + that.kr.username + " identity " + username + " unknown. fetching online.");
            return API.fetchPublic(username).then(function (pubKey) {
                return gotIdent(pubKey);
            }).catch(function (err) {
                console.error("ctx.getFriend error:", err);
                throw err;
            });
        }

        // Promises a Friendship keyhandle
        function gotIdent(pubKey) {
            return that.kapEngine.requestFriendship(username, pubKey).then(function (friendship) {
                return that.storeKey(username, friendship, "fr"); // resolves to a keyhandle
            }).catch(function (err) {
                console.error("requestFriendship error", err);
                throw err;
            });
        }
    },

    // promises a streamid
    newStream: function () {
        "use strict";

        var keyobj = new AESKey();
        var that = this;

        return that.genKeyid(keyobj.toHex()).then(function (keyid) {
            var owner = that.kr.username;
            keyobj.principals[owner] = true;
            return that.storeKey(keyid, keyobj).then(function (keyhandle) {
                return keyhandle.keyid;
            });
        });
    },

    newAnonStream: function () {
       "use strict";
       //var keyObj = new AnonKey();
       var that = this;

       return that.genKeyid("", "anon").then(function (keyid) {
         return keyid;
       });
    },

    // CryptoCtx.prototype.invite
    // promises an hmac'd invitation
    invite: function (friendHandle, convid) {
        "use strict";

        var that = this;

        console.debug("[invite] user=" + this.kr.username + " friendhandle=" + friendHandle.keyid);
        
        return Promise.all([
            that.loadKey(friendHandle.keyid, Friendship, "fr"),
            that.loadKey(convid, AESKey)
        ]).then(function (loaded) {
            var friendship = loaded[0];
            var convKey = loaded[1];
            var keyHex = Utils.keyidShortHex(convid);
            var inviteMsg = friendship.genInvite(convid, convKey);
            var othersStr = UI.audienceLabel(convKey);
            var prompt = UI.prompt(that, that.promptId++,
                                   "Invite user: @" + friendship.other + " to stream: " +
                                   keyHex + " audience: (" + othersStr + ") ?",
                                   [UI.Prompt.ACCEPT, UI.Prompt.REFUSE]);
            return prompt.getPromise().then(function (triggered) {
                if (triggered !== UI.Prompt.ACCEPT) {
                    throw new Fail(Fail.REFUSED, "Invite prompt not accepted: " + triggered);
                } else {
                    /* Accepted. user has access to the stream */
                    convKey.principals[friendship.other] = true;
                    console.log("Key " + convid + " can be read by: ", convKey.principals);

                    // update store
                    return that.storeKey(convid, convKey).then(function () {
                        return inviteMsg;
                    });
                }
            });
        });
    },

    // promises a convid
    acceptInvite: function (inviteMsg) {
        "use strict";

        var that = this;

        function _getFriendshipId() {
            var idObj = {
                aId: inviteMsg.hdr.AFID,
                bId: inviteMsg.hdr.BFID,
                self: that.kr.username,
                other: inviteMsg.hdr.from
            };
            return Friendship.makeKeyid(idObj);
        }

        /*
          loads friendship object from storage
        */
        function _loadFriendship(friendshipId) {
            return that.loadKey(friendshipId, Friendship, "fr");
        }

        /*
          verifies the invite against the friendship object.
          obtains the convid and key: {convid: string, convkey: AESKey}
        */
        function _verifyInvite(friendship) {
            var convInfo = friendship.verifyInvite(inviteMsg);
            return convInfo;
        }

        /*
          checks keyid params, signatures, against public key of creator.
          
          also enforces that the sender of the invite is the creator of the
          key (policy decision).
        */
        function _verifyKey(convInfo) {
            var newKey = convInfo.convkey;
            var hexKey = newKey.toHex();
            return that.verifyKeyid(convInfo.convid, hexKey).then(function (verif) {
                if (verif.creator !== inviteMsg.hdr.from) {
                    throw new Fail(Fail.INVALIDKEY, "Invite sent by another user than owner.");
                }
                return convInfo;
            });
        }

        /*
          check that if there is already a key in store, it is the same.
          (this would happen if the same invite message was accepted again)
        */
        function _loadIfExisting(convInfo) {
            var newKey = convInfo.convkey;

            return that.loadKey(convInfo.convid, AESKey).then(function () {
                var loadedKey = that.keys[convInfo.convid];
                if (loadedKey.toHex() !== newKey.toHex()) {
                    throw new Fail(Fail.EXISTS, "a different key exists under that name");
                }
                
                // replace
                convInfo.convkey = loadedKey;
                return convInfo;
            }).catch(function (err) {
                // it's a new key
                if (err.code === Fail.NOKEY) {
                    return convInfo;
                } else {
                    throw err;
                }
            });
        }

        /*
           update the principals dict for the new key
         */
        function _updatePrincipals(convInfo) {
            var key = convInfo.convkey;

            // assumes creator of the stream is the person
            // inviting.

            key.principals[inviteMsg.hdr.from] = true;
            console.log("Key " + convInfo.convid + " can be read by: ", key.principals);
            return convInfo;
        }

        function _storeKey(convInfo) {
            // keyid checks out. store it.
            return that.storeKey(convInfo.convid, convInfo.convkey).then(function () {
                return convInfo;
            });
        }

        return new Promise(function (resolve, reject) {
            if (that.kr === null) {
                return reject(new Fail(Fail.NOKEYRING, "Keyring not open."));
            }
            if (inviteMsg.hdr.to !== that.kr.username) {
                return reject(new Fail(Fail.OPENKEYRING, "this is for a different user"));
            }

            _loadFriendship(_getFriendshipId())
                .then(_verifyInvite)
                .then(_verifyKey)
                .then(_loadIfExisting)
                .then(_updatePrincipals)
                .then(_storeKey)
                .then(function (convInfo) { resolve(convInfo.convid); })
                .catch(function (err) {
                    return reject(err);
                });
        });
    },

    /**
     * Returns the unique storage name for a key based on keyid,
     * isolated in the appropriate namespace.
     *
     * Some keys are isolated per-keyring:
     *   typ:  "k", undefined (regular keys - default)
     *
     *         "kr.<base64 namespace>-<typ>.<base64 keyid>"
     *
     * Some keys are isolated per-user:
     *   typ:  "fr"   (friendships)
     *
     *         "user.<base64 username>-<typ>.<base64 keyid>"
     *
     * Some keys are global (per extension):
     *
     *   typ: "@"   (user public keys)
     *   typ: "kr"  (keyring objects)
     *
     *         "$global-<typ>.<base64 keyid>"
     */
    getStorageName: function (keyid, typ) {
        "use strict";

        var that = this;

        typ = ((typ === undefined || typ === null) ? "k" : typ);

        switch (typ) {
        case "@":
        case "kr":
            return CryptoCtx.globalKeyName(keyid, typ);
        case "fr":
            if (!this.kr) {
                throw new Fail(Fail.NOKEYRING, "Keyring not set.");
            }
            return CryptoCtx.userKeyName(that.kr.username, keyid, typ);
        default:
            if (!this.kr) {
                throw new Fail(Fail.NOKEYRING, "Keyring not set.");
            }
            return "kr." + btoa(that.app) + "." + btoa(that.kr.name) + "-" + typ + "." + btoa(keyid);
        }
    },

    /**
     * Retrieve a key object from storage, assuming it is of storage
     * class @klass.  Promise the loaded object.
     *
     * Fails with
     *  - NOKEYRING if the context has not been associated with a keyring yet.
     *  - NOKEY if the key does not exist (or couldn't be loaded from storage)
     *  - BADTYPE if the object retrieved is of the wrong storage class
     */
    loadKey: function (keyid, klass, typ) {
        "use strict";

        var keystring = this.getStorageName(keyid, typ);
        return API.loadKey(keystring, klass).then(function (keyobj) {
            if (keyobj.hasOwnProperty("keyid")) {
                keyobj.keyid = keyid;
            }
            return keyobj;
        });
    },

    /*
      Stores a JSON'able key object, and promises a keyhandle.
     
       @keyid is a unique within the keyring
       @key is an instance of the supported Key storage classes
       @typ is a type indicator used to determine the scope of the key (e.g. "k", "kr", "fr", "@")

       Fails with
       - NOKEYRING if the context has not been associated with a keyring yet.
       - NOKEY if the key couldn't be saved to storage
    */
    storeKey: function (keyid, key, typ) {
        "use strict";
        var that = this;
        var keystring = that.getStorageName(keyid, typ);

        // save the keyid in the key object if the class allows it.
        if (key.hasOwnProperty("keyid")) {
            key.keyid = keyid;
        }
        
        return API.storeKey(keystring, key).then(function () {
            var keyhandle = {keyid: keyid};
            return keyhandle;
        });
    },
    
    /** we are routing a message from the extension to the application */
    _onExtMessage: function (message) {
        "use strict";

        this.extCallId += 1;

        if (!this.port) {
            console.error("no port to send message on.");
            throw new Error("No port!");
        }

        console.debug("[message] from=" + this.kr.username + " app=" + this.app + " outgoing", message);

        this.port.postMessage({callid: null, extcallid: this.extCallId, cmd: "ext_message", msg: message});
    },

    /** the application is routing a message to us */
    onAppMessage: function (message) {
        "use strict";

        var that = this;
        
        if (!this.kr) {
            console.debug("[message] incoming message");
        } else {
            console.debug("[message] incoming for user=" + this.kr.username + " app=" + this.app);
        }

        return new Promise(function (resolve, reject) {
            switch (message.type) {
            case KAP.KAP_MSG1:
            case KAP.KAP_MSG2:
            case KAP.KAP_MSG3:
            case KAP.KAP_MSG4:
                if (that.kr === null) {
                    return reject(new Fail(Fail.NOKEYRING));
                }
                that.kapEngine.receive(message);
                resolve(true);
                break;
            default:
                reject(new Fail(Fail.BADTYPE, "unknown message"));
            }
        });
    },

    postKeys: function (message) {
        "use strict";
        var that = this;       

            var prompt = UI.prompt(that, that.promptId++,
                                   "Beeswax will post public keys to twitter account " + "'@" + message + "'\n Do you wish to continue?",
                                   [UI.Prompt.ACCEPT, UI.Prompt.REFUSE]);
            return prompt.getPromise().then(function (triggered) {
                if (triggered !== UI.Prompt.ACCEPT) {
                    throw new Fail(Fail.REFUSED, "Posting Keys not accepted: " + triggered);
                } else {
                    // Accepted
                    that.openKeyring(message).then(function () {
                      console.log("opened keyring " + message);
                      return API.postKeys(that.kr.username).catch(function (err) {
                        UI.log("error reposting(" + err.code + "): " + err);
                        throw err; // throw again
                      }).then(function () {
                        UI.log("Key for @" + that.kr.username + " posted.");
                      });       
                    })["catch"](function (err) {
                      console.error("failed to open keyring " + message, err);
                      if (err.code === "NOKEYRING") {
                        return that.newKeyring(message).then(function () {
                          console.log("new keyring created");
                          return API.postKeys(that.kr.username).catch(function (err) {
                            UI.log("error reposting(" + err.code + "): " + err);
                            throw err; // throw again
                          }).then(function () {
                            UI.log("Key for @" + that.kr.username + " reposted.");
                          });
                        });
                      } else {
                        throw err;
                        }
                    });
                }
            });
    },

    postTweets: function (tags, keys) {
        "use strict";
        var that = this;   

        if (that.kr === null) {
            return new Fail(Fail.NOKEYRING, "Keyring not open.");
        }


        var prompt = UI.prompt(that, that.promptId++,
           "Beeswax will post your messages to twitter account " + "'@" + that.kr.username + "'\n Do you wish to continue?",
           [UI.Prompt.ACCEPT, UI.Prompt.REFUSE]);
        return prompt.getPromise().then(function (triggered) {
            if (triggered !== UI.Prompt.ACCEPT) {
                throw new Fail(Fail.REFUSED, "Posting Tweets not accepted: " + triggered);
            } else {
                    // Accepted
                    return API.postTweets(that.kr.username, keys).catch(function (err) {
                        UI.log("error posting messages(" + err.code + "): " + err);
                        throw err; // throw again
                    }).then(function (tweetIDs) {
                        var baseString = " https://twitter.com/" + encodeURIcomponent(that.kr.username) + "/status/";
                        UI.log("Tweets for @" + that.kr.username + " posted.");
                        for (var i=0; i<tags.length; i++) tags[i] = tags[i] + baseString + tweetIDs[i];
                        return API.postTweets(that.kr.username, tags).catch(function (err) {
                            UI.log("error replying(" + err.code + "): " + err);
                        }).then(function () {
                            UI.log("Replies for @" + that.kr.username + " posted.");
                        });
                    });       
                }
        });
    },

    getTwitterStream: function () {
        "use strict";
        var that = this;   

        if (that.kr === null) {
            return new Fail(Fail.NOKEYRING, "Keyring not open.");
        }


        var prompt = UI.prompt(that, that.promptId++,
           "Beeswax will stream twitter account " + "'@" + that.kr.username + "'\n Do you wish to continue?",
           [UI.Prompt.ACCEPT, UI.Prompt.REFUSE]);
        return prompt.getPromise().then(function (triggered) {
            if (triggered !== UI.Prompt.ACCEPT) {
                throw new Fail(Fail.REFUSED, "Streaming not accepted: " + triggered);
            } else {
                    // Accepted
                    return API.getTwitterStream(that.kr.username).catch(function (err) {
                        UI.log("error streaming(" + err.code + "): " + err);
                        throw err; // throw again
                    }).then(function () {
                        UI.log("Stream for @" + that.kr.username + " acquired.");
                    });       
                }
        });
    },

    encryptMessage: function (principals, plaintext) {
        "use strict";
        var that = this;
        //TODO: ENCRYPT WITH PUBLIC KEY OF EACH USER IN KEYOBJ
      
        var result = [];

        for (var i=0; i<principals.length; i++){
          var ident = Vault.getAccount(principals[i]);
          if (!ident) {
            return Promise.reject(new Error("account name does not exist: " + principals[i]));
          }
          var pubKey = ident.toPubKey();
          var ct = pubKey.encryptMessage(plaintext);
          result.push(ct);
          return result;
        }
    },

    decryptMessage: function (ct) {
        "use strict";

        var that = this;

        if (that.kr === null) {
            return new Fail(Fail.NOKEYRING, "Keyring not open.");
        }
        var ident = Vault.getAccount(that.kr.username);

        return Promise.resolve(ident.decryptMessage(ct));

    }
};

function PeriodicTask(periodMs) {
    "use strict";

    this.periodMs = periodMs;
    this.timer = -1;
    this.stopped = true;
    this.lastRun = null;
    this.nextRun = null;
    this.status = "stopped";
}

PeriodicTask.prototype.stop = function () {
    "use strict";
    
    if (this.timer > -1) {
        window.clearInterval(this.timer);
    }

    this.stopped = true;
    this.timer = -1;
    this.nextRun = null;
    this.status = "stopped";
};

PeriodicTask.prototype._run = function () {
    "use strict";

    var that = this;
    return new Promise(function (resolve) {
        resolve(that.run());
    });
};

PeriodicTask.prototype.run = function () {
    "use strict";
    throw new Fail(Fail.GENERIC, "run() must be implemented by subclasses");
};

PeriodicTask.prototype.start = function () {
    "use strict";

    var that = this;

    this.stopped = false;

    if (this.timer > -1) {
        // already scheduled;
        return;
    }

    function _fire() {
        that.timer = -1;
        if (!that.stopped) {
            that.start();
        }
    }

    function _reschedule() {
        that.lastRun = new Date();
        that.nextRun = new Date(that.lastRun.getTime() + that.periodMs);
        that.timer = window.setTimeout(_fire, that.periodMs);
    }

    this.status = "running";

    this._run().then(function () {
        that.status = "completed";
        _reschedule();
    }).catch(function (err) {
        console.error("Periodic task failed:", err);
        that.status = "error";
        _reschedule();
    });
};


function DistributeTask(periodMs, username) {
    "use strict";
    DistributeTask.__super__.constructor.call(this, periodMs);
    this.username = username;
}

_extends(DistributeTask, PeriodicTask, {
    run: function () {
        "use strict";
        var that = this;

        //
        // Fetch your own key.
        //  if no key is found: post your key.
        //  if the key is about to go stale or is stale: re-post
        //  if a different key is found: raise an alarm
        //

        var checkTime = Date.now();
        var ident = Vault.getAccount(that.username);

        if (!ident) {
            throw new Fail(Fail.NOIDENT, "No identity attached with username", that.username);
        }

        function _repostKey() {
            return API.postKeys(that.username).catch(function (err) {
                UI.log("error reposting(" + err.code + "): " + err);
                throw err; // throw again
            }).then(function () {
                UI.log("Key for @" + that.username + " reposted.");
            });
        }

        return API.fetchTwitter(that.username).then(function (twitterKeyContainer) {
            var twitterKey = twitterKeyContainer.key;
            var myKey = ident.toPubKey();
            var keyAgeMs = checkTime - twitterKeyContainer.ts;

            if (!twitterKey.equalTo(myKey)) {
                console.error("Key of @" + that.username + " was found to be different on twitter.");
                UI.raiseWarning(null, "Your own key (@" + that.username + ") is different on twitter.");
                throw new Fail(Fail.INVALIDKEY, "Key of @" + that.username, " was found to be different on twitter.");
            }

            if (checkTime > twitterKeyContainer.expiration) {
                UI.log("Key for @" + that.username + " has expired. Reposting.");
                return _repostKey();
            }

            if (keyAgeMs > BGAPI.MAX_KEY_POST_AGE_MS) {
                UI.log("Key for @" + that.username + " has aged. Reposting.");
                return _repostKey();
            }

            // all good. key up to date.

        }).catch(function (err) {
            if (err.code === Fail.NOIDENT) {
                UI.log("No keys found on own user profile @" + that.username + ". Posting.");
                return _repostKey();
            } else {
                throw err;
            }
        });
    }
});

function ValidateTask(periodMs, username) {
    "use strict";
    ValidateTask.__super__.constructor.call(this, periodMs);
    this.username = username;
}

_extends(ValidateTask, PeriodicTask, {
    run: function () {
        "use strict";
        API.refreshAllFriends().then(function (count) {
            UI.log("Refreshed " + count + " user key(s).");
        });
    }
});

function BGAPI() {
    "use strict";
    this.validateTasks = {};
    this.distributeTasks = {};

    window.setTimeout(function () {
        var initialUser = Vault.getUsername();
        API.accountChanged(initialUser);
    }, 0);
}

BGAPI.PERIOD_DISTRIBUTE_MS =          10 * 60 * 1000;  // run the distribute task every X ms
BGAPI.PERIOD_VALIDATE_MS   =          30 * 60 * 1000;  // run the validate task every X ms
BGAPI.MAX_KEY_POST_AGE_MS  = 3 * 24 * 60 * 60 * 1000;  // re-post a key after this amount of time.

BGAPI.prototype._stopBackgroundTasks = function () {
    "use strict";

    var user;
    for (user in this.validateTasks) {
        if (this.validateTasks.hasOwnProperty(user)) {
            this.validateTasks[user].stop();
        }
    }

    for (user in this.distributeTasks) {
        if (this.distributeTasks.hasOwnProperty(user)) {
            this.distributeTasks[user].stop();
        }
    }
};

BGAPI.prototype.accountChanged = function (username) {
    "use strict";

    this._stopBackgroundTasks();

    if (!username) {
        return;
    }

    if (!this.validateTasks[username]) {
        this.validateTasks[username] = new ValidateTask(BGAPI.PERIOD_VALIDATE_MS, username);
    }
    this.validateTasks[username].start();

    if (!this.distributeTasks[username]) {
        this.distributeTasks[username] = new DistributeTask(BGAPI.PERIOD_DISTRIBUTE_MS, username);
    }
    this.distributeTasks[username].start();
};

// Returns a promise that resolves to true if keys for the given
// account name can be posted.
BGAPI.prototype.postKeys = function (username) {
    "use strict";

    console.debug("[BGAPI] postKeys:", username);
    
    var ident = Vault.getAccount(username);
    var ts = Date.now();

    if (!ident) {
        console.error("postKeys for", username, ": nonexistent account");
        return Promise.reject(new Error("account name does not exist: " + username));
    }

    return new Promise(function (resolve, reject) {

        // find the auth token and the twitter userid;
        // promises:
        //   { token: <tok>,
        //     twitterId: <id>,
        //     twitterUser: <username>,
        //   }

        // fetch the user's twitter homepage
        var preq = new XMLHttpRequest();
        preq.open("GET", "https://twitter.com", true);
        preq.onerror = function () {
            console.error("Problem loading twitter homepage", [].slice.apply(arguments));
            reject(new Error("error loading twitter homepage"));
        };

        preq.onload = function () {
            // parse the response
            var parser = new DOMParser();
            var xmlDoc = parser.parseFromString(preq.responseText, "text/html");

            var tokens = xmlDoc.getElementsByName("authenticity_token");
            if (tokens.length < 1) {
                return reject(new Fail(Fail.GENERIC, "Could not find auth token"));
            }

            // the value of the token is always the same so just look at the first
            // this may be null
            var token = tokens[0].getAttribute("value");

            var currentUsers = xmlDoc.getElementsByClassName("current-user");
            if (currentUsers === null || currentUsers.length !== 1) {
                return reject(new Fail(Fail.GENERIC, "failed to find current-user element for userid and username. Make sure you are logged in to twitter (in any tab)."));
            }

            var accountGroups = currentUsers[0].getElementsByClassName("account-group");
            if (accountGroups === null || accountGroups.length !== 1) {
                console.error("account-group userid fetch failed due to changed format.");
                return reject(new Fail(Fail.GENERIC, "account-group userid fetch failed due to changed format."));
            }

            var accountElement = accountGroups[0];
            var twitterId = accountElement.getAttribute("data-user-id");
            var twitterUser = accountElement.getAttribute("data-screen-name");

            if (twitterId === null || twitterUser === null) {
                return reject(new Fail(Fail.GENERIC, "failed to extract ID or username."));
            }

            if (twitterUser !== username) {
                return reject(new Fail(Fail.PUBSUB,
                                       "Twitter authenticated under a different username. Found '" +
                                       twitterUser + "' but expected  '" + username + "'."));
            }

            resolve(
                {token: token,
                 twitterId: twitterId,
                 twitterUser: twitterUser
                });
        };
        //send the profile request
        preq.send();
    }).then(function (twitterInfo) {
        var token = twitterInfo.token;
        var twitterUser = twitterInfo.twitterUser;
        var twitterId = twitterInfo.twitterId;

        var pubKey = ident.toPubKey();
        var min = pubKey.minify();
        var encryptKey = min.encrypt;
        var signKey = min.sign;
        var encryptStatus = "#encryptkey " + ts + " " + encryptKey;
        var signStatus = "#signkey " + ts + " " + signKey;

        // Generate signature tweet
        // Expiration is 30 days
        var expiration = ts + (60 * 60 * 24 * 30) * 1000;

        var sigText = twitterUser + twitterId + encryptKey + signKey + ts + expiration;
        var signature = ident.signText(sigText);

        var sigStatus = "#keysig " + ts + " " + expiration + " " + signature;

        return {tweets: [encryptStatus, signStatus, sigStatus], token: token};

    }).then(function (tweetInfo) {

        function isTwitterCtx(ctx) {
            return (!ctx.isMaimed && ctx.app === "twitter.com");
        }

        var twitterCtx = CryptoCtx.filter(isTwitterCtx);
        var authToken = tweetInfo.token;
        var tweets = tweetInfo.tweets;
        var ti;
        var promisesPromises = [];

        if (twitterCtx.length <= 0) {
            throw new Fail(Fail.PUBSUB, "Twitter context not available, must have twitter tab open.");
        }

        
        for (ti = 0; ti < tweets.length; ti++) {
            promisesPromises.push(twitterCtx[0].callCS("post_public", {tweet: tweets[ti], authToken: authToken}));
        }

        return Promise.all(promisesPromises).then(function () {
            // All tweets pushed.
            return true;
        });
    });
};

BGAPI.prototype.postTweets = function (username, messages) {
    "use strict";

    console.debug("[BGAPI] postTweets:", username);
    
    var ident = Vault.getAccount(username);
    var ts = Date.now();

    if (!ident) {
        console.error("postTweets for", username, ": nonexistent account");
        return Promise.reject(new Error("account name does not exist: " + username));
    }

    return new Promise(function (resolve, reject) {

        // find the auth token and the twitter userid;
        // promises:
        //   { token: <tok>,
        //     twitterId: <id>,
        //     twitterUser: <username>,
        //   }

        // fetch the user's twitter homepage
        var preq = new XMLHttpRequest();
        preq.open("GET", "https://twitter.com", true);
        preq.onerror = function () {
            console.error("Problem loading twitter homepage", [].slice.apply(arguments));
            reject(new Error("error loading twitter homepage"));
        };

        preq.onload = function () {
            // parse the response
            var parser = new DOMParser();
            var xmlDoc = parser.parseFromString(preq.responseText, "text/html");

            var tokens = xmlDoc.getElementsByName("authenticity_token");
            if (tokens.length < 1) {
                return reject(new Fail(Fail.GENERIC, "Could not find auth token"));
            }

            // the value of the token is always the same so just look at the first
            // this may be null
            var token = tokens[0].getAttribute("value");

            var currentUsers = xmlDoc.getElementsByClassName("current-user");
            if (currentUsers === null || currentUsers.length !== 1) {
                return reject(new Fail(Fail.GENERIC, "failed to find current-user element for userid and username. Make sure you are logged in to twitter (in any tab)."));
            }

            var accountGroups = currentUsers[0].getElementsByClassName("account-group");
            if (accountGroups === null || accountGroups.length !== 1) {
                console.error("account-group userid fetch failed due to changed format.");
                return reject(new Fail(Fail.GENERIC, "account-group userid fetch failed due to changed format."));
            }

            var accountElement = accountGroups[0];
            var twitterId = accountElement.getAttribute("data-user-id");
            var twitterUser = accountElement.getAttribute("data-screen-name");

            if (twitterId === null || twitterUser === null) {
                return reject(new Fail(Fail.GENERIC, "failed to extract ID or username."));
            }

            if (twitterUser !== username) {
                return reject(new Fail(Fail.PUBSUB,
                                       "Twitter authenticated under a different username. Found '" +
                                       twitterUser + "' but expected  '" + username + "'."));
            }

            resolve(
                {token: token,
                 twitterId: twitterId,
                 twitterUser: twitterUser,
                 tweets: messages
                });
        };
        //send the profile request
        preq.send();
    }).then(function (twitterInfo) {
        var token = twitterInfo.token;
        var twitterUser = twitterInfo.twitterUser;
        var twitterId = twitterInfo.twitterId;
        var messages = twitterInfo.tweets;

        var pubKey = ident.toPubKey();
        var min = pubKey.minify();
        var encryptKey = min.encrypt;
        var signKey = min.sign;
        var encryptStatus = "#encryptkey " + ts + " " + encryptKey;
        var signStatus = "#signkey " + ts + " " + signKey;

        

        // Generate signature tweet
        // Expiration is 30 days
        var expiration = ts + (60 * 60 * 24 * 30) * 1000;

        var sigText = twitterUser + twitterId + encryptKey + signKey + ts + expiration;
        var signature = ident.signText(sigText);

        var sigStatus = "#keysig " + ts + " " + expiration + " " + signature;

        return {tweets: messages, token: token};

    }).then(function (tweetInfo) {
     

        function isTwitterCtx(ctx) {
            return (!ctx.isMaimed && ctx.app === "twitter.com");
        }

        var twitterCtx = CryptoCtx.filter(isTwitterCtx);
        var authToken = tweetInfo.token;
        var tweets = tweetInfo.tweets;
        var ti;
        var promisesPromises = [];

        if (twitterCtx.length <= 0) {
            throw new Fail(Fail.PUBSUB, "Twitter context not available, must have twitter tab open.");
        }


        for (ti = 0; ti < tweets.length; ti++) {
            promisesPromises.push(twitterCtx[0].callCS("post_public", {tweet: tweets[ti], authToken: authToken}));

        }

        return Promise.all(promisesPromises).then(values => {
            console.log("promises ", values);
            // All tweets pushed.
            var ret = [];
            for (var i =0; i<values.length; i++) {
                console.log("promise ", JSON.parse(values[i]).tweet_id);
                ret.push(JSON.parse(values[i]).tweet_id);
            }
            return ret;
        });
    });
};

BGAPI.prototype.getTwitterStream = function (username) {
    "use strict";

    console.debug("[BGAPI] getTwitterStream:", username);
    
    var ident = Vault.getAccount(username);
    var ts = Date.now();

    if (!ident) {
        console.error("getTwitterStream", username, ": nonexistent account");
        return Promise.reject(new Error("account name does not exist: " + username));
    }

    return new Promise(function (resolve, reject) {

        // find the auth token and the twitter userid;
        // promises:
        //   { token: <tok>,
        //     twitterId: <id>,
        //     twitterUser: <username>,
        //   }

        // fetch the user's twitter homepage
        var preq = new XMLHttpRequest();
        preq.open("GET", "https://twitter.com", true);
        preq.onerror = function () {
            console.error("Problem loading twitter homepage", [].slice.apply(arguments));
            reject(new Error("error loading twitter homepage"));
        };

        preq.onload = function () {
            // parse the response
            var parser = new DOMParser();
            var xmlDoc = parser.parseFromString(preq.responseText, "text/html");

            var tokens = xmlDoc.getElementsByName("authenticity_token");
            if (tokens.length < 1) {
                return reject(new Fail(Fail.GENERIC, "Could not find auth token"));
            }

            // the value of the token is always the same so just look at the first
            // this may be null
            var token = tokens[0].getAttribute("value");

            var currentUsers = xmlDoc.getElementsByClassName("current-user");
            if (currentUsers === null || currentUsers.length !== 1) {
                return reject(new Fail(Fail.GENERIC, "failed to find current-user element for userid and username. Make sure you are logged in to twitter (in any tab)."));
            }

            var accountGroups = currentUsers[0].getElementsByClassName("account-group");
            if (accountGroups === null || accountGroups.length !== 1) {
                console.error("account-group userid fetch failed due to changed format.");
                return reject(new Fail(Fail.GENERIC, "account-group userid fetch failed due to changed format."));
            }

            var accountElement = accountGroups[0];
            var twitterId = accountElement.getAttribute("data-user-id");
            var twitterUser = accountElement.getAttribute("data-screen-name");

            if (twitterId === null || twitterUser === null) {
                return reject(new Fail(Fail.GENERIC, "failed to extract ID or username."));
            }

            if (twitterUser !== username) {
                return reject(new Fail(Fail.PUBSUB,
                                       "Twitter authenticated under a different username. Found '" +
                                       twitterUser + "' but expected  '" + username + "'."));
            }

            resolve(
                {token: token
                });
        };
        //send the profile request
        preq.send();
    }).then(function (twitterInfo) {
        var token = twitterInfo.token;

        return {token: token};

    }).then(function (tweetInfo) {
        
        function isTwitterCtx(ctx) {
            return (!ctx.isMaimed && ctx.app === "twitter.com");
        }

        var twitterCtx = CryptoCtx.filter(isTwitterCtx);
        var authToken = tweetInfo.token;
        var ti;
        var promisesPromises = [];

        if (twitterCtx.length <= 0) {
            throw new Fail(Fail.PUBSUB, "Twitter context not available, must have twitter tab open.");
        }

        console.log("calling CS");
        promisesPromises.push(twitterCtx[0].callCS("get_stream", {authToken: authToken}));

        return Promise.all(promisesPromises).then(function () {
            // All tweets pushed.
            return true;
        });
    });
};

// Fetches user's latest public key on Twitter
//
// Promises {key: public key, (an ECCPubKey)
//           ts: the publication timestamp (ms since epoch)
//           expiration: expiration timestamp (ms since epoch)}
//
// Fails with NOIDENT if keys can't be found (expired or not)
// Fails with GENERIC if any other problem arises
//
// FIXME check that timestamp in the tweet is close-ish to
//       timestamp of the posted date.
BGAPI.prototype.fetchTwitter = function (username) {
    "use strict";

    var sign = {};
    var encrypt = {};
    var signature = {};
    var expiration = {};
    var timestamp = null;
    var twitterId = null;

    //function that will look for a given tag, and call a function effect if it finds it, returns true/false
    function findtag(tag, element) {
        //look through each hashtag for the given element
        var hashtags = element.getElementsByClassName("twitter-hashtag");
        for (var i = 0; i < hashtags.length; i++)  {
            //if it matches the one we're looking for, do the side effect with the element
            if (hashtags[i].innerText === tag) {
                return true;
            }
        }
        return false;
    }

    //look through the tweets in xmldoc for tags
    function looktweet(xmlDoc) {
        //run through tweets looking for the right hashtag
        var tweets = xmlDoc.getElementsByClassName("js-tweet-text");
        var toks;

        // TODO(rjsumi): use something other than element.closest so we don't require Chrome >= 41.
        for (var i = 0; i < tweets.length; i++) {

            var tweet = tweets[i];
            var content = tweet.closest(".content");
            if (!content) {
                console.debug("No .content element. in tweet. skipping.", tweet);
                continue;
            }

            var profileLinks = content.getElementsByClassName("js-user-profile-link");
            if (profileLinks.length < 1) {
                continue;
            }

            //<span class="_timestamp js-short-timestamp " data-aria-label-part="last" data-time="1448867714" data-time-ms="1448867714000" data-long-form="true">29 Nov 2015</span>
            var timeContainer = content.getElementsByClassName("js-short-timestamp");
            if (timeContainer.length < 1) {
                // no timestamp
                continue;
            }
            var postTime = Number(timeContainer[0].getAttribute("data-time-ms"));
            console.log("Tweet post time:", postTime);

            var id = profileLinks[0].getAttribute("data-user-id");
            // The format of a tweeted key triple is:
            // #encryptkey <timestamp> <encryption key>
            // #signkey <timestamp> <signing key>
            // #keysig <timestamp> <expiration> <signature(username, twitterid, enckey, signkey, ts, expiration)>
            //look through each tweet for the hashtag for signing
            if (findtag("#signkey", tweet)) {
                toks = tweet.innerText.split(/\s+/);
                if (toks.length === 3 && sign[toks[1]] === undefined && Number(toks[1])) {
                    sign[toks[1]] = {tweet: toks[2], twitterid: id};
                } else {
                    console.warn("#signkey tweet for user", username, "is malformed:", tweet);
                    continue; // try next tweet
                }
            }

            //look through each tweet for the hashtag for encrypting
            if (findtag("#encryptkey", tweet)) {
                toks = tweet.innerText.split(/\s+/);
                if (toks.length === 3 && encrypt[toks[1]] === undefined && Number(toks[1])) {
                    encrypt[toks[1]] = {tweet: toks[2], twitterid: id};
                } else {
                    console.warn("#encryptkey tweet for user", username, "is malformed:", tweet);
                    continue; // try next tweet
                }
            }

            //look through each tweet for the hashtag for encrypting
            if (findtag("#keysig", tweet)) {
                toks = tweet.innerText.split(/\s+/);
                if (toks.length === 4 && signature[toks[1]] === undefined && Number(toks[1]) && Number(toks[2])) {
                    expiration[toks[1]] = {tweet: toks[2], twitterid: id};
                    signature[toks[1]] = {tweet: toks[3], twitterid: id};
                } else {
                    console.warn("#keysig tweet for user", username, "is malformed:", tweet);
                    continue; // try next tweet
                }
            }
        }

        var timestamps = [];
        // Determine timestamps for which we have entire triples.
        for (var ts in signature) {
            if (sign[ts] && encrypt[ts] && sign[ts].twitterid === signature[ts].twitterid && encrypt[ts].twitterid === signature[ts].twitterid) {
                timestamps.push(ts);
            }
        }
        timestamps.sort(function (a, b) {
            // We want a descending order so negative should be returned when the second is larger.
            return Number(b) - Number(a);
        });

        // If we find no timestamps, that is a problem.
        if (timestamps.length === 0) {
            // TODO(rjsumi): error reporting
            sign = null;
            encrypt = null;
            signature = null;
            expiration = null;
            return;
        }

        // Check for the newest one i.e. the highest timestamp.
        timestamp = timestamps[0];

        sign = sign[timestamp].tweet;
        encrypt = encrypt[timestamp].tweet;
        twitterId = signature[timestamp].twitterid;
        signature = signature[timestamp].tweet;
        expiration = expiration[timestamp].tweet;
    }

    return new Promise(function (resolve, reject) {

        // return ECCPubKey
        function parseKey() {
            //we found both keys, persist them
            var minified = {
                encrypt: encrypt,
                sign: sign
            };
            var key = ECCPubKey.unminify(minified);
            
            var signedMessage = username + twitterId + encrypt + sign + timestamp + expiration;
            if (!key.verifySignature(signedMessage, signature)) {
                console.error("Failed to verify signature: ", sign, encrypt, signature);
                throw new Fail(Fail.GENERIC, "verification failed");
            }
            return key;
        }

        // fetch the corresponding username's tweets
        // get the signing key and the encrypting key
        var preq = new XMLHttpRequest();
        preq.open("GET", "https://twitter.com/" + encodeURIComponent(username), true);
        preq.onerror = function () {
            console.error("Prolem loading tweets", [].slice.apply(arguments));
            reject(new Fail(Fail.GENERIC, "Ajax failed."));
        };
        preq.onload = function () {
            //parse the response
            var parser = new DOMParser();
            var xmlDoc = parser.parseFromString(preq.responseText, "text/html");
            var loadedkey;

            //look through the response to find keys
            looktweet(xmlDoc);

            if (sign !== null && encrypt !== null && signature !== null) {
                try {
                    loadedkey = parseKey(); // captures sign, encrypt, timestamp, expiration, etc.
                } catch (err) {
                    console.error("Failed to parse key: ", sign, encrypt, signature, err);
                    reject(new Fail(Fail.NOIDENT, "Could not parse keys found."));
                    return;
                }
                resolve({key: loadedkey,
                         ts: Number(timestamp),
                         expiration: Number(expiration)});
            } else {
                //we failed, do another pass on the search page
                var sreq = new XMLHttpRequest();
                sreq.open("GET", "https://twitter.com/search?q=%23signkey%20OR%20%23encryptkey%20OR%20%23signature%20from%3A" + username, true);
                sreq.onerror = function () {
                    console.error("Prolem loading tweets (search)", [].slice.apply(arguments));
                    reject(new Fail(Fail.GENERIC, "Ajax failed."));
                };

                sreq.onload = function () {
                    //parse the response to find the key
                    var parser = new DOMParser();
                    var xmlDoc = parser.parseFromString(sreq.responseText, "text/html");
                    looktweet(xmlDoc);
                    if (sign !== null && encrypt !== null && signature !== null) {
                        try {
                            resolve({key: parseKey(),
                                     ts: Number(timestamp),
                                     expiration: Number(expiration)});  // captures sign, encrypt, timestamp, expiration, etc.
                        } catch (err) {
                            console.error("Failed to parse key: ", sign, encrypt, signature, err);
                            reject(new Fail(Fail.NOIDENT, "Could not parse keys found."));
                            return;
                        }
                    } else {
                        console.error("failed to find both keys and signature for @" + username, sign, encrypt, signature);
                        reject(new Fail(Fail.NOIDENT, "Could not find key in tweets."));
                        return;
                    }
                };
                //send the search request
                sreq.send();
            }
        };
        //send the profile request
        preq.send();
    });
};

/*
  promises true or false depending on if the latest key in your twitter feed is your own.
*/
BGAPI.prototype.checkTwitter = function (username) {
    "use strict";

    console.log("[API] fetching key for user:", username);

    var checkTime = Date.now();

    return this.fetchTwitter(username).then(function (twitterKeyContainer) {
        var twitterKey = twitterKeyContainer.key;
        var stale = twitterKeyContainer.expiration < checkTime;
        var ident = Vault.getAccount(username);

        if (!ident) {
            throw new Fail(Fail.NOIDENT, "No identity attached with username", username);
        }

        var myKey = ident.toPubKey();

        if (stale) {
            // Report the error, but don't avoid the check.
            console.error(Vault.getUsername(), " own key was found to be stale");
            UI.raiseWarning(null, " your own key (@" + Vault.getUsername() + ") is different on twitter.");
        }

        return twitterKey.equalTo(myKey);
    });
};

BGAPI.prototype.refreshAllFriends = function () {
    "use strict";

    return API.filterFriendships(function () { return true; })
        .then(_loadUsernames)
        .then(_fetchKeys)
        .then(API._invalidate);

    function _loadUsernames(friendships) {
        // Determine the set of usernames to check.
        var usernames = {};

        var k, fr;
        for (k in friendships) {
            if (friendships.hasOwnProperty(k)) {
                fr = friendships[k];
                if (fr.self !== Vault.getUsername()) {
                    usernames[fr.self] = false;
                }
                if (fr.other !== Vault.getUsername()) {
                    usernames[fr.other] = false;
                }
            }
        }
        return usernames;
    }

    function _fetchKeys(usernames) {
        var updates = [];
        function _mkSetter(username) {
            return function (keyStatus) {
                usernames[username] = keyStatus;
            };
        }

        // Determine which usernames are fresh and possibly regenerate keys.
        for (var username in usernames) {
            if (usernames.hasOwnProperty(username)) {
                updates.push(_compareKeys(username).then(_mkSetter(username)));
            }
        }

        return Promise.all(updates).then(function () {
            return usernames;
        });
    }

    // Compares local and online keys for one user.
    //
    // Promises:
    //   true      -- twitter key and local key match
    //   false     -- twitter key is expired
    //   a pubkey  -- local and twitter mismatch. the key from twitter
    //
    function _compareKeys(username) {

        var checkTime = Date.now();
        var keyid = username;
        var storageName = CryptoCtx.globalKeyName(keyid, "@");

        var promises = [];
        promises.push(API.loadKey(storageName, ECCPubKey));
        promises.push(API.fetchTwitter(username));
        return Promise.all(promises).then(function (values) {
            var storeKey = values[0];
            var twitterKeyContainer = values[1];
            var twitterKey = twitterKeyContainer.key;
            var stale = checkTime > twitterKeyContainer.expiration;

            // Handle stale keys.
            if (stale) {
                return false;
            }

            // TODO(rjsumi): check staleness.
            if (storeKey.equalTo(twitterKey)) {
                return true;
            } else {
                return twitterKey;
            }
        });
    }

};

// Invalidates the AES keys and deletes the Friendship objects for the users
// that have fetched fresh keys from twitter, or that have had their keys go stale.
BGAPI.prototype._invalidate = function (usernames) {
    "use strict";

    // each entry in usernames dict is
    // true: the same
    // false: stale pubkey on twitter
    // a key: new key on twitter

    // Find invalid AES keys (usernames is non-true)\
    function matches (keyName, keyVal) {
        if (keyVal.typ != "aes") {
            return false;
        }
        var principals = keyVal.principals;
        for (var p in principals) {
            if (principals.hasOwnProperty(p) && usernames.hasOwnProperty(p) && usernames[p] !== true) {
                return true;
            }
        }
        return false;
    }

    // Mark as invalid AES keys that contain the username as a principal and persist their now-invalid selves.
    API.filterStore(matches).then(function (aesKeys) {
        for (var key in aesKeys) {
            if (aesKeys.hasOwnProperty(key)) {
                var keyVal = AESKey.fromStore(aesKeys[key]);
                var principals = keyVal.principals;
                for (var p in principals) {
                    if (principals.hasOwnProperty(p) && usernames.hasOwnProperty(p) && usernames[p] !== true) {
                        keyVal.invalidate(p);
                        API.storeKey(key, keyVal);
                    }
                }
            }
        }
    });

    // Delete friendships matching fouled usernames.
    for (var u in usernames) {
        if (usernames.hasOwnProperty(u) && usernames[u] !== true) {
            API.clearFriendships(u);
        }
    }

    console.log("KEY STATUSES:", usernames);
    return Object.getOwnPropertyNames(usernames).length;
};

BGAPI.prototype.regenKeys = function () {
    "use strict";

    return new Promise(function (resolve, reject) {
        if (Vault.regenKeys(Vault.getUsername()) !== null) {
            console.log("new set of keys.");
            // Invalidate AES keys and friendships involving ourself.
            // TODO(rjsumi): Better error reporting.
            API._invalidate({[Vault.getUsername()]: Vault.getAccount(Vault.getUsername())});
            resolve();
        } else {
            console.log("could not regen");
            reject();
        }
    });
};

/*
 * Promises a public key from a twitter username -- (an ECCPubKey)
 * the public key retrieved is cached for future lookups.
 *
 */
BGAPI.prototype.fetchPublic = function (username) {
    "use strict";

    var that = this;

    if (!username) {
        throw new Fail(Fail.BADPARAM, "invalid username");
    }

    var storageName = CryptoCtx.globalKeyName(username, "@");
    var fetchTime = Date.now();

    console.log("[API] fetching key for user:", username);

    return this.loadKey(storageName, ECCPubKey).catch(function (err) {
        if (err.code === Fail.NOKEY) {
            return that.fetchTwitter(username).then(function (pubKeyContainer) {
                var pubKey = pubKeyContainer.key;
                var stale = pubKeyContainer.expiration < fetchTime;
                if (stale) {
                    throw new Fail(Fail.STALE, "Found only a stale key for " + username);
                }
                return that.storeKey(storageName, pubKey).then(function () {
                    return pubKey;
                });
            });
        }
        throw err;
    });
};

BGAPI.prototype.removeStorageVal = function (name) {
    "use strict";

    return new Promise(function (resolve, reject) {
        storageArea.remove(name, function () {
            if (chrome.runtime.lastError) {
                reject(new Fail(Fail.GENERIC, "Could not delete key " + name + " from storage"));
            } else {
                resolve();
            }
        });
    });
};


/** promises an object where all keys satisfy a filter function
 *
 *  @fn: function (name, val) -> bool
 *
 *  NOTE: This retrieves the entire contents of storage in the
 *        process.
*/
BGAPI.prototype.filterStore = function (fn) {
    "use strict";

    fn = fn || function () {};
    var matching = {};

    return new Promise(function (resolve, reject) {

        storageArea.get(null, function (objects) {
            var name;

            if (chrome.runtime.lastError) {
                return reject(new Fail(Fail.GENERIC, "Failed to read storage"));
            }

            for (name in objects) {
                if (objects.hasOwnProperty(name)) {
                    if (fn(name, objects[name])) {
                        matching[name] = objects[name];
                    }
                }
            }
            resolve(matching);
        });
    });
};

/**
 * Promises an object with {keyid: Friendship} key-values, where
 * all entries have passed the given filter function.
 *
 * @fn: function (obj) -> bool
 *      obj is a dict:  {aId: AFID, bId: BFID, self: username, other: username}
 *
 */
BGAPI.prototype.filterFriendships = function (fn) {
    "use strict";

    fn = fn || function () {};

    function matches(keyName, keyVal) {
        var obj;
        if (keyVal.typ === "fr") {
            obj = {
                aId: keyVal.opts.aId,
                bId: keyVal.opts.bId,
                self: keyVal.opts.self,
                other: keyVal.opts.other
            };

            try {
                return fn(obj);
            } catch (err) {
                console.error("Match function failed", keyName, err);
            }
            return false;
        }
    }

    return this.filterStore(matches).then(function (frs) {
        // convert to Friendship objects
        var k;
        for (k in frs) {
            if (frs.hasOwnProperty(k)) {
                try {
                    frs[k] = assertType(KeyLoader.fromStore(frs[k]), Friendship);
                } catch (err) {
                    continue;
                }
            }
        }
        return frs;
    });
};

/**
 *   Promises to cache and store the given key object.
 *
 *   @canon: the canonical name for the key
 *   @keyObj: the key object to store
 */
BGAPI.prototype.storeKey = function (canon, keyObj) {
    "use strict";

    var that = this;

    // cache it now.
    KeyCache.set(canon, keyObj);
    return new Promise(function (resolve, reject) {
        that.setStorageVal(canon, keyObj.toStore()).then(function () {
            resolve();
        }, function (err) {
            console.error("Cache may be out of sync for key:", canon);
            reject(err);
        });
    });
};


/**
 * Deletes the given key name from cache and storage
 *
 */
BGAPI.prototype.delKey = function (canon) {
    "use strict";

    KeyCache.del(canon);
    return this.delStorageVal(canon);
};

/**
 * Promise a key object of the given class.  This first attempts to
 * load the key object from the KeyCache, otherwise fallsback to
 * storage.
 *
 *  @canon -- the canonical name of the key
 *  @klass -- the object loaded should be of this type
 */
BGAPI.prototype.loadKey = function (canon, klass) {
    "use strict";

    var cached = KeyCache.get(canon);

    if (cached) {
        try {
            cached = assertType(cached, klass);
        } catch (err) {
            return Promise.reject(err);
        }
        return Promise.resolve(cached);
    }

    return this.getStorageVal(canon).then(function (object) {
        try {
            var keyobj = assertType(KeyLoader.fromStore(object), klass);
            KeyCache.set(canon, keyobj);
            return keyobj;
        } catch (err) {
            console.error("Failed to parse keyclass from storage: ", err);
            throw err;
        }
    });
};

/**
 * Promises something from storage based on a name
 **/
BGAPI.prototype.getStorageVal = function (name) {
    "use strict";
    return new Promise(function (resolve, reject) {
        storageArea.get(name, function (objects) {
            if (chrome.runtime.lastError || objects[name] === undefined) {
                reject(new Fail(Fail.NOKEY, "Failed to read key " + name + " from storage"));
            } else {
                resolve(objects[name]);
            }
        });
    });
};

/*
  Promises to delete a key from storage with the given name
*/
BGAPI.prototype.delStorageVal = function (name) {
    "use strict";
    return new Promise(function (resolve, reject) {
        storageArea.remove(name, function () {
            if (chrome.runtime.lastError) {
                return reject(new Fail(Fail.GENERIC, "Failed to delete key " + name + "from storage"));
            }
            resolve();
        });
    });                   
};

BGAPI.prototype.clearStorage = function () {
    "use strict";

    return new Promise(function (resolve, reject) {
        storageArea.clear(function () {
            if (chrome.runtime.lastError) {
                console.error("Could not clear storage", chrome.runtime.lastError);
                reject(new Fail(Fail.GENERIC, "Failed to clear storage"));
                return;
            }
            resolve();
        });
    });
};

/**
 * Promises to set a value in key-value store
**/
BGAPI.prototype.setStorageVal =  function (name, val) {
    "use strict";

    return new Promise(function (resolve, reject) {
        var insert = {};
        insert[name] = val;
        storageArea.set(insert, function () {
            if (chrome.runtime.lastError) {
                console.error("Failed to write to storage key. lastError:", chrome.runtime.lastError);
                reject(new Fail("NOKEY", "Failed to write to storage name " + name));
            } else {
                resolve();
            }
        });
    });
};

/*
 * Deletes all friendship keys that are associated with the given
 * username. Promises the deleted objects dictionary {canon: Friendship, ...}
 *
 * Deletes from both the store and the cache.
 * Note: Any ongoing KAP involving username is not aborted.
*/
BGAPI.prototype.clearFriendships = function (username) {
    "use strict";
    function _friendFinder(obj) {
        return (obj.self === username || obj.other === username);
    }

    return API.filterFriendships(_friendFinder).then(function (matching) {
        var k;
        var promises = [];

        for (k in matching) {
            if (matching.hasOwnProperty(k)) {
                promises.push(API.delKey(k));
            }
        }

        return Promise.all(promises).then(function () {
            return matching;
        });
    });
};

var handlers = {

    invalid_rpc: function (ctx, rpc) {
        "use strict";

        console.error("Invalid request. Command", rpc.cmd, "does not exist.");
        ctx.port.postMessage({callid: rpc.callid, error: Fail.INVALID_RPC});
    },

    update_priv_ind_anon: function (ctx, rpc) {

      rpc.params = assertType(rpc.params, {
            type: "",
            keyObj: {},
            val: true,
        }, "params");

        var protTypes = {
            'keyboard':    'protectKeyboard',
            'mouse':       'protectMouse',
            'filechooser': 'chooseFile',
            'change':      'protectChange',
        };

        var method = protTypes[rpc.params.type];
        var keyid = rpc.params.keyObj.keyid;
 
        if (method) {
            var streamKey = KeyLoader.fromStore(rpc.params.keyObj);
            return UI[method](rpc.params.val, streamKey);
        } else {
            console.error("Invalid privacy indicator message type:", rpc.params.type);
            ctx.port.postMessage({callid: rpc.callid, error: Fail.BADPARAM});
        }
    },

    update_priv_ind: function (ctx, rpc) {
        "use strict";

        rpc.params = assertType(rpc.params, {
            type: "",
            keyid: "",
            val: true,
        }, "params");


        var protTypes = {
            'keyboard':    'protectKeyboard',
            'mouse':       'protectMouse',
            'filechooser': 'chooseFile',
            'change':      'protectChange',
        };

        var method = protTypes[rpc.params.type];
        var keyid = rpc.params.keyid;
        if (method) {
              ctx.loadKey(keyid, AESKey).then(function (streamKey) {
                  // update the privacy indicator
                  return UI[method](rpc.params.val, streamKey);
              }).then(function () {
                  ctx.port.postMessage({callid: rpc.callid, result: true});
              }).catch(function (err) {
                  console.error(err);
                  ctx.port.postMessage({callid: rpc.callid, error: Fail.toRPC(err)});
              });
        } else {
            console.error("Invalid privacy indicator message type:", rpc.params.type);
            ctx.port.postMessage({callid: rpc.callid, error: Fail.BADPARAM});
        }
    },

    _maim: function (ctx, rpc) {
        "use strict";
        console.debug("[crypto] maiming context.");
        ctx.maim().then(function () {
            ctx.port.postMessage({callid: rpc.callid, result: true});
        });
    },

    app_message: function (ctx, rpc) {
        "use strict";
            
        rpc.params = assertType(rpc.params, {
            msg: {}
        });

        var message = rpc.params.msg;

        ctx.onAppMessage(message).then(function (result) {
            ctx.port.postMessage({callid: rpc.callid, result: result});
        }).catch(function (err) {
            console.error(err);
            ctx.port.postMessage({callid: rpc.callid, error: err.code || Fail.GENERIC});
        });
    },

    invite: function (ctx, rpc) {
        "use strict";

        // friend, convid -> invite
        rpc.params = assertType(rpc.params, {
            friend: KH_TYPE,
            convid: OneOf("", KH_TYPE),
        }, "params");

        var convid = rpc.params.convid;
        var convhandle = ((typeof convid) === "string") ? {keyid: convid} : convid;
        
        return ctx.invite(rpc.params.friend, convhandle.keyid);
    },

    accept_invite: function (ctx, rpc) {
        "use strict";

        // invite -> convid
        rpc.params = assertType(rpc.params, {
            invite: MSG_TYPE
        }, "params");

        return ctx.acceptInvite(rpc.params.invite);
    },

    new_stream: function (ctx, rpc) {
        "use strict";
        // create new conversation/stream key
        rpc.params = assertType(rpc.params, {});
        return ctx.newStream(rpc.params);
    },

    new_anon_stream: function(ctx, rpc) {
        rpc.params = assertType(rpc.params, {});
        return ctx.newAnonStream(rpc.params);
    },

    fetch_public: function (ctx, rpc) {
        "use strict";

        console.debug("[crypto] fetch_public");

        rpc.params = assertType(rpc.params, {
            username: ""
        }, "params");

        var keyid = rpc.params.username;

        ctx.loadKey(keyid, ECCPubKey, "@").then(function (/* keyhandle */) {
            ctx.port.postMessage({callid: rpc.callid, result: {keyid: keyid}});
        }).catch(function (err) {
            if (err.code !== Fail.NOKEY) {
                console.error(rpc.cmd, err.code, err);
                ctx.port.postMessage({callid: rpc.callid, error: err.code || Fail.GENERIC});
                return;
            }

            console.log("user identity unknown. fetching online.");
            API.fetchPublic(rpc.params.username).then(function (ident) {
                return ctx.storeKey(keyid, ident).then(function (keyhandle) {
                    ctx.port.postMessage({callid: rpc.callid, result: keyhandle});
                });
            }).catch(function (err) {
                console.error(err);
                ctx.port.postMessage({callid: rpc.callid, error: err.code || Fail.GENERIC});
            });
        });
    },

    // Debug function exposing the self-check for twitter keys.
    check_twitter: function (ctx, rpc) {
        "use strict";

        // username associated with the context
        if (!ctx.kr) {
            throw new Fail(Fail.NOKEYRING, "no keyring open");
        }

        var username = ctx.kr.username;

        API.checkTwitter(username).then(function (matches) {
            ctx.port.postMessage({callid: rpc.callid, result: matches});
        }).catch(function (err) {
            console.error(err);
            ctx.port.postMessage({callid: rpc.callid, error: err.code || Fail.GENERIC});
        });
    },

    // Debug function exposing the refresh of twitter-keys.
    refresh_twitter: function (ctx, rpc) {
        "use strict";

        API.refreshAllFriends().then(function (matches) {
            ctx.port.postMessage({callid: rpc.callid, result: true});
        }).catch(function (err) {
            console.error(err);
            ctx.port.postMessage({callid: rpc.callid, error: err.code || Fail.GENERIC});
        });
    },

    encrypt_aes: function (ctx, rpc) {
        "use strict";

        //used by lighten in the content script
        //console.debug("[crypto] encrypt_aes");

        rpc.params = assertType(rpc.params, {keyhandle: OneOf(KH_TYPE, "")});

        if ((typeof rpc.params.keyhandle) === "string") {
            rpc.params.keyhandle = {keyid: rpc.params.keyhandle};
        }

        var keyhandle = rpc.params.keyhandle;
        ctx.loadKey(keyhandle.keyid, AESKey).then(function (aes) {
            // If the key is stale, then no new content should be encrypted with it.
            var stale = aes.isInvalid();
            if (!stale) {
                var result = aes.encryptText(rpc.params.plaintext);
                if (rpc.times) {
                    rpc.times.bgout = performance.now();
                }
                ctx.port.postMessage({callid: rpc.callid, result: result, times: rpc.times});
            } else {
                UI.raiseWarning(null, "Conversation had participants (" + stale + ") with stale keys.");
                ctx.port.postMessage({callid: rpc.callid, error: Fail.STALE});
            }
        });
    },

    decrypt_aes: function (ctx, rpc) {
        "use strict";

        // used by darken in the content script

        rpc.params = assertType(rpc.params, {keyhandle: KH_TYPE});
        var keyhandle = rpc.params.keyhandle;

        return ctx.loadKey(keyhandle.keyid, AESKey).then(function (convKey) {
            // If they key is stale, then do the operation but raise a warning.
            var stale = convKey.isInvalid();
            if (stale) {
                var principals = " ";
                for (var p in stale) {
                    if (stale.hasOwnProperty(p)) {
                        principals = principals + p + " "
                    }
                }
                UI.raiseWarning(null, "Conversation had participants (" + principals + ") with stale keys.");
            }
            var plainText = convKey.decryptText(rpc.params.ciphertext);
            if (plainText) {
                console.debug("[crypto] decrypt_aes: => "  + plainText.substr(0, 32) + "...");
            }
            return plainText;
        });
    },

    use_keyring: function (ctx, rpc) {
        "use strict";

        rpc.params = assertType(rpc.params, {keyringid: ""});
        ctx.openKeyring(rpc.params.keyringid).then(function () {
            ctx.port.postMessage({callid: rpc.callid, result: true});
        }).catch(function (err) {
            console.error(err);
            ctx.port.postMessage({callid: rpc.callid, error: Fail.toRPC(err)});
        });
    },

    new_keyring: function (ctx, rpc) {
        "use strict";

        rpc.params = assertType(rpc.params, {keyringid: ""});
        ctx.newKeyring(rpc.params.keyringid).then(function (res) {
            ctx.port.postMessage({callid: rpc.callid, result: res});
        }).catch(function (err) {
            console.error(err);
            ctx.port.postMessage({callid: rpc.callid, error: Fail.toRPC(err)});
        });
    },

    darken: function (ctx, rpc) {
        "use strict";
        return handlers.decrypt_aes(ctx, rpc);
    },

    // return a user handler for an existing friend, or null
    is_friend: function (ctx, rpc) {
        "use strict";
        rpc.params = assertType(rpc.params, {username: ""});

        ctx.isFriend(rpc.params.username).then(function (res) {
            ctx.port.postMessage({callid: rpc.callid, result: res});
        }).catch(function (err) {
            console.error(err);
            ctx.port.postMessage({callid: rpc.callid, error: Fail.toRPC(err)});
        });
    },

    // return a user handle for the new friend
    get_friend: function (ctx, rpc) {
        "use strict";
        rpc.params = assertType(rpc.params, {username: ""});

        ctx.getFriend(rpc.params.username).then(function (res) {
            ctx.port.postMessage({callid: rpc.callid, result: res});
        }).catch(function (err) {
            console.error(err);
            ctx.port.postMessage({callid: rpc.callid, error: Fail.toRPC(err)});
        });
    },

    post_keys: function (ctx, rpc) {
        "use strict";
        rpc.params = assertType(rpc.params, {username: ""});
        ctx.postKeys(rpc.params.username).then(function (res) {
            ctx.port.postMessage({callid: rpc.callid, result: res});
        }).catch(function (err) {
            console.error(err);
            ctx.port.postMessage({callid: rpc.callid, error: Fail.toRPC(err)});
        });
    },

    post_tweets: function (ctx, rpc) {
        "use strict";
        rpc.params = assertType(rpc.params, {tags: [], keys: []});
        ctx.postTweets(rpc.params.tags, rpc.params.keys).then(function (res) {
            ctx.port.postMessage({callid: rpc.callid, result: res});
        }).catch(function (err) {
            console.error(err);
            ctx.port.postMessage({callid: rpc.callid, error: Fail.toRPC(err)});
        });
    },

    get_twitter_stream: function (ctx, rpc) {
        "use strict";
        ctx.getTwitterStream().then(function (res) {
            ctx.port.getTwitterStream({callid: rpc.callid, result: res});
        }).catch(function (err) {
            console.error(err);
            ctx.port.postMessage({callid: rpc.callid, error: Fail.toRPC(err)});
        });
    },

    encrypt_elGamal: function (ctx, rpc) {
        "use strict";
        rpc.params = assertType(rpc.params, {principals: []});

        var ret = ctx.encryptMessage(rpc.params.principals, rpc.params.plaintext);
        ctx.port.postMessage({callid: rpc.callid, result: ret});/*.then(function (res) {
            return res;
        }).catch(function (err) {
            console.error(err);
            ctx.port.postMessage({callid: rpc.callid, error: Fail.toRPC(err)});
        });*/
    },

    darken_elGamal: function (ctx, rpc) {
        "use strict";
        rpc.params = assertType(rpc.params, {keyhandle: OneOf(KH_TYPE, ""), ciphertext: ""});
        var pt = ctx.decryptMessage(rpc.params.ciphertext);
        return pt;
    }
};

chrome.extension.onConnect.addListener(function (port) {
    "use strict";

    var _tabId, ctx;
    if (port.name !== "csToBg") {
        console.error("unknown port type:", port);
        return;
    }

    _tabId = port.sender.tab.id;

    if (_tabId === -1) {
        console.error("I didn't think content scripts would be attached to non-tab stuff");
        return;
    }

    ctx = new CryptoCtx(port);

    console.debug("added ctx for " + getHost(port.sender.tab.url));

    port.onMessage.addListener(function (msgStr) {

        var rpc, handler;
        rpc = (typeof msgStr === "object") ? msgStr : JSON.parse(msgStr);

        if (rpc.times) {
            rpc.times.bgin = performance.now();
        }

        // A response from a content script
        if (rpc.bgcallid !== undefined) {
            var pendingRPC = ctx._csCalls[rpc.bgcallid];

            if (!pendingRPC) {
                console.log("Got return value for untracked call.");
                return;
            }

            delete ctx._csCalls[rpc.bccallid];

            if (rpc.hasOwnProperty("error") && !!rpc.error) {
                if (pendingRPC.errorcb) {
                    pendingRPC.errorcb(Fail.fromVal(rpc.error));
                }
            } else {
                if (pendingRPC.cb) {
                    pendingRPC.cb(rpc.result);
                }
            }

            return;
        }

        handler = handlers[rpc.cmd] || handlers.invalid_rpc;
        try {
            if (ctx.isMaimed) {
                return ctx.port.postMessage({callid: rpc.callid, error: Fail.MAIMED});
            }
            //console.debug("[SOP] " + rpc.cmd);
            var ret = handler(ctx, rpc);
            if (ret instanceof Promise) {
                
                ret.then(function (result) {
                    if (rpc.times) {
                        rpc.times.bgout = performance.now();
                    }
                    ctx.port.postMessage({callid: rpc.callid, result: result, times: rpc.times});
                }).catch(function (err) {
                    console.error("[Beeswax] handler cmd=" + rpc.cmd + " failed:", err);
                    if (rpc.times) {
                        rpc.times.bgout = performance.now();
                    }
                    ctx.port.postMessage({callid: rpc.callid, error: Fail.toRPC(err), times: rpc.times});
                });
            }
            return ret;
        } catch (err) {
            if (rpc.times) {
                rpc.times.bgout = performance.now();
            }
            ctx.port.postMessage({callid: rpc.callid, error: Fail.toRPC(err), times: rpc.times});

            if (!(err instanceof Fail)) {
                // Uncaught! Display it.
                throw err;
            }
        }
    });

    port.onDisconnect.addListener(function ( /* p */) {
        ctx.close();
    });
});

chrome.extension.onMessage.addListener(function (msg, sender, undefined /* sendResponse */) {
    /*
  for (tab in pertabApp) {
    if (pertabApp[tab] == msg.app) {
      if (msg.cmd == "plug") {
        console.log("BG: plug app ("+msg.app+") on tab" + tab, msg);
      } else if (msg.cmd == "unplug") {
        console.log("BG: unplug app ("+msg.app+") on tab" + tab, msg);
      }
      pertabPorts[tab].postMessage(msg);
    }
  }
  */
});


var KeyCache = (function () {
    "use strict";

    function KeyCache() {
        this.keys = {};
    }
    KeyCache.EXP_MS = 30 * 60 * 1000;

    KeyCache.prototype = {
        set: function (keyid, val) {
            this.keys[keyid] = {v: val, exp: Date.now() + KeyCache.EXP_MS};
        },
        get: function (keyid) {
            var o = this.keys[keyid];
            if (o === undefined) {
                return undefined;
            }
            o.exp = Date.now() + KeyCache.EXP_MS;
            return o.v;
        },
        del: function (keyid) {
            delete this.keys[keyid];
        },
        /* delete expired keys */
        cleanup: function () {
            var checkTime = Date.now();
            var that = this;

            function _expired(k, o) {
                return checkTime > o.exp;
            }
            this.filter(_expired).forEach(function (k) {
                that.del(k);
            });
        },
        filter: function (fn) {
            fn = fn || function () { return false; };
            var matching = [];
            var k;
            for (k in this.keys) {
                if (this.keys.hasOwnProperty(k)) {
                    if (fn(k, this.keys[k])) {
                        matching.push(k);
                    }
                }
            }
            return matching;
        }
    };
    return new KeyCache();
})();

API = new BGAPI();

