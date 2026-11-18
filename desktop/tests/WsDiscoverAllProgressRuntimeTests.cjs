'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '..', '..');
const host = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Views', 'LegacyUiHostPage.xaml.cs'), 'utf8');
const match = host.match(/internal static string BuildWsCollectorScript\(string accountId\)\s*\{[\s\S]*?return \$\$"""([\s\S]*?)""";/);
assert.ok(match);
const script = match[1].replace(/\{\{encodedAccount\}\}/g, JSON.stringify('discover-progress'));

let scrollTop = 0;
const makeRow = id => ({
  getAttribute(name) { return name === 'data-id' ? id : name === 'data-chat-type' ? 'direct' : name === 'role' ? 'row' : ''; },
  querySelectorAll() { return []; },
  querySelector(selector) {
    if (selector.includes('[title]') || selector.includes('span[dir="auto"]')) return { getAttribute:() => id, textContent:id, closest:() => null };
    return null;
  },
  closest() { return null; }, dispatchEvent() {}, scrollIntoView() {}, focus() {}, click() {},
  innerText:`${id} preview`, textContent:`${id} preview`,
});
const topRow = makeRow('discover-top');
const bottomRow = makeRow('discover-bottom');
const visibleRows = () => scrollTop < 250 ? [topRow] : [bottomRow];
const list = {
  get scrollTop() { return scrollTop; }, set scrollTop(value) { scrollTop = Number(value); },
  scrollHeight:600, clientHeight:300,
  querySelectorAll(selector) { return /listitem|role="row"|cell-frame-container/.test(selector) ? visibleRows() : []; },
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
    if (/listitem|role="row"|cell-frame-container/.test(selector)) return visibleRows();
    return [];
  },
};

let now = Date.parse('2026-11-13T00:00:00Z');
class FakeDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
let nextTimer = 0;
const timers = new Map();
const frames = [];
const posted = [];
const sandbox = {
  window:{ chrome:{ webview:{ postMessage(raw) { posted.push(JSON.parse(raw)); } } }, addEventListener(){}, removeEventListener(){} },
  document,
  localStorage:{ getItem(){ return null; }, setItem(){} },
  MutationObserver:class { observe(){} disconnect(){} },
  Event:class { constructor(type, options) { this.type=type; Object.assign(this, options); } },
  MouseEvent:class { constructor(type, options) { this.type=type; Object.assign(this, options); } },
  requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
  setTimeout(callback, delay=0) { const id=++nextTimer; timers.set(id, { callback, due:now + Number(delay || 0) }); return id; },
  clearTimeout(id) { timers.delete(id); },
  setInterval(){ return 1; }, clearInterval(){},
  Date:FakeDate, JSON, Math, Set, Map, String, Number, Object, Array,
};

vm.runInNewContext(script, sandbox);
sandbox.window.__zhikeStopCapture();
frames.length = 0;
timers.clear();
posted.length = 0;

const started = sandbox.window.__zhikeWsDiscoverAll();
assert.equal(started.scanning, true);
// The paint scheduler uses two frames. Run exactly one scanner step so the
// top window is owned by the still-active allScan.
assert.ok(frames.length > 0);
now += 16; frames.shift()();
now += 16; frames.shift()();

const partial = sandbox.window.__zhikeWsDiscoverAll();
assert.equal(partial.scanning, true);
assert.equal(partial.coverage, 'scan-in-progress');
assert.deepEqual(Array.from(partial.conversations, item => item.conversationKey), ['discover-top'], 'in-progress reads expose the scan owner\'s accumulated rows');

let guard = 0;
while (!posted.some(packet => packet.coverage === 'page-list-scanned') && guard++ < 100) {
  if (frames.length) { now += 16; frames.shift()(); continue; }
  const next = [...timers.entries()].sort((left, right) => left[1].due - right[1].due)[0];
  if (!next) break;
  const [id, timer] = next;
  timers.delete(id);
  now = Math.max(now, timer.due);
  timer.callback();
}

const completedRows = posted
  .filter(packet => packet.coverage === 'page-list-scanned')
  .flatMap(packet => packet.conversations || [])
  .map(item => item.conversationKey);
assert.deepEqual(completedRows, ['discover-top', 'discover-bottom'], 'completed scan publishes the full top-to-bottom result');
assert.ok(guard < 100, 'scan completes with a bounded fake clock');

console.log('WS discover-all progress runtime: in-flight reads expose partial rows and completion publishes all rows');
