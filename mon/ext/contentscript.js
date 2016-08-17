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
  chrome, performance, CustomEvent,
  Fail, assertType, KH_TYPE, OneOf, _extends
  Promise, Text
*/

(function () {
    "use strict";

    /*
      Customize Console
    */
    function _csPrefix(old) {

        function getErr() {
            try { throw Error(""); } catch (err) { return err; }
        }

        return function () {
            var args = Array.prototype.slice.apply(arguments);
            if (!args) {
                args = [];
            }
        
            var err = getErr();
            var caller_line = err.stack.split("\n")[4];
            var index = caller_line.indexOf("at ");
            var clean = caller_line.slice(index + 2, caller_line.length);

            return old.apply(this, ["%c[BEESWAX CS]", "color: green", clean].concat(args));
        };
    }
    /*console.log   = _csPrefix(console.log);
    console.error = _csPrefix(console.error);
    console.debug = _csPrefix(console.debug);
    console.warn  = _csPrefix(console.warn);*/

    console.log("init");


    /**
     * NOTE: The communication channels between the page and the
     *       background page need some refactoring. It is currently
     *       cumbersome to have the background page call into the
     *       content script.
     *
     *       The code implicitly assumes the following flow:
     *
     *       page -> forehandler -> background page -o
     *                                               |
     *       page <- backhandler <-------------------o
     *
     *       Rather than have a notion between forehandlers and
     *       backhandlers, we should have the content script define a
     *       clear API, and have API entry points return to whatever
     *       their caller was (instead of an implicit direction).
     *
     *       Some calls only have a forehandler, some only a
     *       backhandler, and the code relies on return values to
     *       determine when to shortcut parts of the path. It is hard
     *       to follow.
     */

    var pareas = {};

    // Key objects not stored in the background. These keys are stored in memory
    // and are local to the content script. They are indexed by keyid.
    var localKeys = {};

    // Set up communication channels with extension's background script and app
    var CRYPTO_PAGE_TO_CS = "_beeswax_crypto_page_to_cs";
    var CRYPTO_CS_TO_PAGE = "_beeswax_crypto_cs_to_page";

    var htmlElem = document.documentElement;
    var crypto_cs_to_page_event = document.createEvent("Event");

    crypto_cs_to_page_event.initEvent(CRYPTO_CS_TO_PAGE, false, false);

    var csCryptoToExtPort = chrome.extension.connect({name: "csToBg"});

    var PRIVATE_ID_PROP = 'micasa-private-id';
    var PRIVATE_HOST_CS_PROP = 'micasa-private-host-cs';

    /*
      RPC endpoints from contentscript to BG
      function ({cmd: X params: Y}) -> returns promise.
    */
    var bgCryptoRPC;

    /* We get notified when the privacy indicator toggles */
    var protectedKeyid = null; // keyid


    function injectScriptURL(url, isDebug) {
        var injectScript = null;

        isDebug = isDebug || false;

        // inject the crypto api in the page
        injectScript = document.createElement("script");
        injectScript.setAttribute("type", "text/javascript");
        if (!isDebug) {
            var injectXHR = new XMLHttpRequest();
            injectXHR.open("GET", url, false);
            injectXHR.send(null);
            injectScript.textContent = injectXHR.responseText;
            htmlElem.appendChild(injectScript);
            htmlElem.removeChild(injectScript);
        } else {
            injectScript.setAttribute("src", url);
            htmlElem.appendChild(injectScript);
        }
    }
    
    var csCallIDs = {};
    var csCallIDSerial = 0;

    function HighlightPlugin(params) {
        this.re = params.re || "[*][^*][*]";
    }

    HighlightPlugin.prototype._toNode = function (s, isDelim) {
        if (isDelim) {
            var b = document.createElement("b");
            b.innerText = s;
            return b;
        } else {
            return new Text(s);
        }
    };

    HighlightPlugin.prototype.run = function (elt) {

        var r = new RegExp(this.re);
        var s = elt.textContent;
        var newChildren = [];
        var that = this;
        var idx = s.search(r);

        function f(tok, isDelim) {
            newChildren.push(that._toNode(tok, isDelim));
        }

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
        
        elt.textContent = "";
        var i;
        for (i = 0; i < newChildren.length ; i++) {
            elt.appendChild(newChildren[i]);
        }
    };

    function PArea(hostEl, initEl) {
        this.host = hostEl;
        this.el = initEl;
    }

    PArea.prototype = {
        get areaNumber() {
            return getAreaNumber(this.host);
        },

        get keyid() {
            return getKeyid(this.host);
        },

        //
        // Generate the UI for the PArea, under this.el.
        // return the root element of the PArea's UI.
        render: function () {

            // generate contents of this.el
            /// ...

            // return the content
            return this.el;
        },

        // Displays the plaintext into the DOM.
        //
        setContent: function (/*plainText*/) {
            throw new Fail(Fail.GENERIC, "subclass must override setContent");
        },

        // Retrieves a blob containing all the plaintext in the private area
        // Opposite of setContent().
        getContent: function () {
            throw new Fail(Fail.GENERIC, "subclass must override getContent");
        }
    };

    function EltArea(/* hostEl, initEl */) {
        PArea.apply(this, arguments);
    }
    _extends(EltArea, PArea, {
        setContent: function (plainText) {
            if (this.el.tagName === "INPUT" || this.el.tagName === "TEXTAREA") {
                this.el.value = plainText;
            } else {
                this.el.innerText = plainText;
            }
            /*something for twistor messages maybe 
             this.messages = [];
             setContent: function (data){ 
              if (messages.length === 10) {
                 messages.pop();
                 messages.unshift(data);
              } else messages.unshift(data);
              var val = "";
              for (var i=0; i <messages.length; i++) {
              val= val + messages[i] + "\n";
              }
              text.value = val.trim();
             }*/
        },

        getContent: function () {
            return this.el.value;
        }
    });

    function SelectArea(hostEl, select) {
        PArea.apply(this, arguments);
        this.el.addEventListener("change", this.onChange.bind(this), true);
        this.el.addEventListener("click", this.onClick.bind(this), true);
    }
    _extends(SelectArea, PArea, {

         getContent: function() {
            //return this.el.value;
            var selected = [];
            var k;
            var selectedDict = getSelected();
            for (k in selectedDict) {
                if (selectedDict[k]) {
                    selected.push(k);
                }
            }
            return selected;
         },

         render: function() {
            return this.el;
         },

         onClick: function (evt) {
            if (evt) {
                evt.preventDefault();
            }

         },

         onChange: function (evt) {
            if (evt) {
                evt.preventDefault();
            }

            var selected = this.getSelected();           
            var keyid = this.keyid;
            var keyObj = localKeys[keyid];

            bgCryptoRPC({cmd: "update_priv_ind_anon", params: {type: "change", keyObj: {typ: "anon", principals: selected, keyid: keyid}, val:true}}).then(function (/* result */) {
                console.debug("Triggered select choice.");
                keyObj.principals = selected;
            }).catch(function (err) {
                console.error("Failed to update private indicator for select area event.", err);
            });
         },

         getSelected: function() {
            var selected = {};
            for (var i=0; i<this.el.options.length; i++) {
                if(this.el.options[i].selected) {
                    var selectedVal = this.el.options[i].value || this.el.options[i].text;
                    selected[selectedVal] = true;
                }
            }
            return selected;
         }
    });

    function ImageArea(hostEl, img) {
        var div = document.createElement("div");
        PArea.call(this, hostEl, div);
        this.img = img;
        this.chooser = null;
        this.isSet = false;
        this.el.addEventListener("click", this.onClick.bind(this), true);
    }
    _extends(ImageArea, PArea, {
        getContent: function () {
            if (!this.isSet) {
                // Has not yet been set. This prevents the initiator from
                // setting an initial picture to be encrypted (chosen
                // plaintext attack)
                console.log("Getting content from image but has not been set yet.");
                return "";
            }

            return this.img.src || "";
        },

        setContent: function (plain, notifyChange) {
            notifyChange = !!notifyChange;
            if (!plain || plain.length < 1) {
                console.log("Image area no content to be set.");
                return;
            } else {
                this.img.src = plain;
                this.isSet = true;
            }

            if (notifyChange === true) {
                var evt = new CustomEvent('change', {cancelable: false, bubbles: true});
                this.host.dispatchEvent(evt);
            }
        },

        render: function () {
            if (this.img.getAttribute("width") <= 0) {
                this.img.setAttribute("width", 500);
            }

            if (this.img.getAttribute("height") <= 0) {
                this.img.setAttribute("height", 500);
            }

            this.el.appendChild(this.img);
            if (!this.chooser) {
                this.chooser = document.createElement("input");
            }
            this.chooser.setAttribute("type", "file");
            this.chooser.setAttribute("style", "display: none;");
            this.chooser.addEventListener("change", this.onFileChange.bind(this), true);
            return this.el;
        },

        onFileChange: function (evt) {
            var that = this;

            if (evt) {
                evt.preventDefault();
            }

            var files = evt.target.files; // FileList object
            var f = files[0];

            if (!f) {
                return;
            }

            if (/^image\//.exec(f.type) === null) {
                console.log("Not an image: " + f.type);
                return;
            }

            //console.log("ImageArea file-type", f.type, "size", f.size, "name", f.name);

            var reader = new FileReader();
            reader.onload = function (e) {
                var x = e.target.result;
                that.setContent(x, true);
            };
            reader.readAsDataURL(f);
        },

        onClick: function (evt) {
            var that = this;

            if (evt) {
                evt.preventDefault();
            }

            
            var keyid = this.keyid;

            bgCryptoRPC({cmd: "update_priv_ind", params: {type: "filechooser", keyid: keyid, val: true}}).then(function (/* result */) {
                console.debug("Triggered file choice.");
                that.chooser.click();
            }).catch(function (err) {
                console.error("Failed to update private indicator for image area event.", err);
            });
        }
    });

    //function for hooking listeners that just do message passthrough
    function hookListener(eventNameIn, eventNameOut, pageEvent, csPort, forehandlers, backhandlers) {

        function sendMsgOut(msg) {
            if (msg.times) {
                msg.times.csout = performance.now();
            }

            if (msg instanceof Object) {
                msg = JSON.stringify(msg);
            }
            htmlElem.setAttribute(eventNameOut, msg);
            htmlElem.dispatchEvent(pageEvent);
        }

        var recv_from_page = function (/* evt */) {
            var msgStr = htmlElem.getAttribute(eventNameIn);
            htmlElem.removeAttribute(eventNameIn);
            var msg = JSON.parse(msgStr);
            if (msg.times) {
                msg.times.csin = performance.now();
            }
            var handler = forehandlers[msg.cmd];
            if (handler) {
                try {
                    msg = handler(msg);
                } catch (err) {
                    var errjson = Fail.toRPC(err);
                    console.debug("Err.", errjson, err.stack);
                    sendMsgOut({callid: msg.callid, error: errjson});
                    return;
                }
                    
                if (msg.cmd === "nobg") {
                    //if the forehandler doesn't need to talk to the background page
                    sendMsgOut({callid: msg.callid, result: msg.result});
                    return;
                }
            }

            // Translate callids. Page callid -> CS callid
            var serial = csCallIDSerial++;
            csCallIDs[serial] = {fromPage: true, callid: msg.callid, cmd: msg.cmd, params: msg.params};
            msg.callid = serial;
            csPort.postMessage(msg);
        };

        csPort.onMessage.addListener(function (resp) {
            var cscallid = resp.callid;
            var cscallinfo = csCallIDs[cscallid];
            var handler = null;

            if (cscallid === null) {
                // call from bg
                if (resp.bgcallid !== undefined) {

                    // promise-based mechanism
                    handler = CSAPI[resp.cmd];
                    handler(resp.params).then(function (result) {
                        delete resp.error;
                        resp.result = result;
                        csPort.postMessage(resp); // send it back
                    }).catch(function (err) {
                        delete resp.result;
                        resp.error = Fail.toRPC(err);
                        console.error("ERR:", err);
                        csPort.postMessage(resp);
                    });
                    return;

                } else {
                    // forward method. pass result to page.

                    handler = backhandlers[resp.cmd];
                    if (handler) {
                        resp = handler(resp);
                        if (resp !== null) {
                            sendMsgOut(resp);
                        }
                    }
                    return;
                }
            }
  
            if (cscallinfo === undefined) {
                console.error("Already handled response for cscallid", cscallid, resp);                
                return;
            }

            delete csCallIDs[cscallid];

            if (cscallinfo.fromPage) {

                // Translate back CS callid -> Page callid
                resp.callid = cscallinfo.callid;

                // restore cmd and params (as they were on return from the forehandler)
                resp.params = cscallinfo.params;
                handler = backhandlers[cscallinfo.cmd];
                if (handler) {
                    //do some work and transform the response
                    resp = handler(resp);
                }

                sendMsgOut(resp);

            } else {

                // RPC initiated in contentscript
                if (resp.error) {
                    console.error('BG Call failed:', resp);
                    return cscallinfo.reject(Fail.fromVal(resp.error));
                } else {
                    return cscallinfo.resolve(resp.result);
                }
            }
        });

        csPort.onDisconnect.addListener(function (/* port */) {
            htmlElem.removeEventListener(eventNameIn, recv_from_page);
            console.log("Port disconnected. External monitor inactive on this page.");
        });

        htmlElem.addEventListener(eventNameIn, recv_from_page);

        function doBGRPC(msg) {
            // Translate callids. Page callid -> CS callid
            return new Promise(function (resolve, reject) {
                var serial = csCallIDSerial++;
                csCallIDs[serial] = {fromPage: false, resolve: resolve, reject: reject};
                msg.callid = serial;
                csPort.postMessage(msg);
            });
        }

        return doBGRPC;
    }

    function isPrivateHost(domElt) {
        return domElt.hasOwnProperty(PRIVATE_HOST_CS_PROP);
    }

    function getAreaNumber(domElt) {
        var num = domElt[PRIVATE_HOST_CS_PROP];
        if (num === undefined) {
            num = domElt[PRIVATE_ID_PROP];
        }

        if (num === undefined) {
            return null;
        }
        return num;
    }

    function getKeyid(domElt) {
        var num = getAreaNumber(domElt);
        if (!num) {
            return null;
        }
        return pareas[num].keyhandle.keyid;
    }

    function getParea(domElt) {
         var num = getAreaNumber(domElt);
         if (!num) {
            return null;
         }
         return pareas[num].parea;
    }

    function brandPrivateHost(node, number) {
        // All light DOM hosts are marked as such.
        // This needs to be done in the contentscript too.
        Object.defineProperty(node, PRIVATE_HOST_CS_PROP, {
            configurable: false,
            enumerable: false,
            value: number,
            writable: false
        });
    }

    function brandPrivateElt(node, number) {
        // All private nodes are marked as such.
        // This needs to be done in the contentscript too.
        Object.defineProperty(node, PRIVATE_ID_PROP, {
            configurable: false,
            enumerable: false,
            value: number,
            writable: false
        });
    }

    function isPrivateElt(domElt) {
        return domElt && domElt[PRIVATE_ID_PROP] !== undefined;
    }

    // Mark tree
    function brandPrivateTree(root, areaNumber) {
        var i;
        if (isPrivateElt(root)) {
            return;
        }
        brandPrivateElt(root, areaNumber);
        for (i = 0; i < root.childNodes.length; i++) {
            brandPrivateTree(root.childNodes[i], areaNumber);
        }
    }

    // takes an element found inside a shadow host and creates a DOM
    // subtree of a suitable representation.
    function createPrivateSubtree(hostElt, elt) {
        if (elt.tagName === "IMG") {
            return new ImageArea(hostElt, elt.cloneNode(false));
        } else if (elt.tagName === "SELECT") {
            return new SelectArea(hostElt, elt.cloneNode(true));

        } else {
            return new EltArea(hostElt, elt.cloneNode());
        }
    }

    //dictionaries of handlers for DOM manipulations
    //handlers that go before background call
    var sdom_forehandlers = {

        // For benchmarking only
        encrypt_node: function (opts) {
            var params = opts.params;

            assertType(params, {
                domid: "",
                keyhandle: OneOf(KH_TYPE, "")
            });

            var node = document.getElementById(params.domid);
            var keyhandle = params.keyhandle;
            var text = node.value;
            if (!node) {
                throw new Fail(Fail.INVALIDPAREA, "Can't find node.");
            }

            params.plaintext = text;
            params.keyhandle = keyhandle;
            opts.cmd = "encrypt_aes";

            return opts;
        },

        exec_plugin: function (opts) {
            var params = opts.params;

            assertType(params, {
                parent: 0,
                name: "",
                params: {}
            });

            console.log("Running plugin:", params);

            //obviously we can't lighten something that's not a private area
            if (!pareas[params.parent]) {
                //TODO do something intelligent
                throw new Fail(Fail.INVALIDPAREA, "parent provided not found");
            }

            var pluginClass = {
                'highlight': HighlightPlugin,
            }[params.name] || null;

            if (!pluginClass) {
                throw new Fail(Fail.NOENT, "No plugin named: " + params.name);
            }

            var parea = pareas[params.parent].area;
            var plugin = new pluginClass(params.params);

            plugin.run(parea.el);

            // Skip message to background page with nobg.
            // Allows RPC to be synchronous with the page.
            return {cmd: "nobg", callid: opts.callid, result: true, times: opts.times};
        },

        mark_private: function (opts) {
            try {
              return sdom_forehandlers._mark_private(opts);
            } catch (err) {
                console.error("mark_private caught error" + err + " stack: " + err.stack);
                throw err;
            }
        },

        _mark_private: function (opts) {
            var params = opts.params;
            
            assertType(params, {
                parent: 0,
                keyhandle: OneOf(KH_TYPE, "")
            });

            var keyhandle = ((typeof params.keyhandle) === "string") ? {keyid: params.keyhandle} : params.keyhandle;
            var areaNumber = params.parent;
            var domQuery = "[data-micasa-lookup='" + areaNumber + "']";
            var shost = document.querySelector(domQuery);


            function privateInputHooks(root, keyid) {
                function keyboardHandler(evt) {
                    if (evt.target && isPrivateElt(evt.target)) {
                        // update private indicator 
                        bgCryptoRPC({cmd: "update_priv_ind", params: {type: "keyboard", keyid: keyid, val: true}}).then(function (/* result */) {
                            console.debug("Enabled Keyboard indicator.");
                        }).catch(function (err) {
                            console.error("Failed to update private indicator for keyboard event.", err);
                        });
                       
                    } else {
                        console.error("Received keyboard event on shadow root for a non private element!");
                        bgCryptoRPC({cmd: "_maim", params: {}}).catch(function (err) {
                            console.error("Failed to maim context.", err);
                        });
                    }
                }
        
                function mouseHandler(evt) {
                    if (evt.target && isPrivateElt(evt.target)) {
                        // update private indicator
                           bgCryptoRPC({cmd: "update_priv_ind", params: {type: "mouse", keyid: keyid, val: true}}).then(function (/* result */) {
                              console.debug("Enabled Mouse indicator.");
                           }).catch(function (err) {
                              console.error("Failed to update private indicator for mouse event.", err);
                           });
                    } else {
                        console.error("Received mouse event on shadow root for a non private element!");
                        bgCryptoRPC({cmd: "_maim", params: {}}).catch(function (err) {
                            console.error("Failed to maim context.", err);
                        });
                    }
                }

                function keyboardHandlerAnon(evt) {
                    if (evt.target && isPrivateElt(evt.target)) {
                        var anonKeyObj = localKeys[keyid];
                        bgCryptoRPC({cmd: "update_priv_ind_anon", params: {type: "keyboard", keyObj: anonKeyObj, val:true}}).then(function (/* result */) {
                          console.debug("Enabled Keyboard indicator.");
                        }).catch(function (err) {
                              console.error("Failed to update private indicator for keyboard event.", err);
                        });
                    } else {
                        console.error("Received keyboard event on shadow root for a non private element!");
                        bgCryptoRPC({cmd: "_maim", params: {}}).catch(function (err) {
                            console.error("Failed to maim context.", err);
                        });
                    }
                }

                function mouseHandlerAnon(evt) {
                   if (evt.target && isPrivateElt(evt.target)) {
                        var anonKeyObj = localKeys[keyid];
                        bgCryptoRPC({cmd: "update_priv_ind_anon", params: {type: "mouse", keyObj: anonKeyObj, val:true}}).then(function (/* result */) {
                          console.debug("Enabled Mouse indicator.");
                        }).catch(function (err) {
                              console.error("Failed to update private indicator for mouse event.", err);
                        });
                    } else {
                        console.error("Received mouse event on shadow root for a non private element!");
                        bgCryptoRPC({cmd: "_maim", params: {}}).catch(function (err) {
                            console.error("Failed to maim context.", err);
                        });
                    } 
                }


                if (decodeURIComponent(keyid.split(":")[0]) === "anon") {
                    root.addEventListener("keyup", keyboardHandlerAnon, true);
                    root.addEventListener("keydown", keyboardHandlerAnon, true);
                    root.addEventListener("keypress", keyboardHandlerAnon, true);
                    root.addEventListener("click", mouseHandlerAnon, true);
                } else {
                    root.addEventListener("keyup", keyboardHandler, true);
                    root.addEventListener("keydown", keyboardHandler, true);
                    root.addEventListener("keypress", keyboardHandler, true);
                    root.addEventListener("click", mouseHandler, true);
                }
            }

            // Can't find the element
            if (shost === null) {
                throw new Fail(Fail.INVALIDPAREA, "Can't find node.");
            }

            if (pareas[areaNumber] || isPrivateHost(shost)) {
                //TODO do something intelligent
                throw new Fail(Fail.INVALIDPAREA, "parent already exists");
            }

            if (isPrivateElt(shost)) {
                console.error("Private Node Leaked. Fatal.");
                throw new Fail(Fail.INVALIDPAREA, "Node is a private node. This is bad.");
            }

            brandPrivateHost(shost, areaNumber);

            var child = shost.children[0];
            var sroot = shost.createShadowRoot();


            privateInputHooks(sroot, keyhandle.keyid);

            var parea = createPrivateSubtree(shost, child);

            //keep track of the private field and the key associated with it
            pareas[areaNumber] = {area: parea, keyhandle: keyhandle};

            // render private area UI
            sroot.appendChild(parea.render());
            
            // mark all nodes in the parea and the shadowroot
            brandPrivateTree(sroot, areaNumber);

            //brandPrivateTree(parea.el, areaNumber); // redundant

            // Skip message to background page with nobg.
            // Allows RPC to be synchronous with the page.
            return {cmd: "nobg", callid: opts.callid, result: true, times: opts.times};
        },

        //like lighten, but returns an array of encrypted objects
        lighten_multiple: function (opts) {
            var params = opts.params;
            //console.log("Entered lighten forehandler");

            //obviously we can't lighten something that's not a private area
            if (!pareas[params.parent]) {
                //TODO do something intelligent
                throw new Fail(Fail.INVALIDPAREA, "parent provided not found");
            }

            var parea = pareas[params.parent].area;


            var keyhandle = pareas[params.parent].keyhandle;

            if (!(parea instanceof EltArea) || !localKeys[keyhandle.keyid]) {
                throw new Fail(Fail.INVALIDPAREA, "invalid lighten_multiple area");
            }

            params.plaintext = parea.getContent();
            var principals = [];
            var k;
            for (k in localKeys[keyhandle.keyid].principals) {
                if ((localKeys[keyhandle.keyid].principals)[k]) {
                    principals.push(k);
                }
            }
            params.principals = principals;

            opts.cmd = "encrypt_elGamal";
            opts.params = {principals: params.principals, plaintext: params.plaintext};
            return opts;
        },

        lighten: function (opts) {
            var params = opts.params;
            //console.log("Entered lighten forehandler");

            //obviously we can't lighten something that's not a private area
            if (!pareas[params.parent]) {
                //TODO do something intelligent
                throw new Fail(Fail.INVALIDPAREA, "parent provided not found");
            }

            var parea = pareas[params.parent].area;

            var keyhandle = pareas[params.parent].keyhandle;

            params.plaintext = parea.getContent();
            params.keyhandle = keyhandle;

            opts.cmd = "encrypt_aes";

            return opts;
        },

        darken_elGamal: function(opts) {
           var params = opts.params;

            //obviously we can't darken into something that's not a private area
            if (!pareas[params.parent]) {
                //TODO do something intelligent
                throw new Fail(Fail.INVALIDPAREA, "parent provided not found");
            }

            var keyhandle = pareas[params.parent].keyhandle;

            params.keyhandle = keyhandle;

            return opts;
        },

        //opts.params.ciphertext assumed to have been passed by in-page crypto layer
        darken: function (opts) {
            var params = opts.params;
            //console.log("Entered darken forehandler");

            //obviously we can't darken into something that's not a private area
            if (!pareas[params.parent]) {
                //TODO do something intelligent
                throw new Fail(Fail.INVALIDPAREA, "parent provided not found");
            }

            var keyhandle = pareas[params.parent].keyhandle;

            params.keyhandle = keyhandle;
            return opts;
        }
    };

    var CSAPI = {
        ui_protection_change: function (params) {
            protectedKeyid = params.keyid;
            return Promise.resolve(null);
        },

        // tweet posting needs to be done in the context of the content script not the background
        //
        // resolves the status code
        // rejects a PUBSUB error or a GENERIC error if the call can't be made
        post_public: function (opts) {
            return new Promise(function (resolve, reject) {

                var tweet = opts.tweet;
                var token = opts.authToken;
                var tpost = new XMLHttpRequest();

                var url = "https://twitter.com/i/tweet/create";
                tpost.open("POST", url, true);
                tpost.setRequestHeader("Content-type", "application/x-www-form-urlencoded");
                
                var postData = "authenticity_token=" + encodeURIComponent(token) + "&status=" + encodeURIComponent(tweet);
                console.debug("Generated post: ", postData, " LENGTH: ", postData.length);

                tpost.onreadystatechange = function () {
                    if (tpost.readyState === 4) {
                        if (tpost.status >= 200 && tpost.status <= 300) {

                            //console.log("Posting tweet succeeded", tpost.responseText);
                            return resolve(tpost.responseText);
                        } else {
                            console.error("Failed to post a tweet:", tpost.status, tpost.responseText);
                            return reject(new Fail(Fail.PUBSUB, "Failed to post tweet. Status=" + tpost.status + " Message: " + tpost.responseText));
                        }
                    }
                };

                tpost.onerror = function () {
                    console.error("Prolem posting tweets.", [].slice.apply(arguments));
                    return reject(new Fail(Fail.GENERIC, "Failed to post tweet."));
                };

                tpost.send(postData);
            });
        },

        get_stream: function (opts) {
            return new Promise(function (resolve, reject) { 

                var StreamParser = function StreamParser() {
                    this.buffer = '';              
                    return this;
                };

                StreamParser.END        = '\r\n';
                StreamParser.END_LENGTH = 2;

                StreamParser.prototype.receive = function receive(buffer) {
                    this.buffer += buffer.toString('utf8');
                    var index, json;

                    // We have END?
                    while ((index = this.buffer.indexOf(StreamParser.END)) > -1) {
                        json = this.buffer.slice(0, index);
                        this.buffer = this.buffer.slice(index + StreamParser.END_LENGTH);
                        if (json.length > 0) {
                            try {
                                json = JSON.parse(json);
                                console.log(json);
                                return json.text;
                            } catch(error) {
                                console.error('ERR', error);
                            }
                        }
                    }
                };

                var streamParser = new StreamParser();          
                var consumerKey = "rq5Jbae2HuhvT5LGSbWq6Wdue";
                var consumerSecret = "Va9oHgMPZX3e9EDgGfwXZ9kFiKBOxJovb6SLBFCWAYoMN7tkK7";
                var accessToken = "738445087823171584-oFyetz0VlgRR2RY3YmDjvhaKHKQhUC5";
                var accessSecret = "rhNYnNxw6bVrPH8gqwRrRhEEH4EnBWx22gffcQTaLYh5d";
                var signingKey = consumerSecret + "&" + accessSecret;

                var SIGNATURE_METHOD = "HMAC-SHA1";
                var SIGNATURE_METHOD_URL = "%26oauth_signature_method%3DHMAC-SHA1";

                var OAUTH_VERSION = "1.0";
                var OAUTH_VERSION_URL = "%26oauth_version%3D1.0";

                var STREAM_BASE_STRING = "POST&https%3A%2F%2Fstream.twitter.com%2F1.1%2Fstatuses%2Ffilter.json&" + encodeURIComponent("oauth_consumer_key=" + consumerKey);
                var NONCE_LENGTH = 32;

                var nonceGenerator = function(length) {
                    var text = "";
                    var possible = "abcdef0123456789";
                    for(var i = 0; i < length; i++) {
                        text += possible.charAt(Math.floor(Math.random() * possible.length));
                    }
                    return text;
                }

                var oauth_nonce = encodeURIComponent(nonceGenerator(NONCE_LENGTH));
                var oauth_nonce_url = "%26oauth_nonce%3D" + oauth_nonce;

                var oauth_timestamp = encodeURIComponent(parseInt((new Date().getTime())/1000));
                var oauth_timestamp_url = "%26oauth_timestamp%3D" + oauth_timestamp;

                var signature_base_string = STREAM_BASE_STRING + oauth_nonce_url + SIGNATURE_METHOD_URL + oauth_timestamp_url + "%26oauth_token%3D" + accessToken +  OAUTH_VERSION_URL + "%26track%3Dtwistor";

                var oauth_signature = Utils.hmac_sha1(signingKey, signature_base_string);
                
                var header_string = 'OAuth oauth_consumer_key="' + consumerKey + '", oauth_nonce="' + oauth_nonce + '", oauth_signature="' + encodeURIComponent(oauth_signature) + '", oauth_signature_method="' + SIGNATURE_METHOD + '", oauth_timestamp="' + oauth_timestamp + '", oauth_token="' + accessToken + '", oauth_version="' + OAUTH_VERSION + '"';
                console.log("header string, ", header_string);
                console.log("getting stream");
                var tpost = new XMLHttpRequest();

                var url = 'https://stream.twitter.com/1.1/statuses/filter.json';
                tpost.open("POST", url, true);
                tpost.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
                tpost.setRequestHeader("Authorization", header_string);
                var postData = "track=twistor";
                var index = 0;
                var stream_buffer = '';
                
                tpost.onreadystatechange = function () {
                    if (tpost.readyState > 2)  {
                        if (tpost.status >= 200 && tpost.status <= 300) {
                            console.log("Streaming succeeded");

                            stream_buffer = tpost.responseText.substr(index);

                            while (stream_buffer[0] === "\n" || stream_buffer[0] === "\r") {
                                stream_buffer = stream_buffer.substr(1);
                            }
                            var chunk = '';                       
                            var tweets = [];

                            //check if we received multiple tweets in one process chunk
                            while ((stream_buffer[0] !== '\n' || stream_buffer[0] !== '\r') && stream_buffer.length != 0) {
                                index += stream_buffer.indexOf('\n');
                                tweets.push(streamParser.receive((stream_buffer.substr(0,index)));
                                //opts.stream.newTweet(streamParser.receive((stream_buffer.substr(0,tweet_end)));
                                stream_buffer = stream_buffer.substr(index+1);
                            }

                            opts.stream.newTweet(tpost.responseText);
                            if (tweets.length === 10) return resolve(tweets);
                            //return resolve(new_tweet_text);
                        } else {
                            console.error("Failed to stream:", tpost.status, tpost.responseText);
                            return reject(new Fail(Fail.PUBSUB, "Failed to stream. Message: " + tpost.responseText + "status " + tpost.status +" header string, " + header_string + " base url, " + signature_base_string));
                        }
                    }
                };

                tpost.onerror = function () {
                    console.error("Problem streaming.", [].slice.apply(arguments));
                    return reject(new Fail(Fail.GENERIC, "Failed to stream."));
                };

                tpost.send(postData);
            });
        }
    };
        

    //handlers that come after background call
    var sdom_backhandlers = {
        darken_elGamal: function (opts) {
            var params = opts.params;
             
            // if the parea doesn't exist, complain
            if (!pareas[params.parent]) {
                //TODO do something intelligent
                return {callid: opts.callid, error: Fail.toRPC({code: Fail.INVALIDPAREA, message: "parent provided not found"})};
            }

            var parea = pareas[params.parent].area;
            console.log("darkening the area");
            parea.setContent(opts.result);

            return {callid: opts.callid, result: true};
        },

        darken: function (opts) {
            var params = opts.params;
             
            // if the parea doesn't exist, complain
            if (!pareas[params.parent]) {
                //TODO do something intelligent
                return {callid: opts.callid, error: Fail.toRPC({code: Fail.INVALIDPAREA, message: "parent provided not found"})};
            }

            var parea = pareas[params.parent].area;
            parea.setContent(opts.result);

            return {callid: opts.callid, result: true};
        },

        // background generates a message to be sent to the application
        ext_message: function (opts) {
            // just pass the message along.
            return {extcallid: opts.extcallid, msg: opts.msg};
        },

        new_anon_stream: function (opts) {
            if (opts.result) {
                // successful -- keep track of principals in the content script.
                var keyid = opts.result;
                localKeys[keyid] = {typ: "anon", principals: {}, keyid: keyid};
            }
            return opts;
        }
    };


    //hook up the events that just do passthrough
    bgCryptoRPC = hookListener(CRYPTO_PAGE_TO_CS, CRYPTO_CS_TO_PAGE, crypto_cs_to_page_event, csCryptoToExtPort, sdom_forehandlers, sdom_backhandlers);

    var extDebug = false;
    var queryParams = document.location.search.substr(1).split("&");
    for (var parami in queryParams) {
        if (queryParams.hasOwnProperty(parami)) {
            if (queryParams[parami].toUpperCase() === "MDBG=1" ||
                queryParams[parami].toUpperCase() === "MDBG=TRUE") {
                extDebug = true;
                break;
            }
        }
    }
    var ts = new Date().getTime();


    function makeEventFilter(evtType) {

        return function keypressHandler(evt) {
            //console.log("evt.type", evt.type);

            // Sanity check
            if (!evt.target || isPrivateElt(evt.target)) {
                console.log("Receiving events for private elements directly on window. Bad.");
                bgCryptoRPC({cmd: "_maim", params: {}}).catch(function (err) {
                    console.error("Failed to maim context.", err);
                });
                evt.preventDefault();
                return;
            }


            if (!protectedKeyid) {
                // not protected at the moment
                return;
            }

            if (!isPrivateHost(evt.target)) {
                // Getting an event outside a protected area.
                console.debug("" + evtType + " event in unprotected area while protection is enabled. Cancelling event.");
                if (!evt.cancelable) {
                    console.error("Event of type " + evtType + " cancel failed.", evt);
                }
                evt.preventDefault();
                evt.stopImmediatePropagation();
                return;
            }

            if (protectedKeyid !== getKeyid(evt.target)) {
                // Getting an event for a control outside the current conversation.
                console.debug("" + evtType + " event in different private area. Cancelling event.");
                if (!evt.cancelable) {
                    console.error("Event of type " + evtType + " cancel failed.", evt);
                }
                evt.preventDefault();
                evt.stopImmediatePropagation();
                return;
            }

            /* else {
               We have an event either directly on a private host, or
               within it. We can't tell for sure from the event handler on
               the window. If the event is for a Node inside the private
               area, the handler on the shadowroot will be invoked (later),
               otherwise the propagation will stop here.

               The page runtime will still filter out content fields for
               events on hosts.  So we can safely let this event slide
               without cancelling it.  }
            **/

        };
    }

    window.addEventListener("keypress", makeEventFilter("keypress"), true);
    window.addEventListener("keydown", makeEventFilter("keydown"), true);
    window.addEventListener("keyup", makeEventFilter("keyup"), true);
    window.addEventListener("click", makeEventFilter("click"), true);

    injectScriptURL(chrome.extension.getURL("pageapi/runtime.js"), extDebug);
    console.log("Runtime loaded in", (new Date().getTime()) - ts, "ms");
})();
