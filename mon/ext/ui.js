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
  chrome, Promise, Utils,

  CryptoCtx
*/

window.UI = (function () {
    "use strict";

    var MOUSE_TIMER_UNLOCK_MS = 4000;
    var KB_TIMER_UNLOCK_MS = 4000;
    var FILE_CHOOSER_TIMER_UNLOCK_MS = 5000;
    var CHANGE_TIMER_UNLOCK_MS = 4000;

    var all_prompts = [];
    var all_warnings = {};

    function Prompt(ctx, name, prompt, actions) {
        this.key = Prompt.formKey(ctx, name);
        this.ctx = ctx;
        this.prompt = prompt;
        this.actions = (actions) ? actions.slice() : [];
        this.defer = Utils.defer();
    }

    //
    // Promises the action (string) selected by the User in the popup.
    //
    Prompt.prototype.getPromise = function () {
        return this.defer.promise;
    };

    /**
       Remove the prompt with (ctx, key).
       triggerAction is optional. specify to invoke the promise.
    */
    Prompt.prototype.dismiss = function (triggerAction) {

        console.debug("Dismissing prompt", this, "with action:", triggerAction);

        var prompts = all_prompts.filter(Prompt.byKey(this.key));
        if (prompts.length < 1) {
            console.warn("Prompt not in all_prompts array: key=", this.key);
        }

        var isMatch = Prompt.byKey(this.key);
        all_prompts = all_prompts.filter(function (p) {
            return !isMatch(p);
        });

        // got rid of the prompts. maybe remove badge.
        singleton.redraw();

        if (triggerAction) {
            return this.defer.resolve(triggerAction);
        }

    };

    Prompt.formKey = function (ctx, name) {
        return ((!ctx) ? "null" : ctx.serial) + "." + name;
    };

    Prompt.byKey = function (key) {
        return function (p) {
            return p && p.key === key;
        };
    };

    Prompt.byCtx = function (ctx) {
        return function (p) {
            return p && p.ctx === ctx;
        };
    },

    Prompt.byTab = function (tab) {
        // Param tab: a chrome Tab object

        return function (p) {
            return p && p.ctx.tabId === tab.id;
        };
    };

    Prompt.ACCEPT = "Accept";
    Prompt.REFUSE = "Refuse";
    Prompt.CANCEL = "Cancel";
    Prompt.DISMISS = "Dismiss";

    function _loadImg(fname) {
        return new Promise(function (resolve, reject) {
            var img = new Image();
            img.onload = function () {
                resolve(img);
            };
            img.onerror = function (err) {
                reject(err);
            };
            img.src = chrome.extension.getURL(fname);
        });
    }

    function UI() {
        var that = this;

        this.drawCtx = document.createElement("canvas").getContext("2d");
        this.warningCtx = document.createElement("canvas").getContext("2d");

        this.isProtected = false;
        this.kbTimer = -1;
        this.kbFlag = false;
        this.globalWarning = false;
        this.mouseTimer = -1;
        this.mouseFlag = false;
        this.fileChooserTimer = -1;
        this.fileChooserFlag = false;
        this.changeTimer = -1;
        this.changeFlag = false;
        
        // messages are appended to this and displayed in the popup.
        this.logBuffer = "";

        // key associated with the protected elements.
        this.keyObj = null;

        this.images = Promise.all([_loadImg("logo/logo19.png"), _loadImg("logo/warning19.png")])
            .catch(function (err) {
                console.error("Icon could not be loaded. Defaulting to empty image.", err);
                var img1 = new Image();
                img1.width = 19;
                img1.height = 19;
                var img2 = new Image();
                img2.width = 19;
                img2.height = 19;
                return [img1, img2];
            });

        this.redraw();

        chrome.tabs.onActivated.addListener(function (activeInfo) {
            console.debug("[ui] tab activated tabId: " + activeInfo.tabId + " windowId: " + activeInfo.windowId);
            that.redraw();
        });
    }

    UI.prototype.listPrompts = function (tab) {
        var tabPrompts = all_prompts.filter(Prompt.byTab(tab));
        return tabPrompts;
    };

    /**
       prompt the user for an action/permission.
       
       returns a Prompt
       
       @param CryptoCtx a ctx in which this prompt is valid.
       @param String name A name to refer to this prompt, unique within the context
       @param String prompt user-readable message to show the user.
       @param Array availActions the set of possible actions the user can choose from
    */
    UI.prototype.prompt = function (ctx, name, prompt, availActions) {
        var key = Prompt.formKey(ctx, name);
        var existing = all_prompts.filter(Prompt.byKey(key));
        if (existing.length > 0) {
            return existing[0];
        }

        var p = new Prompt(ctx, name, prompt, availActions);
        all_prompts.push(p);

        // We redraw the indicators -- new prompt requires attention
        this.redraw();

        return p;
    };

    // Release resources associated with context.
    // (prompts, etc.)
    UI.prototype.closeCtx = function (ctx) {
        var prompts = all_prompts.filter(Prompt.byCtx(ctx));
        var i;
        for (i = 0; i < prompts.length; i++) {
            prompts[i].dismiss(/*do not invoke promise*/);
        }
    },

    /** converts an array of key principals to a user-readable list of names
     */
    UI.prototype.audienceLabel = function (key) {
        var k;
        var principals = key.principals;
        var listing = [];
        for (k in principals) {
            if (principals[k]) {
                listing.push("@" + k.toLocaleLowerCase());
            }
        }
        // usernames can only contain letters number and underscores
        return listing.join(" ");
    },
            
    UI.prototype._updateBadge = function () {

        var that = this;

        function drawBadgeForTab(tab) {
            var txt = "";
            var tabPrompts = all_prompts.filter(Prompt.byTab(tab));

            if (tabPrompts.length > 0) {
                txt += "*";
            }

            if (that.kbFlag) {
                txt += "K";
            }

            if (that.fileChooserFlag) {
                txt += "F";
            }

            if (that.changeFlag) {
                txt += "C";
            }

            if (that.mouseFlag) {
                txt += "M";
            }

            chrome.browserAction.setBadgeText({text: txt});

            if (txt !== "") {
                chrome.browserAction.setBadgeBackgroundColor({color: [200, 0, 0, 255]});
            }
        }

        chrome.tabs.query({
            active: true,
            currentWindow: true
        }, function (tabs) {
            if (tabs.length < 1) {
                console.log("[ui] no active tab.");
                return;
            }
            drawBadgeForTab(tabs[0]);
        });
    };

    /* promises that the UI flags will be updated. */
    UI.prototype._updateProtected = function () {
        var prot = false;

        if (this.kbFlag) {
            prot = true;
        }

        if (this.mouseFlag) {
            prot = true;
        }

        if (this.changeFlag) {
            prot = true;
        }

        if (this.fileChooserFlag) {
            prot = true;
        }

        this._updateBadge();
        return this._setProtected(prot);
    };

    UI.prototype._setFlag = function (flagName, newSetting, keyObj) {
        if (newSetting) {
            if (!keyObj) {
                console.error("[UI] Enabling flag " + flagName + " with no key specified.");
                throw new Error("[UI] Enabling flag " + flagName + " with no key specified.");
            }
                
            if (this.keyObj && keyObj.keyid !== this.keyObj.keyid) {
                console.error("[UI] Enabling flag " + flagName + " on a different protected region.");
                throw new Error("[UI] Enabling flag " + flagName + " on a different protected region.");
            }

            this.keyObj = keyObj;
        }

        this[flagName] = newSetting;
    };

    UI.prototype.chooseFile = function (setting, keyObj) {
        console.debug("[UI] chooseFile:", setting, (keyObj === null) ? null : keyObj.keyid);

        var that = this;
        keyObj = keyObj || null;

        var newSetting = (setting === undefined) ? false : !!setting;
        
        that._setFlag('fileChooserFlag', newSetting, keyObj);

        function _disableFileChooser() {
            that.fileChooserTimer = -1;
            that.chooseFile(false, null);
        }

        if (that.fileChooserTimer > -1) {
            window.clearInterval(that.fileChooserTimer);
            that.fileChooserTimer = -1;
        }
        
        if (that.fileChooserFlag) {
            that.fileChooserTimer = window.setTimeout(_disableFileChooser, FILE_CHOOSER_TIMER_UNLOCK_MS);
        }

        return that._updateProtected();
    };

    UI.prototype.protectChange = function (setting, keyObj) {
        console.debug("[UI] protectChange:", setting, (keyObj === null) ? null : keyObj.keyid);

        var that = this;
        keyObj = keyObj || null;

        var newSetting = (setting === undefined) ? false : !!setting;
        
        that._setFlag('changeFlag', newSetting, keyObj);

        function _unprotectChange() {
            that.changeTimer = -1;
            that.protectChange(false, null);
        }

        if (that.changeTimer > -1) {
            window.clearInterval(that.changeTimer);
            that.changeTimer = -1;
        }
        
        if (that.changeFlag) {
            that.changeTimer = window.setTimeout(_unprotectChange, CHANGE_TIMER_UNLOCK_MS);
        }

        return that._updateProtected();
    };

    UI.prototype.protectMouse = function (setting, keyObj) {
        console.debug("[UI] protectMouse:", setting, (keyObj === null) ? null : keyObj.keyid);

        var that = this;
        keyObj = keyObj || null;

        var newSetting = (setting === undefined) ? false : !!setting;

        that._setFlag('mouseFlag', newSetting, keyObj);

        if (newSetting && keyObj !== null) {
            that.keyObj = keyObj;
        }

        function _unprotectMouse() {
            that.mouseTimer = -1;
            that.protectMouse(false, null);
        }

        if (that.mouseTimer > -1) {
            window.clearInterval(this.mouseTimer);
            that.mouseTimer = -1;
        }
        
        if (that.mouseFlag) {
            that.mouseTimer = window.setTimeout(_unprotectMouse, MOUSE_TIMER_UNLOCK_MS);
        }

        return that._updateProtected();
    };

    // Set the warning flag for a given tab. pass null to make it a global warning.
    // The browser action will display the warning icon.
    //
    UI.prototype.raiseWarning = function (tabid, msg) {
        if (tabid === null || tabid === undefined) {
            this.globalWarning = true;
        } else {
            this.all_warnings[tabid] = true;
        }
        
        if (msg) {
            this.log("!!!: " + msg);
        }

        this.redraw();
    };

    // Removes the warning flag for a given tabid. pass null to drop the global warning.
    // The browser action will no longer show the warning icon.
    //
    UI.prototype.dropWarning = function (tabid) {
        if (tabid === null || tabid === undefined) {
            this.globalWarning = false;
        } else {
            delete this.all_warnings[tabid];
        }

        this.redraw();
    };

    UI.prototype.protectKeyboard = function (setting, keyObj) {
        console.debug("[UI] protectKeyboard:", setting, (keyObj === null) ? null : keyObj.keyid);

        var that = this;
        keyObj = keyObj || null;

        var newSetting = (setting === undefined) ? false : !!setting;

        that._setFlag('kbFlag', newSetting, keyObj);

        function _unprotectKeyboard() {
            that.kbTimer = -1;
            that.protectKeyboard(false, null);
        }

        if (that.kbTimer > -1) {
            window.clearInterval(that.kbTimer);
            that.kbTimer = -1;
        }
        
        if (that.kbFlag) {
            that.kbTimer = window.setTimeout(_unprotectKeyboard, KB_TIMER_UNLOCK_MS);
        }
            
        return that._updateProtected();
    };

    /*
     * Promises true if the UI indicator can be updated with the
     * new protection mode. else rejects.
     */
    UI.prototype._setProtected = function (isProtected) {
        var that = this;
        var newSetting = !!isProtected;
        return this.refreshImage(newSetting).then(function () {
            var changed = that.isProtected !== newSetting;
            that.isProtected = newSetting;

            // forget private area key
            if (!that.isProtected) {
                that.keyObj = null;
            }

            var keyid = (that.keyObj === null) ? null : that.keyObj.keyid;
            console.debug("[UI] Protection mode changed to: " + that.isProtected + " key=" + keyid);

            if (changed) {
                CryptoCtx.notifyAll("ui_protection_change", {isProtected: newSetting, keyid: keyid});
            }
            return true;
        });
    };


    UI.prototype.redraw = function () {
        this.refreshImage();
        this._updateBadge();
    };

    /*
     * Promises true if the UI was refreshed. else fails.
     */
    UI.prototype.refreshImage = function (isProtected) {
        var that = this;

        if (isProtected === undefined) {
            isProtected = this.isProtected;
        }

        return this.images.then(function (imgArray) {

            var img = imgArray[0];        // base image
            var warningImg = imgArray[1]; // warning layer
            var w = img.width, h = img.height;

            return new Promise(function (resolve) {
                chrome.tabs.query({
                    active: true,
                    currentWindow: true
                }, function (tabs) {
                    if (tabs.length < 1) {
                        console.log("[ui] no active tab.");
                        resolve(drawImageForTab(null));
                    } else {
                        resolve(drawImageForTab(tabs[0]));
                    }
                });
            }).catch(function (err) {
                console.error(err);
                throw new Error("Could not redraw.");
            });

            // tab is null if there is no active tab (e.g. in chrome://extensions tab);
            function drawImageForTab(tab) {

                var r, g, b, a, p, avg;
                var map = null;
                var imdata = null, wData = null;

                that.drawCtx.drawImage(img, 0 /*x*/, 0 /*y*/);
                map = that.drawCtx.getImageData(0, 0, w, h);
                imdata = map.data;

                // convert image to black and white if not in protected mode.
                if (!isProtected) {
                    for (p = 0; p < imdata.length; p += 4) {
                        r = imdata[p],
                        g = imdata[p + 1],
                        b = imdata[p + 2];
                        /* [p+3] is alpha */
                        avg = Math.floor((g * 0.6 + r * 0.3 + b * 0.1));
                        imdata[p] = imdata[p + 1] = imdata[p + 2] = avg;
                    }
                }

                // Draw the warning layer if there is a global flag or
                // or a per-tab flag set.
                if (that.globalWarning || (tab !== null && all_warnings[tab.tabId])) {
                    that.warningCtx.drawImage(warningImg, 0, 0);
                    wData = that.warningCtx.getImageData(0, 0, w, h).data;
                    for (p = 0; p < wData.length; p += 4) {
                        a = wData[p + 3],
                        // the .5 dims it.
                        r = Math.floor(((255 - a) * imdata[p]     * 0.5 + a * wData[p])     / 255);
                        g = Math.floor(((255 - a) * imdata[p + 1] * 0.5 + a * wData[p + 1]) / 255),
                        b = Math.floor(((255 - a) * imdata[p + 2] * 0.5 + a * wData[p + 2]) / 255);
                        /* [p+3] is alpha */
                        imdata[p] = r;
                        imdata[p + 1] = g;
                        imdata[p + 2] = b;
                        imdata[p + 3] = 255;
                    }
                }

                chrome.browserAction.setIcon({
                    imageData: map
                });
            }
        });
    };

    UI.prototype.log = function () {
        var msg = [].slice.call(arguments).join(" ");
        this.logBuffer += msg + "\n";
        if (this._logHook) {
            this._logHook(this.logBuffer);
        }
    };

    UI.prototype.clearLog = function () {
        this.logBuffer = "";
        if (this._logHook) {
            this._logHook(this.logBuffer);
        }
    };

    UI.prototype.getProtectedStream = function () {
        return this.keyObj;
    };

    UI.prototype.setLogHook = function (hook) {
        this._logHook = hook;
        if (this._logHook) {
            this._logHook(this.logBuffer);
        }
    };

    var singleton = new UI();
    singleton.Prompt = Prompt;
    return singleton;
})();
