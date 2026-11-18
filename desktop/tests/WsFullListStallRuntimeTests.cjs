'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '..', '..');
const host = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Views', 'LegacyUiHostPage.xaml.cs'), 'utf8');
const match = host.match(/internal static string BuildWsCollectorScript\(string accountId\)\s*\{[\s\S]*?return \$\$"""([\s\S]*?)""";/);
assert.ok(match);
const script = match[1].replace(/\{\{encodedAccount\}\}/g, JSON.stringify('stall-test'));

const row = {
  getAttribute(name) { return name === 'data-id' ? 'direct-stalled-list' : name === 'data-chat-type' ? 'direct' : name === 'role' ? 'row' : ''; },
  querySelectorAll() { return []; },
  querySelector(selector) {
    if (selector.includes('[title]') || selector.includes('span[dir="auto"]')) return { getAttribute:() => 'direct-stalled-list', textContent:'direct-stalled-list', closest:() => null };
    return null;
  },
  closest() { return null; }, dispatchEvent() {}, scrollIntoView() {}, focus() {}, click() {},
  innerText:'direct-stalled-list preview', textContent:'direct-stalled-list preview',
};
const list = {
  get scrollTop() { return 0; },
  set scrollTop(_value) { /* Virtual list is frozen while the WebView is hidden. */ },
  scrollHeight:900, clientHeight:300,
  querySelectorAll(selector) { return /listitem|role="row"|cell-frame-container/.test(selector) ? [row] : []; },
  dispatchEvent() {},
};
const document = {
  body:{},
  querySelector(selector) {
    if (selector.includes('#pane-side') || selector.includes('chat-list') || selector === '[role="grid"]') return list;
    return null;
  },
  querySelectorAll(selector) {
    if (selector.includes('#pane-side') || selector.includes('chat-list') || selector === '[role="grid"]') return [list];
    if (/listitem|role="row"|cell-frame-container/.test(selector)) return [row];
    return [];
  },
};

let now = Date.parse('2026-11-13T00:00:00Z');
class FakeDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
let timerId = 0;
let frameRequests = 0;
const dormantTimers = new Map();
const posted = [];
const sandbox = {
  window:{ chrome:{ webview:{ postMessage(raw) { posted.push(JSON.parse(raw)); } } }, addEventListener(){}, removeEventListener(){} },
  document,
  localStorage:{ getItem(){ return null; }, setItem(){} },
  MutationObserver:class { observe(){} disconnect(){} },
  Event:class { constructor(type, options) { this.type=type; Object.assign(this, options); } },
  MouseEvent:class { constructor(type, options) { this.type=type; this.isTrusted=false; Object.assign(this, options); } },
  requestAnimationFrame() { frameRequests += 1; return frameRequests; },
  setTimeout(callback, delay=0) { const id=++timerId; dormantTimers.set(id, { callback, delay }); return id; },
  clearTimeout(id) { dormantTimers.delete(id); },
  setInterval(){ return 1; }, clearInterval(){},
  Date:FakeDate, JSON, Math, Set, Map, String, Number, Object, Array,
};

vm.runInNewContext(script, sandbox);
sandbox.window.__zhikeStopCapture();
posted.length = 0;
const started = sandbox.window.__zhikeWsDiscoverAll();
assert.equal(started.scanning, true);

const heartbeats = [];
for (let index = 0; index < 12 && !posted.some(packet => packet.coverage === 'page-list-interrupted'); index += 1) {
  now += 5000;
  heartbeats.push(sandbox.window.__zhikeWsBackgroundTick());
}

assert.ok(frameRequests > 0, 'production still attempts normal paint frames');
assert.ok(dormantTimers.size > 0, 'page-owned timers remain dormant in this minimized fixture');
assert.ok(heartbeats.some(item => Number(item.allNoProgressMs || 0) >= 30000), 'fixed numeric diagnostics expose a thirty-second no-progress window');
assert.ok(posted.some(packet => packet.coverage === 'page-list-interrupted'), 'a frozen full-list scan preserves partial rows and yields as interrupted');
assert.ok(heartbeats.length < 12, 'the collector yields well before the ten-minute deadline');

console.log('WS full-list stall runtime: a frozen virtual list yields after 30 seconds with partial checkpoints');
