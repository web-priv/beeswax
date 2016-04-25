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
  Promise, define
  _M,
*/

/*jshint
 es5: true
*/

/* See API for possible assertions:
   http://api.qunitjs.com/category/assert/
*/
define(["QUnit", "utils"], function (QUnit, U) {
    "use strict";

    if (!window._M) {
        window._M = window._micasa;
    }

    if (window._M === undefined) {
        QUnit.module("Extension Loading");
        QUnit.test("library is present", function (assert) {
            assert.ok(window._M !== undefined, "Micasa global should be present. Make sure extension is loaded.");
        });
        return;
    } else if (!window._M.test_enabled()) {
        QUnit.module("Extension Loading");
        QUnit.test("compiled with test support", function (assert) {
            assert.ok(window._M.test_enabled(), "Micasa should be compiled with test support (make DEBUG=1)");
        });
        return;
    }

    QUnit.module("Initialization");
    QUnit.asyncTest("Call API functions before keyring is chosen", function (assert) {
        var timer = new U.TestTimer(assert, 5000, 1);
        Promise.all([
            ["gen_ecc_keypair", ["_"]],
            ["get_ecc_keypair", ["_"]],
            ["gen_aes_key", ["_"]],
            ["get_aes_key", ["_"]],
            ["put_identity", ["_", {sign: "", encrypt: ""}]],
            ["get_identity", ["_"]],
            ["export_identity", ["_"]],
            ["encrypt_aes", [{keyid: ""}, "_"]],
            ["encrypt_key", [{}, {}]],
            ["decrypt_aes", [{keyid: ""}, "_"]],
            ["decrypt_key", ["_", {}, "_"]]
            // ["rsa_sign", [{}, "_", "_"]],
            // ["rsa_verify", [{}, "_", "_"]]
        ].map(function makeCall(rpc) {
            var rpcfunc = rpc[0];
            var rpcargs = rpc[1];
            return _M[rpcfunc].apply(_M, rpcargs).then(function (/* keyhandle */) {
                assert.ok(false, "Keyring not set. " + rpcfunc + "() Should fail.");
            }).catch(function (err) {
                assert.micasaError(err, _M.E.NOKEYRING, "Keyring not set. API call " + rpcfunc +
                                   "() should fail with NOKEYRING.");
            });
        })).then(function () {
            timer.finish();
        }).catch(function (err) {
            console.err(err);
            assert.ok(false, "One error wasn't caught.");
            timer.finish();
        });
    });

    QUnit.asyncTest("Use a keyring with an invalid name.", function (assert) {
        var timer = new U.TestTimer(assert, 1000, 1);
        Promise.all([null, undefined, 2, {}].map(function (inval) {
            return _M.use_keyring(inval).then(function () {
                assert.ok(false, "Keyring open with invalid name. (" + inval + ")");
            }).catch(function (err) {
                assert.micasaError(err, _M.E.BADTYPE, "Bad params (" + inval + ") shall not pass.");
            });
        }))
            .then(function () { timer.finish(); })
            .catch(function (err) {
                console.error(err);
                assert.ok(false, "One error wasn't caught.");
                timer.finish();
            });
    });

    QUnit.asyncTest("Cannot open a keyring that doesnt exist.", function (assert) {
        var timer = new U.TestTimer(assert, 1000, 1);
        _M.use_keyring(U.UUID4()).then(function () {
            assert.ok(false, "Managed to open a keyring that does not exist.");
            timer.finish();
        }).catch(function (err) {
            assert.micasaError(err, "NOKEYRING", "Should not succeed.");
            timer.finish();
        });
    });

    QUnit.asyncTest("Cannot create new keyring with invalid params.", function (assert) {
        var invalidKeys = [undefined, null, 2, {}];
        var timer = new U.TestTimer(assert, 1000, invalidKeys.length);
        invalidKeys.map(function (inval) {
            _M.new_keyring(inval).then(function () {
                assert.ok(false, "Created a keyring with an invalid id");
                timer.finish();
            }).catch(function (err) {
                assert.micasaError(err, _M.E.BADTYPE, "" + inval + " is not a valid keyringid.");
                timer.finish();
            });
        });
    });

    QUnit.asyncTest("Open a new keyring.", function (assert) {
        var timer = new U.TestTimer(assert, 1000, 1);
        U.openKeyring().then(function () {
            assert.ok(true, "Created keyring");
            timer.finish();
        }).catch(function (err) {
            assert.micasaSuccess(err, "OK", "Failed to create keyring.");
        });
    });

    QUnit.module("Key Generation");
    QUnit.precondTest("Cannot generate a symmetric key with invalid keyids", U.openKeyring, function (assert) {
        var invalidKeys = [null, 2, {}];
        var timer = new U.TestTimer(assert, 1000, invalidKeys.length);
        invalidKeys.map(function (inval) {
            _M.gen_aes_key(inval).then(function (/* keyhandle */) {
                assert.ok(false, "Created a keyring with an invalid id (" + inval + ")");
                timer.finish();
            }).catch(function (err) {
                assert.micasaError(err, _M.E.BADTYPE, "" + inval + " is not a valid keyid.");
                timer.finish();
            });
        });
    });

    QUnit.precondTest("Generate a symmetric key", U.openKeyring, function (assert) {
        var timer = new U.TestTimer(assert, 1000, 1);
        _M.gen_aes_key(U.UUID4()).then(function (keyhandle) {
            assert.ok(keyhandle, "Created a key.");
            timer.finish();
        }).catch(function (err) {
            assert.micasaError(err, "OK", "Creation unexpectedly failed.");
            timer.finish();
        });
    });

    QUnit.module("Key Generation");
    QUnit.precondTest("Cannot generate ecc keypair with invalid keyids", U.openKeyring, function (assert) {
        var invalidKeys = [null, 2, {}];
        var timer = new U.TestTimer(assert, 1000, invalidKeys.length);
        invalidKeys.map(function (inval) {
            _M.gen_ecc_keypair(inval).then(function (/* keyhandle */) {
                assert.ok(false, "Created one with an invalid id (" + inval + ")");
                timer.finish();
            }).catch(function (err) {
                assert.micasaError(err, _M.E.BADTYPE, "" + inval + " is not a valid keyid.");
                timer.finish();
            });
        });
    });

    QUnit.precondTest("Get a non-existent ecc keypair should fail", U.openKeyring, function (assert) {
        var timer = new U.TestTimer(assert, 1000, 1);
        _M.get_ecc_keypair(U.UUID4()).then(function (/* keyhandle */) {
            assert.ok(false, "Can't retrieve a key that doesn't exist");
            timer.finish();
        }).catch(function (err) {
            assert.micasaError(err, "NOKEY", "Should give NOKEY.");
            timer.finish();
        });
    });

    QUnit.precondTest("Generate an ecc keypair", U.openKeyring, function (assert) {
        var timer = new U.TestTimer(assert, 1000, 1);
        var keyid = U.UUID4();
        _M.gen_ecc_keypair(keyid).then(function (keyhandle) {
            assert.ok(keyhandle, "key generation successful");
            _M.get_ecc_keypair(keyid).then(function (keyhandle) {
                assert.ok(keyhandle, "new key can be retrieved with get_ecc_keypair");
                timer.finish();
            }).catch(function (err) {
                assert.micasaError(err, "OK", "Get() of previously-created key should pass.");
                timer.finish();
            });
        }).catch(function (err) {
            assert.micasaError(err, "OK", "Creation unexpectedly failed.");
            timer.finish();
        });
    });

});
