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
let routeActive = true;
let workspacePage = 'chat';
let accountId = 'account-a';
const wsHost = { getBoundingClientRect() { return { left:120, top:80, width:960, height:640 }; } };
const workspace = { get dataset() { return { wsAccountId:accountId }; } };
const workspaceNav = { get dataset() { return { wsWorkspaceView:workspacePage }; } };
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
    querySelector(selector) {
      if (selector === '#wsBrowserHost') return wsHost;
      if (selector === '#viewContainer') return viewRoot;
      if (selector === '.ws-workbench-page') return routeActive ? workspace : null;
      if (selector === '.ws-workspace-nav-item[aria-current="page"]') return routeActive ? workspaceNav : null;
      return null;
    },
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
assert.equal(posted[0].routeActive, true);
assert.equal(posted[0].workspacePage, 'chat');
assert.equal(posted[0].accountId, 'account-a');
assert.equal(posted[0].sequence, 1);
assert.ok(typeof posted[0].documentId === 'string' && posted[0].documentId.length >= 8, 'each parent document has an opaque bounds generation id');
assert.deepEqual(posted[0].bounds, { hidden:false, x:120, y:80, width:960, height:640, viewportWidth:1440, viewportHeight:900 });

workspacePage = 'overview';
mutationCallback([{ type:'childList', target:viewRoot }]);
while (frames.length) frames.shift()();
assert.equal(posted[1].routeVisible, false, 'home hides the native surface even while the reused host still has visible geometry');
assert.equal(posted[1].routeActive, true, 'WS subpages retain the maximized native workspace');
assert.equal(posted[1].sequence, 2);

for (const page of ['accounts','groups','members','collection','contacts','ai','crm','tasks','logs','settings']) {
  workspacePage = page;
  mutationCallback([{ type:'childList', target:viewRoot }]);
  while (frames.length) frames.shift()();
  assert.equal(posted.at(-1).workspacePage, page, 'hidden-to-hidden subpage transitions remain authoritative');
  assert.equal(posted.at(-1).routeVisible, false, `${page} must never reveal the native chat`);
  assert.equal(posted.at(-1).routeActive, true);
}
workspacePage = 'chat';
mutationCallback([{ type:'childList', target:viewRoot }]);
while (frames.length) frames.shift()();
assert.equal(posted.at(-1).routeVisible, true, 'returning to front chat sends an explicit show transition');
assert.equal(posted[2].documentId, posted[0].documentId);

accountId = 'account-b';
mutationCallback([{ type:'childList', target:viewRoot }]);
while (frames.length) frames.shift()();
assert.equal(posted.at(-1).accountId, 'account-b', 'same geometry on another account still emits account fencing metadata');

routeActive = false;
mutationCallback([{ type:'childList', target:viewRoot }]);
while (frames.length) frames.shift()();
assert.equal(posted.at(-1).routeActive, false, 'leaving WS explicitly restores native main-window presentation');
assert.equal(posted.at(-1).routeVisible, false);
assert.equal(posted.at(-1).workspacePage, '');
const count = posted.length;
mutationCallback([{ type:'childList', target:viewRoot }]);
while (frames.length) frames.shift()();
assert.equal(posted.length, count, 'unchanged bounds do not flood the native bridge');
assert.ok(posted.every((item, index) => item.sequence === index + 1), 'all visibility/account/page transitions retain document sequence order');

assert.match(host, /if \(!ApplyTrustedWsRouteVisibility\(root\)\) return;[\s\S]*ApplyWsBounds\(root\)/, 'route visibility must be accepted before applying native bounds');
assert.match(host, /sequence <= _lastWsBoundsSequence/, 'stale or duplicated bounds messages cannot revive the overlay');
assert.match(host, /_currentRoute = "ws-workbench";[\s\S]*Interlocked\.Increment\(ref _routeGeneration\)/, 'a visible trusted parent route activates the native route generation');
assert.match(host, /_currentRoute = "legacy-background";[\s\S]*HideWsOverlay\(\)/, 'leaving the route invalidates async bounds and hides without closing WS');
assert.match(host, /if \(!IsTrustedWorkbenchOrigin\(args.Source\)\) return;/, 'only the HTTPS local shell can command workspace presentation');
assert.match(host, /_wsChatPageActive = routeActive && workspacePage == "chat"/, 'only front chat can present native WS');
assert.match(host, /string.Equals\(_wsPresentationAccountId, _wsViewAccountId/, 'a previous account cannot reveal a pooled native view');
assert.match(host, /NotifyWorkspaceRouteVisibility\(this, routeActive\)/, 'native window presentation follows the WS route, independently of chat visibility');

console.log('WS route visibility runtime: 12 pages, chat-only native anchor, account fencing and ordered WS enter/exit pass');
