'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '..', '..');
const host = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Views', 'LegacyUiHostPage.xaml.cs'), 'utf8');
const match = host.match(/internal static string BuildWsBoundsObserverScript\(\) => """([\s\S]*?)""";/);
assert.ok(match, 'bounds observer script must remain embedded');

let display = 'block';
const wsHost = { getBoundingClientRect() { return { left:120, top:80, width:960, height:640 }; } };
const viewRoot = { addEventListener(){} };
const frames = [];
const listeners = new Map();
const posted = [];
let mutationCallback = null;
const sandbox = {
  window:{
    innerWidth:1440, innerHeight:900,
    chrome:{ webview:{ postMessage(raw) { posted.push(JSON.parse(raw)); } } },
    addEventListener(type, callback) { listeners.set(type, callback); },
  },
  document:{
    readyState:'complete', documentElement:{ clientWidth:1440, clientHeight:900 },
    querySelector(selector) { return selector === '#wsBrowserHost' ? wsHost : selector === '#viewContainer' ? viewRoot : null; },
    addEventListener(){},
  },
  getComputedStyle() { return { display, visibility:'visible' }; },
  requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
  ResizeObserver:class { constructor(callback){ this.callback=callback; } observe(){} disconnect(){} },
  MutationObserver:class { constructor(callback){ mutationCallback=callback; } observe(){} disconnect(){} },
  Date, Math, JSON,
};
vm.runInNewContext(match[1], sandbox);
while (frames.length) frames.shift()();

assert.equal(posted.length, 1);
assert.equal(posted[0].type, 'zhike.ws.bounds');
assert.equal(posted[0].route, 'ws-workbench');
assert.equal(posted[0].routeVisible, true);
assert.equal(posted[0].sequence, 1);
assert.ok(typeof posted[0].documentId === 'string' && posted[0].documentId.length >= 8, 'each parent document has an opaque bounds generation id');
assert.deepEqual(posted[0].bounds, { hidden:false, x:120, y:80, width:960, height:640, viewportWidth:1440, viewportHeight:900 });

display = 'none';
mutationCallback([{ type:'childList', target:viewRoot }]);
while (frames.length) frames.shift()();
assert.equal(posted[1].routeVisible, false, 'leaving the SPA route sends an explicit hide transition');
assert.equal(posted[1].sequence, 2);

display = 'block';
mutationCallback([{ type:'childList', target:viewRoot }]);
while (frames.length) frames.shift()();
assert.equal(posted[2].routeVisible, true, 'returning to the WS SPA route sends an explicit show transition');
assert.equal(posted[2].sequence, 3);
assert.equal(posted[2].documentId, posted[0].documentId);

mutationCallback([{ type:'childList', target:viewRoot }]);
while (frames.length) frames.shift()();
assert.equal(posted.length, 3, 'unchanged bounds do not flood the native bridge');

assert.match(host, /if \(!ApplyTrustedWsRouteVisibility\(root\)\) return;[\s\S]*ApplyWsBounds\(root\)/, 'route visibility must be accepted before applying native bounds');
assert.match(host, /sequence <= _lastWsBoundsSequence/, 'stale or duplicated bounds messages cannot revive the overlay');
assert.match(host, /_currentRoute = "ws-workbench";[\s\S]*Interlocked\.Increment\(ref _routeGeneration\)/, 'a visible trusted parent route activates the native route generation');
assert.match(host, /_currentRoute = "legacy-background";[\s\S]*HideWsOverlay\(\)/, 'leaving the route invalidates async bounds and hides without closing WS');

console.log('WS route visibility runtime: parent SPA show/hide transitions are ordered and stale bounds cannot revive the overlay');
