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
  chrome, Promise,
  ECCPubKey
*/

function getHost(url) {
    "use strict";

    var a =  document.createElement('a');
    a.href = url;
    return a.host;
}

var BG = chrome.extension.getBackgroundPage();
var $ = BG.$;
var $doc = $(document);
var Vault = BG.Vault;
var API = BG.API;
var UI = BG.UI;
var Utils = BG.Utils;

function onUsernameChange(evt) {
    "use strict";

    evt.preventDefault();

    var $selection = $doc.find("#userselect");
    var username = $selection.val();
    if (Vault.getAccount(username) === null) {
        return;
    }

    if (username.length > 0) {
        Vault.setUsername(username);
        $(evt.target).find("input,button").removeAttr("disabled");
    }
    log("changed username to", username);
    API.accountChanged(username);

    render();
}

function getInputCtx() {
    "use strict";

    var $select = $doc.find("#contextselect");
    var selection = $select.val();
    if (!selection || isNaN(parseInt(selection, 10))) {
        return null;
    }

    var ctx = BG.CryptoCtx.all[parseInt(selection, 10)];
    if (ctx !== undefined) {
        return ctx;
    } else {
        return null;
    }
}

function onMessageSubmit(evt) {
    "use strict";

    if (evt) {
        evt.preventDefault();
    }

    var $msg = $doc.find("#messageinput");
    var msg = $msg.val().trim();
    $msg.val("");
    var ctx = getInputCtx();
    if (!ctx) {
        alert("invalid context selected");
        return;
    }

    function displayAns(ans) {
        if (ans instanceof Error) {
            log("ERROR:", ans.message, ans.stack);
            return;
        }
        try {
            var json = JSON.stringify(ans);
            log(json);
            return;
        } catch (err) {}
        log(ans + "");
    }

    if (msg.length < 1) {
        return;
    }
    if (msg[0] === "{") {
        var obj = JSON.parse(msg);
        var engine = ctx.kapEngine;
        engine.send(obj);
    } else {
        var lst = msg.split(/\s+/);
        var cmd = lst[0];
        var args = lst.slice(1);

        if (!ctx[cmd]) {
            log("ERROR: no such context command:", cmd);
            return;
        }

        ctx[cmd].apply(ctx, args).then(function (x) {
            console.log("window.ans:", x);
            window.ans = x;
            displayAns(x);
            render();
        }).catch(function (err) {
            console.error("window.ans:", err);
            window.ans = err;
            displayAns(err);
            render();
        });
    }
}

function onClearClick() {
    "use strict";

    if (confirm("Are you sure you want to clear all settings? \n(you'll also have to reload the extension after)")) {
        API.clearStorage().then(function () {
            Vault.reset();
            render();
        }).catch(function (err) {
            alert("failed to clear:" + err);
        });
    }
}

function onCtxChange(evt) {
    "use strict";

    var ctx = getInputCtx();
    if (ctx) {
        console.log("Input context changed:", ctx, "stored in window.ctx");
        window.ctx = ctx;
    }
}
    
function getPrompts() {
    "use strict";

    return new Promise(function (resolve, reject) {
        // assumes a single tabId will be returned
        chrome.tabs.query({
            active: true,
            currentWindow: true
        }, function (tabs) {
            if (tabs.length < 1) {
                reject(new Error("no active tabs in this window"));
                return;
            }
            var prompts = UI.listPrompts(tabs[0]);
            resolve(prompts);
        });
    });
}

function getContexts() {
    "use strict";

    return new Promise(function (resolve, reject) {
        var ctxs = [];
        var ctx;

        // assumes a single tabId will be returned
        chrome.tabs.query({
            active: true,
            currentWindow: true
        }, function (tabs) {
            //console.log("TABS:", tabs);
            if (tabs.length < 1) {
                reject(new Error("no active tabs in this window"));
                return;
            }
            var tabId = tabs[0].id;
            for (var serial in BG.CryptoCtx.all) {
                if (BG.CryptoCtx.all.hasOwnProperty(serial)) {
                    ctx = BG.CryptoCtx.all[serial];
                    console.log(ctx, ctx.tabId, tabId);
                    if (ctx.tabId === tabId) {
                        ctxs.push(ctx);
                    }
                }
            }
            resolve(ctxs);
        });
    });
}

function renderPrompt(prompt) {
    "use strict";

    var template = "<li><span class='prompt-text'></span></li>";
    var $obj = $(template);
    prompt.actions.forEach(function (action) {
        $obj.append("<a style='margin: 2px' class='prompt-action' data-action='" + action + "'>" + action + "</a>");
    });
    $obj.find('.prompt-text').text(prompt.prompt);
    $obj.find('a.prompt-action').click(function (evt) {
        if (evt) {
            evt.preventDefault();
        }
        var action = evt.target.getAttribute('data-action');
        if (action) {
            console.debug("Dismissing prompt", prompt, "with action:", action);
            prompt.dismiss(action);
            render();
        }
    });
    return $obj;
}

function render() {
    "use strict";

    var currentUser = Vault.getUsername();
    var task = null;

    if (currentUser) {
        $doc.find("#activeusername").text(Vault.getUsername());
        $doc.find("#exportuser").removeClass("disabled");
        $doc.find(".kp-view[data-type=encrypt]").removeClass("disabled");
        $doc.find(".kp-view[data-type=sign]").removeClass("disabled");
        $doc.find(".kp-regen").removeClass("disabled");
        $doc.find(".kp-post[data-type=post-twitter]").removeClass("disabled");

        // status on background tasks
        task = API.distributeTasks[currentUser];
        $doc.find(".status[data-type=distribute]").text(task.status);
        $doc.find(".datetime[data-type=distribute][data-when=next]").text((task.nextRun === null) ? "N/A" : Utils.DateUtil.fromNow(task.nextRun));
        $doc.find(".datetime[data-type=distribute][data-when=last]").text((task.lastRun === null) ? "N/A" : Utils.DateUtil.fromNow(task.lastRun));
        task = API.validateTasks[currentUser];
        $doc.find(".status[data-type=validate]").text(task.status);
        $doc.find(".datetime[data-type=validate][data-when=next]").text((task.nextRun === null) ? "N/A" : Utils.DateUtil.fromNow(task.nextRun));
        $doc.find(".datetime[data-type=validate][data-when=last]").text((task.lastRun === null) ? "N/A" : Utils.DateUtil.fromNow(task.lastRun));
        
    } else {
        $doc.find("#activeusername").text("N/A");
        $doc.find("#exportuser").addClass("disabled");
        $doc.find(".kp-view[data-type=encrypt]").addClass("disabled");
        $doc.find(".kp-view[data-type=sign]").addClass("disabled");
        $doc.find(".kp-regen").addClass("disabled");
        $doc.find(".kp-post[data-type=post-twitter]").addClass("disabled");

        // status on background tasks
        $doc.find(".status[data-type=distribute]").text("-");
        $doc.find(".datetime[data-type=distribute][data-when=next]").text("N/A");
        $doc.find(".datetime[data-type=distribute][data-when=last]").text("N/A");
        $doc.find(".status[data-type=validate]").text("-");
        $doc.find(".datetime[data-type=validate][data-when=next]").text("N/A");
        $doc.find(".datetime[data-type=validate][data-when=last]").text("N/A");

    }

    // show information on current active stream
    var stream = UI.getProtectedStream();
    if (stream) {
        var shortDesc = Utils.keyidShortHex(stream.keyid);
        $doc.find(".streamid").text(shortDesc);
        $doc.find(".audience").text(UI.audienceLabel(stream));
    } else {
        $doc.find(".streamid").text("None");
        $doc.find(".audience").text("N/A");
    }

    getContexts().then(function (ctxs) {
        var ctx;
        var i;
        var value;
        var display;
        var $opt;
        var $select = $doc.find("#contextselect");

        $select.html("");
        if (ctxs.length < 1) {
            $select.attr("disabled", true);
            $select.html("<option value=''>No Contexts</option>");
            return;
        }

        for (i = 0; i < ctxs.length; i++) {
            ctx = ctxs[i];
            if (ctx.kr !== null) {
                display = ctx.app + " (kr: " + ctx.kr.name + " user: " + ctx.kr.username + " serial: " + ctx.serial + ")";
            } else {
                display = ctx.app + " (serial: " + ctx.serial + ")";
            }
            value = ctx.serial;
            $opt = $('<option value="' + value + '"></option>');
            $opt.text(display);
            $select.append($opt);
        }
        window.ctx = ctxs[0];
        $select.removeAttr("disabled");
    });

    getPrompts().then(function (prompts) {
        var i;
        var $promptList = $doc.find("#prompts");
        $promptList.html('');
        if (prompts.length < 1) {
            $promptList.append("<li><i>No alerts</i></li>");
        }
        for (i = 0; i < prompts.length; i++) {
            $promptList.append(renderPrompt(prompts[i]));
        }
    });

    function loadAccounts() {
        var users = Vault.getAccountNames();
        var i;
        var $select = $doc.find("#userselect");
        var $opt;
        if (users.length < 1) {
            $select.attr("disabled", true);
            $select.html("<option value=''>N/A</option>");
            return;
        }
        $select.html("");
        var defaultUser = Vault.getUsername();
        for (i = 0; i < users.length; i++) {
            $opt = $("<option></option>");
            $opt.attr("value", users[i]);
            $opt.text(users[i]);
            if (users[i] === defaultUser) {
                $opt.attr("selected", true);
            }
            $select.append($opt);
        }
        $select.removeAttr("disabled");
    }
    loadAccounts();
}

function onKPPost(evt) {
    "use strict";

    var username = Vault.getUsername();
    var ident = Vault.getAccount(Vault.getUsername());

    if (!ident) {
        console.error("nothing to view");
        return;
    }

    if (!confirm("Beeswax will post public keys to twitter account '@" + Vault.getUsername() + "'\nDo you wish to continue?")) {
        return;
    }

    API.postKeys(username).then(function () {
        log("Keys successfully posted for account: @" + username);
    }).catch(function (err) {
        console.log(err);
        log("ERROR: Could not post keys to Twitter. code: " + err.code + " msg: " + err);
    });
}

function onKPView(evt) {
    "use strict";
    var typ = $(evt.target).attr('data-type');
    var ident = Vault.getAccount(Vault.getUsername());
    if (!ident) {
        console.error("nothing to view");
        return;
    }
    var pubKey = ident.toPubKey();
    var min = pubKey.minify();

    log("\nShare this message:\n#" + typ + "key " + min[typ]);
}

function onKPRegen() {
    "use strict";

    if (!confirm("Are you sure you want to regenerate signing and encryption keys?")) {
        return;
    }

    API.regenKeys().then(function() {
        log("new set of keys");
    }, function() {
        log("could not regen");
    });
}

function onClearLog() {
    "use strict";
    UI.clearLog();
}

function onExportUser() {
    "use strict";
    var ident = Vault.getAccount(Vault.getUsername());
    if (!ident) {
        alert("select a user first.");
        return;
    }
    console.log("EXPORT", ident);
    log(Vault.getUsername() + ":\n" + JSON.stringify(ident.toStore()));
}

function log() {
    "use strict";
    var args = [].slice.call(arguments);
    UI.log.apply(UI, args);
}

function onNewUser() {
    "use strict";

    var username = prompt("Username:");
    if (!username) {
        return;
    }

    if (Vault.getAccount(username)) {
        log("User already exists.");
        return;
    }

    var importData = prompt("Enter import data (optional):");
    if (importData) {
        importData = importData.trim();
        var bracket = importData.indexOf("{");
        importData = importData.substr(bracket);
        Vault.newAccount(username, importData);
    } else {
        Vault.newAccount(username);
    }
    log("New user created successfully.");

    API.accountChanged(Vault.getUsername());
    render();
}

function sethooks() {
    "use strict";


    render();
    $doc.find("#userselect").change(onUsernameChange);
    $doc.find("#clearall").click(onClearClick);
    $doc.find("#inputsubmit").click(onMessageSubmit);
    $doc.find("#refresh").click(render);
    $doc.find(".kp-view").click(onKPView);
    $doc.find(".kp-post").click(onKPPost);
    $doc.find(".kp-regen").click(onKPRegen);
    $doc.find("#contextselect").change(onCtxChange);
    $doc.find("#clearlog").click(onClearLog);
    $doc.find("#exportuser").click(onExportUser);
    $doc.find("#newuser").click(onNewUser);

    UI.setLogHook(function (txt) {
        var $log = $doc.find("#messagelog");
        $log.val(txt);
    });
}

$(document).ready(sethooks);
