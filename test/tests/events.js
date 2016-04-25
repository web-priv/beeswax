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


/*global define, Event, TypeError */

define(["QUnit", "utils"], function (QUnit) {
    "use strict";

    function nop() {}

    /* Make a chain of divs where the each element is appended at the
       end of the previously created node.

       the chain will be inserted into parent if specified.
       visitFn(newElt, i) is called for each element created in order of creation.

       returns the newest descendent
    */
    function makeEltChain(num, parent, visitFn) {
        var lastElt = parent;

        for (var i = 0; i < 3; i++) {
            var d = document.createElement("div");
            d.id = "test-trip-" + i;
            if (lastElt) {
                lastElt.appendChild(d);
            }
            if (visitFn) {
                visitFn(d, i);
            }
            lastElt = d;
        }
        return lastElt;
    }

    QUnit.module("Event Propagation");
    QUnit.test("Event capture trips on all elements along the way", function (assert) {
        var idsTriggered = [];
        var event = new Event('test-event-capture');

        function onCaptureEvent(/*evt*/) {
            /*jshint validthis:true */
            idsTriggered.push("C-" + this.id);
        }

        function onBubbleEvent(/*evt*/) {
            /*jshint validthis:true */
            idsTriggered.push("B-" + this.id);
        }

        var chain = makeEltChain(3, document.body, function (elt, i) {
            elt.id = "test-trip-" + i;
            elt.addEventListener('test-event-capture', onCaptureEvent.bind(elt), true);
            elt.addEventListener('test-event-capture', onBubbleEvent.bind(elt), false);
        });

        // Dispatch the event.
        chain.dispatchEvent(event);

        // Event handlers on the target element get invoked regardless
        // of if they are capturing handlers or not, hence why
        // B-test-trip-2 is invoked.
        assert.deepEqual(idsTriggered, ['C-test-trip-0', 'C-test-trip-1', 'C-test-trip-2', 'B-test-trip-2'],
                        "Expected correct handler invocation order for a capturing event.");
    });


    QUnit.test("Event bubble trips on all elements along the way", function (assert) {
        var idsTriggered = [];

        function onEventCapture(/*evt*/) {
            /*jshint validthis:true */
            idsTriggered.push("C-" + this.id);
        }
        
        function onEventBubble(/*evt*/) {
            /*jshint validthis:true */
            idsTriggered.push("B-" + this.id);
        }

        function onEventLevel1(/*evt*/) {
            /*jshint validthis:true */
            idsTriggered.push("L-" + this.id);
        }

        var chain = makeEltChain(3, document.body, function (elt, i) {
            elt.id = "test-trip-" + i;
            elt.addEventListener('click', onEventCapture.bind(elt), true); /* useCapture */
            elt.onclick = onEventLevel1.bind(elt);
            elt.addEventListener('click', onEventBubble.bind(elt), false);
        });

        // Dispatch the event.
        chain.click();
        assert.deepEqual(idsTriggered, ['C-test-trip-0', 'C-test-trip-1', 'C-test-trip-2',
                                        'L-test-trip-2', 'B-test-trip-2',
                                        'L-test-trip-1', 'B-test-trip-1',
                                        'L-test-trip-0', 'B-test-trip-0'],
                         "Expected correct handler invocation order for a bubbling event");
    });


    QUnit.test("Propagation Stop Tests", function (assert) {
        var idsTriggered = [];
        
        var stopPoint = null;
        var stopHandlerName = "";
        var stopMode = "";

        function makeHandler(hname) {
            return function onEventCaptureA(evt) {
                /*jshint validthis:true */
                idsTriggered.push(this.id + "-" + hname);
                if (this.id === stopPoint && stopHandlerName === hname) {
                    if (stopMode === "stop") {
                        evt.stopPropagation();
                    } else if (stopMode === "immediate") {
                        evt.stopImmediatePropagation();
                    } else if (stopMode === "throw") {
                        throw new Error("This error is expected.");
                    } else {
                        return stopMode;
                    }
                }
            };
        }

        var chain = makeEltChain(3, document.body, function (elt, i) {
            elt.id = "E" + i;
            elt.addEventListener('click', makeHandler("C1").bind(elt), true); /* useCapture */
            elt.addEventListener('click', makeHandler("C2").bind(elt), true); /* useCapture */
            elt.onclick = makeHandler("L1").bind(elt); /* DOM Level 1 */
            elt.addEventListener('click', makeHandler("B1").bind(elt), false); /* bubbling */
            elt.addEventListener('click', makeHandler("B2").bind(elt), false); /* bubbling */
        });

        var tests = [];
        var testPoints = ["E1"];
        var testTypes = ["C1", "C2", "L1", "B1", "B2"];
        var testModes = ["stop", "immediate", true, false, "throw"];

        /*jshint forin:false*/
        var pointi, prefixi, modei;
        for (pointi in testPoints) {
            for (prefixi in testTypes) {
                for (modei in testModes) {
                    var point = testPoints[pointi];
                    var prefix = testTypes[prefixi];
                    var mode = testModes[modei];
                    tests.push({point: point, hname: prefix, mode: mode});
                }
            }
        }

        /* All defined handlers */
        var ALL_HANDLERS = ["E0-C1", "E0-C2", "E1-C1", "E1-C2", "E2-C1", "E2-C2", // capture phase
                            "E2-L1", "E2-B1", "E2-B2", // level 1 and bubble up
                            "E1-L1", "E1-B1", "E1-B2", // level 1 and bubble up
                            "E0-L1", "E0-B1", "E0-B2"];

        function LAST(name) {
            return ALL_HANDLERS.slice(0, ALL_HANDLERS.indexOf(name) + 1);
        }

        var expectedResults = {
            "E1": {
                "C1": {
                    stop: LAST("E1-C2"),
                    immediate: LAST("E1-C1"),
                    "true": ALL_HANDLERS,
                    "false": ALL_HANDLERS,
                    "throw": ALL_HANDLERS
                },
                "C2": {
                    stop: LAST("E1-C2"),
                    immediate: LAST("E1-C2"),
                    "true": ALL_HANDLERS,
                    "false": ALL_HANDLERS,
                    "throw": ALL_HANDLERS
                },
                "L1": {
                    stop: LAST("E1-B2"),
                    immediate: LAST("E1-L1"),
                    "true": ALL_HANDLERS,
                    "false": ALL_HANDLERS,
                    "throw": ALL_HANDLERS
                },
                "B1" : {
                    stop: LAST("E1-B2"),
                    immediate: LAST("E1-B1"),
                    "true": ALL_HANDLERS,
                    "false": ALL_HANDLERS,
                    "throw": ALL_HANDLERS
                },
                "B2": {
                    stop: LAST("E1-B2"),
                    immediate: LAST("E1-B2"),
                    "true": ALL_HANDLERS,
                    "false": ALL_HANDLERS,
                    "throw": ALL_HANDLERS
                }
            }
        };

        var testi;
        for (testi in tests) {
            var test = tests[testi];
            
            // configure the place where the event will stop
            // propagating
            stopPoint = test.point;
            stopHandlerName = test.hname;
            stopMode = test.mode;
            idsTriggered = [];

            // Dispatch the event.
            if (stopMode === "throw") {
                var qunit_handler = window.onerror;
                window.onerror = undefined;
                try {
                    chain.click();
                } finally {
                    window.onerror = qunit_handler;
                }
            } else {
                chain.click();
            }

            assert.deepEqual(idsTriggered, expectedResults[stopPoint][stopHandlerName]["" + stopMode],
                             "Order of event handlers should be predictable {" +
                             "node:" + stopPoint +
                             ", handler:" + stopHandlerName +
                             ", stopMode:" + stopMode + "}");
        }
    });

    QUnit.test("We can remove properties on the event along a chain", function (assert) {
        var idsTriggered = [];

        var propertiesRemoved =
            ["cancelBubble", "metaKey", "movementX", "layerX", "webkitMovementY",
             "layerY", "pageX", "eventPhase", "button", "returnValue", "bubbles",
             "clientY", "path", "timeStamp", "offsetX", "dataTransfer", "ctrlKey",
             "clientX", "srcElement", "pageY", "toElement", "shiftKey", "type",
             "webkitMovementX", "altKey", "keyCode", "movementY", "which",
             "screenX", "offsetY", "clipboardData", "screenY", "defaultPrevented",
             "charCode", "cancelable", "fromElement", "y", "currentTarget", "x",
             "relatedTarget", "target", "detail", "view"
            ];

        var propertiesAdded = ["foo", "bar"];

        function hasDeletedProps(evt) {
            var propNames = Object.getOwnPropertyNames(evt);
            for (var i = 0; i < propNames.length; i++) {
                if (propertiesRemoved.indexOf(propNames[i]) !== -1) {
                    assert.ok(false, "Event still owns the following properties (should have been deleted):" + propNames);
                    return true;
                }
            }
            

            // // These are now getters in the prototype chain!
            // for (i = 0; i < propertiesRemoved.length; i++) {
            //     if (evt[propertiesRemoved[i]] !== undefined) {
            //         assert.ok(false, "Event still owns the following property evt[" + propertiesRemoved[i] +
            //                   "] (should be undefined):");
            //         return true;
            //     }
            // }

            return false;
        }

        function hasAddedProps(evt) {
            var propNames = Object.getOwnPropertyNames(evt);
            // for (var i = 0; i < propNames.length; i++) {
            //     if (propertiesAdded.indexOf(propNames[i]) === -1) {
            //         console.error("Event no longer has the following properties:", propNames);
            //         return false;
            //     }
            // }
            for (var i = 0; i < propertiesAdded.length; i++) {
                if (!evt.hasOwnProperty(propertiesAdded[i])) {
                    console.error("Event no longer has the following properties:", propNames);
                    return false;
                }
            }
            return true;
        }

        function onEventCapture(evt, eid) {
            /*jshint validthis:true */
            eid = this.id || eid;
            if (!hasDeletedProps(evt) && evt === event && hasAddedProps(evt)) {
                idsTriggered.push("C-" + eid);
            }
        }
        
        function onEventBubble(evt, eid) {
            /*jshint validthis:true */
            eid = eid || this.id;
            if (!hasDeletedProps(evt) && evt === event && hasAddedProps(evt)) {
                idsTriggered.push("B-" + eid);
            }
        }

        function onEventLevel1(evt, eid) {
            /*jshint validthis:true */
            eid = eid || this.id;
            if (!hasDeletedProps(evt) && evt === event && hasAddedProps(evt)) {
                idsTriggered.push("L-" + eid);
            }
        }

        var chain = makeEltChain(3, document.body, function (elt, i) {
            elt.id = "test-remove-" + i;
            elt.onclick = onEventLevel1.bind(elt);
            elt.addEventListener('click', onEventCapture.bind(elt), true);
            elt.addEventListener('click', onEventBubble.bind(elt), false);
        });

        var event = null;
        function clickEventManipulator(evt) {
            event = evt;
            for (var i = 0; i < propertiesRemoved.length; i++) {
                delete evt[propertiesRemoved[i]];
            }

            function delNonConfigProp() {
                delete evt[propertiesAdded[i]];
            }

            for (i = 0; i < propertiesAdded.length; i++) {
                Object.defineProperty(evt, propertiesAdded[i], {writable: false, value: 5, configurable: false});
                // try deleting it (should be ignored)
                assert.throws(delNonConfigProp, TypeError, "Deleting non-configurable prop raised a TypeError");
            }
        }

        window.addEventListener("click", clickEventManipulator, true);

        /* <body>
             ...
             <div test-remove-0>
               <div test-remove-1>
                 <div test-remove-2></div></div></div>
        */
        chain.click();
        document.body.removeChild(document.getElementById("test-remove-0"));
        window.removeEventListener("click", clickEventManipulator, true);

        assert.deepEqual(idsTriggered, [
            "C-test-remove-0",
            "C-test-remove-1",
            "L-test-remove-2",
            "C-test-remove-2",
            "B-test-remove-2",
            "L-test-remove-1",
            "B-test-remove-1",
            "L-test-remove-0",
            "B-test-remove-0"
        ], "Handlers should fire in the right order:" + idsTriggered);
    });

    /**
       Check to see how many addEventListener functions exist in the runtime.
       We walk the object space.
       
       Should be only one.
    */
    //QUnit.test
    nop("Single distinct addEventListener", function (assert) {
        var soFar = [];
        function beenSeen(o, path) {
            var i;
            for (i = 0; i < soFar.length; i++) {
                if (soFar[i].obj === o) {
                    return soFar[i];
                }
            }
            soFar.push({obj: o, path: path});
            return null;
        }

        var search = [];

        function walk(obj, path, fn) {
            if (obj === null ||
                obj === undefined ||
                typeof(obj) === 'number' ||
                typeof(obj) === 'string' ||
                typeof(obj) === 'boolean' ||
                obj instanceof window.Plugin /* infinite recursion -- new objects generated */) {
                return;
            }

            if (beenSeen(obj, path)) {
                return;
            }

            if (fn) {
                fn(obj, path, soFar);
            }

            var propnames;

            try {
                propnames = Object.getOwnPropertyNames(obj);
            } catch (err) {
                console.error("Can't get property names on:", obj, "path is:", path, "err:", err);
                throw err;
            }

            for (var i = 0; i < propnames.length; i++) {
                var desc;
                try {
                    desc = Object.getOwnPropertyDescriptor(obj, propnames[i]);
                } catch (err) {
                    console.error("Can't read property:", path + "." + propnames[i], "on obj:", obj);
                    continue;
                }
                if (desc.hasOwnProperty("get") || desc.hasOwnProperty("set")) {
                    if (desc.hasOwnProperty("get")) {
                        search.push({obj: desc.get, path: path + "." + propnames[i] + "$get"});
                    }
                    if (desc.hasOwnProperty("set")) {
                        search.push({obj: desc.set, path: path + "." + propnames[i] + "$set"});
                    }
                } else {
                    search.push({obj: desc.value, path: path + "." + propnames[i]});
                }
            }
            /*jshint proto:true */
            search.push({obj: obj.__proto__, path: path + ".__proto__"});
        }

        function endsWith(s, suffix) {
            return s.indexOf(suffix, s.length - suffix.length) !== -1;
        }

        var candidates = [];

        function eventAdders(obj, path /*, sofar */) {
            if (endsWith(path, "addEventListener") || endsWith(path, "addEventListener$get") || endsWith(path, "addEventListener$set")) {
                candidates.push(path);
            }
        }

        search.push({obj: window, path: "window"});
        for (var i = 0 ; i < search.length && i < 100000; i++) {
            walk(search[i].obj, search[i].path, eventAdders);
            delete search[i];
        }
        console.log(soFar);
        assert.equal(candidates.length, 1, "Found one addEventListener.");
        assert.equal(candidates[0], "window.EventTarget.prototype.addEventListener");
    });
});