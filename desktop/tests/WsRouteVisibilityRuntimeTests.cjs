'use strict';
// Execute the actual embedded observer, including its production debounce and
// native pull API. The DOM and clock are synthetic; no browser/account opens.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const repo = path.resolve(__dirname, '..', '..');
const host = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs'), 'utf8');
const match = host.match(/internal static string BuildWsBoundsObserverScript\(\) => """([\s\S]*?)""";/);
assert.ok(match, 'Bounds observer must be the shipped embedded script');
let documentNumber = 0;

function fixture() {
  const number = ++documentNumber;
  const state = { routeActive: true, workspacePage: 'chat', accountId: 'account-a', present: true,
    display: 'block', visibility: 'visible', rect: { left: 120, top: 80, width: 960, height: 640 } };
  const frames = new Map(), timers = new Map(), listeners = new Map(), observers = [], posted = [];
  let clock = 0, timerId = 0;
  const wsHost = { getBoundingClientRect: () => ({ ...state.rect }) };
  const workspace = { get dataset() { return { wsAccountId: state.accountId }; } };
  const nav = { get dataset() { return { wsWorkspaceView: state.workspacePage }; } };
  const viewRoot = { addEventListener(type, callback) { listeners.set('root:' + type, callback); } };
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); }
    observe(target, options) { this.targets.push({ target, options }); }
    disconnect() { this.targets = []; }
  }
  const fakeMath = Object.create(Math);
  fakeMath.random = () => number / 1000;
  const sandbox = {
    window: { innerWidth: 1440, innerHeight: 900,
      chrome: { webview: { postMessage(raw) { posted.push(JSON.parse(raw)); } } },
      addEventListener(type, callback) { listeners.set(type, callback); } },
    document: { readyState: 'complete', documentElement: { clientWidth: 1440, clientHeight: 900 },
      querySelector(selector) {
        if (selector === '#wsBrowserHost') return state.present ? wsHost : null;
        if (selector === '#viewContainer') return viewRoot;
        if (selector === '.ws-workbench-page') return state.routeActive ? workspace : null;
        if (selector === '.ws-workspace-nav-item[aria-current="page"]') return state.routeActive ? nav : null;
        return null;
      }, addEventListener() {} },
    getComputedStyle: () => ({ display: state.display, visibility: state.visibility }),
    requestAnimationFrame(callback) { const id = ++timerId; frames.set(id, callback); return id; },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, due: clock + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    ResizeObserver: class { constructor(callback) { this.callback = callback; } observe() {} disconnect() {} },
    MutationObserver, Date: class extends Date { static now() { return 1700000000000 + number; } }, Math: fakeMath, JSON,
  };
  vm.createContext(sandbox);
  const install = () => vm.runInContext(match[1], sandbox, { filename: 'production-ws-bounds-observer.js' });
  const frame = () => {
    const pending = [...frames.values()]; frames.clear();
    for (const callback of pending) callback();
  };
  const mutate = () => {
    for (const observer of [...observers]) {
      if (observer.targets.some(item => item.target === viewRoot)) observer.callback([{ type: 'childList', target: viewRoot }]);
      else if (state.routeActive && observer.targets.some(item => item.target === workspace)) observer.callback([{ type: 'attributes', target: workspace }]);
    }
    frame();
  };
  const advance = milliseconds => {
    clock += milliseconds;
    for (const [id, timer] of [...timers.entries()].sort((a, b) => a[1].due - b[1].due)) {
      if (timer.due <= clock && timers.delete(id)) timer.callback();
    }
    frame();
  };
  const snapshot = () => {
    assert.equal(typeof sandbox.window.__zhikeWsNativeBoundsSnapshot, 'function', 'Native pulls must sample the current DOM through the production observer');
    return JSON.parse(JSON.stringify(sandbox.window.__zhikeWsNativeBoundsSnapshot()));
  };
  install();
  return { state, posted, frame, mutate, advance, snapshot, install, listeners, sandbox };
}

const cases = [];
function test(name, run) { run(); cases.push(name); }
function assertEnvelope(value) {
  assert.equal(value.type, 'zhike.ws.bounds');
  assert.equal(value.route, 'ws-workbench');
  assert.equal(value.routeVisible, !value.bounds.hidden);
  assert.ok(value.documentId.length >= 8);
  assert.ok(Number.isSafeInteger(value.sequence) && value.sequence > 0);
}

test('12 workspace pages, account changes and route exit retain ordered push fences', () => {
  const f = fixture(); f.frame();
  assert.equal(f.posted.length, 1);
  assertEnvelope(f.posted[0]);
  assert.deepEqual(f.posted[0].bounds, { hidden: false, x: 120, y: 80, width: 960, height: 640, viewportWidth: 1440, viewportHeight: 900 });
  const documentId = f.posted[0].documentId;
  for (const workspacePage of ['overview', 'accounts', 'groups', 'members', 'collection', 'contacts', 'ai', 'crm', 'tasks', 'logs', 'settings', 'chat']) {
    f.state.workspacePage = workspacePage; f.mutate();
    const item = f.posted.at(-1);
    assert.equal(item.workspacePage, workspacePage);
    assert.equal(item.routeVisible, workspacePage === 'chat');
    assert.equal(item.routeActive, true);
  }
  f.state.accountId = 'account-b'; f.mutate();
  assert.equal(f.posted.at(-1).accountId, 'account-b', 'Same geometry still publishes the new account');
  f.state.routeActive = false; f.mutate();
  assert.equal(f.posted.at(-1).routeActive, false);
  assert.equal(f.posted.at(-1).routeVisible, false);
  assert.equal(f.posted.at(-1).workspacePage, '');
  const count = f.posted.length; f.mutate(); f.advance(200);
  assert.equal(f.posted.length, count, 'Unchanged geometry must not flood the native bridge');
  assert.ok(f.posted.every((item, index) => item.sequence === index + 1 && item.documentId === documentId));
});

test('initial native pull works before the first observer animation frame', () => {
  const f = fixture();
  const first = f.snapshot();
  assertEnvelope(first); assert.equal(first.sequence, 1); assert.equal(first.routeVisible, true);
  assert.equal(first.accountId, 'account-a');
  assert.equal(f.posted.length, 0, 'Pull must not also post an asynchronous duplicate');
  f.frame();
  if (f.posted.length) assert.ok(f.posted[0].sequence > first.sequence, 'A queued push cannot reuse an earlier pull sequence');
  assert.ok(f.snapshot().sequence > first.sequence);
});

test('same-geometry pulls refresh sequence and current DOM even without a mutation event', () => {
  const f = fixture(); f.frame();
  const initial = f.posted[0], one = f.snapshot(), two = f.snapshot();
  assert.equal(one.sequence, initial.sequence + 1); assert.equal(two.sequence, one.sequence + 1);
  assert.equal(one.documentId, initial.documentId); assert.deepEqual(two.bounds, one.bounds);
  f.state.workspacePage = 'collection'; f.state.accountId = 'account-b';
  const hidden = f.snapshot();
  assert.equal(hidden.workspacePage, 'collection'); assert.equal(hidden.accountId, 'account-b');
  assert.equal(hidden.routeVisible, false); assert.equal(hidden.routeActive, true);
  f.state.workspacePage = 'chat';
  const restored = f.snapshot();
  assert.equal(restored.routeVisible, true); assert.equal(restored.bounds.width, initial.bounds.width);
  assert.ok(restored.sequence > hidden.sequence, 'Same bounds after hidden must remain recoverable');
  assert.equal(f.posted.length, 1, 'Native resampling is synchronous and does not require observer delivery');
  f.state.routeActive = false;
  assert.equal(f.snapshot().routeActive, false, 'A delayed legacy request sees the current route instead of its stale payload');
});

test('native snapshot samples missing, styled-hidden and undersized anchors truthfully', () => {
  const f = fixture();
  for (const change of [{ present: false }, { display: 'none' }, { visibility: 'hidden' }, { rect: { left: 1, top: 2, width: 39, height: 400 } }]) {
    Object.assign(f.state, { present: true, display: 'block', visibility: 'visible', rect: { left: 120, top: 80, width: 960, height: 640 } }, change);
    const sampled = f.snapshot(); assert.equal(sampled.bounds.hidden, true); assert.equal(sampled.routeVisible, false);
  }
  Object.assign(f.state, { present: true, display: 'block', visibility: 'visible', rect: { left: 9, top: 11, width: 700, height: 500 } });
  assert.deepEqual(f.snapshot().bounds, { hidden: false, x: 9, y: 11, width: 700, height: 500, viewportWidth: 1440, viewportHeight: 900 });
});

test('production debounce suppresses transient removal and restores unchanged geometry after a real hide', () => {
  const f = fixture(); f.frame();
  f.state.display = 'none'; f.mutate(); f.advance(179);
  assert.equal(f.posted.length, 1);
  f.state.display = 'block'; f.mutate(); f.advance(200);
  assert.equal(f.posted.length, 1, 'One-frame shell redraw must not flicker the native overlay');
  f.state.display = 'none'; f.mutate(); f.advance(180);
  assert.equal(f.posted.at(-1).routeVisible, false, 'Stable hidden anchor is eventually published');
  f.state.display = 'block'; f.mutate(); f.advance(80);
  assert.equal(f.posted.at(-1).routeVisible, true, 'Original rectangle must reappear after hiding');
  assert.equal(f.posted.at(-1).bounds.width, 960);
});

test('geometry debounce and snapshot share monotonically increasing sequence', () => {
  const f = fixture(); f.frame();
  f.state.rect.width = 880; f.mutate(); f.advance(79);
  assert.equal(f.posted.length, 1);
  const pulled = f.snapshot(); assert.equal(pulled.bounds.width, 880);
  f.advance(1);
  assert.equal(f.posted.at(-1).bounds.width, 880);
  assert.ok(f.posted.at(-1).sequence > pulled.sequence, 'A pending geometry push must not regress the native pull fence');
  const count = f.posted.length; f.mutate(); f.advance(200);
  assert.equal(f.posted.length, count);
});

test('reinstallation stays idempotent while a new document gets a fresh generation', () => {
  const old = fixture(); old.frame();
  const one = old.snapshot(), callback = old.sandbox.window.__zhikeWsNativeBoundsSnapshot;
  old.install(); old.frame();
  assert.equal(old.sandbox.window.__zhikeWsNativeBoundsSnapshot, callback);
  const two = old.snapshot(); assert.equal(two.documentId, one.documentId); assert.equal(two.sequence, one.sequence + 1);
  const next = fixture(), fresh = next.snapshot();
  assert.notEqual(fresh.documentId, two.documentId); assert.equal(fresh.sequence, 1);
});

assert.match(host, /if \(!ApplyTrustedWsRouteVisibility\(root\)\) return;[\s\S]*ApplyWsBounds\(root\)/, 'route visibility must be accepted before applying native bounds');
assert.match(host, /sequence <= _lastWsBoundsSequence/, 'stale or duplicated bounds messages cannot revive the overlay');
assert.match(host, /_currentRoute = "ws-workbench";[\s\S]*Interlocked\.Increment\(ref _routeGeneration\)/, 'a visible trusted parent route activates the native route generation');
assert.match(host, /_currentRoute = "legacy-background";[\s\S]*HideWsOverlay\(\)/, 'leaving the route invalidates async bounds and hides without closing WS');
assert.match(host, /if \(!IsTrustedWorkbenchOrigin\(args.Source\)\) return;/, 'only the HTTPS local shell can command workspace presentation');
assert.match(host, /_wsChatPageActive = routeActive && workspacePage == "chat"/, 'only front chat can present native WS');
assert.match(host, /string.Equals\(_wsPresentationAccountId, _wsViewAccountId/, 'a previous account cannot reveal a pooled native view');
assert.match(host, /NotifyWorkspaceRouteVisibility\(this, routeActive\)/, 'native window presentation follows the WS route, independently of chat visibility');


console.log(JSON.stringify({ suite: 'production WS bounds observer and native snapshot', passed: cases.length, cases,
  nativePresentation: 'Covered separately by WsPresentationRuntimeTests', realWinUIComposition: 'NotTested' }));
