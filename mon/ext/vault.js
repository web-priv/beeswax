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
  chrome, Promise, ECCKeyPair

  CryptoCtx
*/

window.Vault = (function () {
    "use strict";

    function Vault() {
        this._load();
    }

    Vault.prototype = {

        get: function (opt) {
            return this.db[opt];
        },

        set: function (opts) {
            var k;
            for (k in opts) {
                if (opts.hasOwnProperty(k)) {
                    this.db[k] = opts[k];
                }
            }
            this._save();
        },

        reset: function () {
            this.db = this._defaults();
            this._save();
        },

        regenKeys: function (userid) {
            var newkey = new ECCKeyPair();
            var sk = "identity." + btoa(userid);
            var settings = {};
            if (!this.get(sk)) {
                console.error("no such user");
                return null;
            }
            settings[sk] = newkey.toStore();
            this.set(settings);
            return newkey;
        },

        newAccount: function (userid, importData) {
            var keyobj = (importData === undefined) ? new ECCKeyPair() : ECCKeyPair.fromStore(JSON.parse(importData));

            var inStore = keyobj.toStore();
            var sk = "identity." + btoa(userid);
            var settings = {};
            
            if (this.get(sk)) {
                console.error("user already exists");
                return null;
            }
            var users = this.get("usernames");
            users.push(userid);
            settings.users = users;
            settings[sk] = inStore;
            if (users.length === 1) {
                settings.username = userid;
            }
            this.set(settings);
            return keyobj;
        },

        getAccountNames: function () {
            var users = this.get("usernames");
            return users.slice();
        },

        // default username
        getUsername: function () {
            return this.get("username");
        },
        
        // set default username
        setUsername: function (userid) {
            this.set({"username": userid});
        },

        getAccount: function (userid) {
            if (userid === "" || userid === undefined) {
                userid = this.get("username");
            }
            if (!userid) {
                console.error("No user selected!");
                return null;
            }

            var identity = this.get("identity." + btoa(userid));
            if (!identity) {
                return null;
            }
            var kp = ECCKeyPair.fromStore(identity);
            return kp;
        },

        _defaults: function () {
            return {usernames: []};
        },

        _save: function () {
            localStorage.settings = JSON.stringify(this.db);
        },

        _load: function () {
            var settings = localStorage.settings;
            if (settings === undefined) {
                console.log("clear vault.");
                this.db = this._defaults();
                return;
            }
            try {
                this.db = JSON.parse(settings);
            } catch (err) {
                console.error("Could not load settings string. Starting fresh.", settings);
                this.db = this._defaults();
            }
        }
    };

    return new Vault();
})();