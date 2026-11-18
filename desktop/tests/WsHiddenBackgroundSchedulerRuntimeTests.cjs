'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '..', '..');
const host = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Views', 'LegacyUiHostPage.xaml.cs'), 'utf8');
const match = host.match(/internal static string BuildWsCollectorScript\(string accountId\)\s*\{[\s\S]*?return \$\$"""([\s\S]*?)""";/);
assert.ok(match);
const script = match[1].replace(/\{\{encodedAccount\}\}/g, JSON.stringify('hidden-test'));

let activeChat = '';
let directionKnown = false;
const clicks = [];
const makeRow = id => ({
  getAttribute(name) { return name === 'data-id' ? id : name === 'data-chat-type' ? 'direct' : name === 'role' ? 'row' : ''; },
  querySelectorAll() { return []; },
  querySelector(selector) {
    if (selector.includes('[title]') || selector.includes('span[dir="auto"]')) return { getAttribute:name => name === 'title' ? id : '', textContent:id, closest:() => null };
    return null;
  },
  closest() { return null; }, dispatchEvent() { return true; }, scrollIntoView() {}, focus() {},
  click() { activeChat = id; clicks.push(id); },
  innerText:`${id} preview`, textContent:`${id} preview`,
});
const rows = [makeRow('hidden-direct-1'), makeRow('hidden-direct-2')];
let listScrollTop = 0;
let listScrollHeight = 300;
let freezeListScroll = false;
const list = {
  get scrollTop() { return listScrollTop; },
  set scrollTop(value) { if (!freezeListScroll) listScrollTop = Number(value); },
  get scrollHeight() { return listScrollHeight; },
  clientHeight:300,
  querySelectorAll(selector) { return /listitem|role="row"|cell-frame-container/.test(selector) ? rows : []; },
  dispatchEvent() {},
};
const message = {
  parentElement:null,
  classList:{ contains(value) { return directionKnown && value === 'message-in'; } },
  getAttribute(name) {
    if (name === 'data-id') return `message-${activeChat}`;
    if (name === 'data-pre-plain-text') return '[10:00, 13/11/2026] Customer:';
    return '';
  },
  querySelector(){ return null; }, querySelectorAll(){ return []; },
  closest(selector) { return selector.includes('.message-in') ? message : null; },
  innerText:'history body', textContent:'history body', outerHTML:'<div class="message-in"></div>',
};
const pane = {
  scrollTop:0, scrollHeight:200, clientHeight:200,
  getAttribute(name) { return name === 'aria-busy' ? 'false' : ''; },
  querySelectorAll(selector) { return activeChat && /msg-container|message-in|message-out|pre-plain-text|data-id/.test(selector) ? [message] : []; },
  querySelector(selector) { return activeChat && /msg-container|message-in|message-out|pre-plain-text|selectable-text/.test(selector) ? message : null; },
  dispatchEvent() {},
};
const header = {
  getAttribute(name) { return name === 'data-id' ? activeChat : ''; },
  querySelector(){ return null; }, querySelectorAll(){ return []; },
  get innerText(){ return activeChat; }, get textContent(){ return activeChat; },
};
const document = {
  body:{},
  querySelector(selector) {
    if (selector.includes('conversation-header') || selector.includes('#main header')) return activeChat ? header : null;
    if (selector.includes('#pane-side') || selector.includes('chat-list') || selector === '[role="grid"]') return list;
    if (selector.includes('conversation-panel') || selector.includes('Messages') || selector.includes('消息') || selector.includes('copyable-area')) return pane;
    if (selector.includes('#main [data-pre-plain-text]')) return activeChat ? message : null;
    return null;
  },
  querySelectorAll(selector) {
    if (selector.includes('#pane-side') || selector.includes('chat-list') || selector === '[role="grid"]') return [list];
    if (/listitem|role="row"|cell-frame-container/.test(selector)) return rows;
    if (selector.includes('conversation-panel') || selector.includes('Messages') || selector.includes('消息') || selector.includes('copyable-area')) return [pane];
    if (/msg-container|data-pre-plain-text/.test(selector)) return activeChat ? [message] : [];
    return [];
  },
};

let now = Date.parse('2026-11-13T00:00:00Z');
class FakeDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
let nextTimer = 0;
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
  setTimeout(callback, delay = 0) { const id=++nextTimer; dormantTimers.set(id, { callback, delay }); return id; },
  clearTimeout(id) { dormantTimers.delete(id); },
  setInterval(){ return 1; }, clearInterval(){},
  Date:FakeDate, JSON, Math, Set, Map, String, Number, Object, Array,
};

vm.runInNewContext(script, sandbox);
sandbox.window.__zhikeStopCapture();
posted.length = 0; clicks.length = 0; activeChat = '';
const started = sandbox.window.__zhikeWsCollectAllRead();
assert.equal(started.started, true);

let advanced = 0;
let ticks = 0;
while (!posted.some(packet => packet.eventName === 'collection-retry-scheduled') && ticks++ < 80) {
  now += 500;
  advanced += Number(sandbox.window.__zhikeWsBackgroundTick().advanced || 0);
}

assert.ok(posted.some(packet => packet.eventName === 'collection-retry-scheduled'), 'the first hidden pass reaches a durable retry state');
assert.equal(posted.filter(packet => packet.eventName === 'collection-run-start').length, 1);
assert.ok(!posted.some(packet => packet.historyFinal === true), 'unresolved direction never produces a false final packet');

// Reproduce the real minimized-window failure: a full-list scan starts while
// its virtual scroll setter no longer advances. The explicit history retry
// must pre-empt it instead of waiting for the ten-minute discovery deadline.
listScrollHeight = 900;
freezeListScroll = true;
const blockedFullList = sandbox.window.__zhikeWsDiscoverAll();
assert.equal(blockedFullList.scanning, true);
directionKnown = true;
while (posted.filter(packet => packet.eventName === 'collection-run-start').length < 2 && ticks++ < 120) {
  now += 500;
  advanced += Number(sandbox.window.__zhikeWsBackgroundTick().advanced || 0);
}
assert.equal(posted.filter(packet => packet.eventName === 'collection-run-start').length, 2, 'priority retry pre-empts a stalled full-list scan without restoring the route');
assert.ok(posted.some(packet => packet.coverage === 'page-list-interrupted'), 'the pre-empted list scan preserves its partial checkpoint as interrupted');
listScrollHeight = 300;
freezeListScroll = false;
listScrollTop = 0;
while (!posted.some(packet => packet.eventName === 'collection-complete') && ticks++ < 180) {
  now += 500;
  advanced += Number(sandbox.window.__zhikeWsBackgroundTick().advanced || 0);
}

assert.ok(frameRequests > 0, 'production attempted normal paint-frame yielding');
assert.ok(dormantTimers.size > 0, 'fixture kept browser-owned timers dormant like a hidden WebView');
assert.ok(advanced > 0, 'native heartbeat drained due private collector tasks');
assert.deepEqual(clicks.slice(0, 2), ['hidden-direct-1', 'hidden-direct-2'], 'background ticks advance from one full conversation to the next without rAF callbacks');
assert.deepEqual(clicks.slice(-2), ['hidden-direct-1', 'hidden-direct-2'], 'a retry pass restarts automatically and reaches both conversations while still hidden');
assert.equal(posted.filter(packet => packet.eventName === 'collection-run-start').length, 2, 'native ticks start exactly one second pass without restoring the WS route');
assert.equal(posted.filter(packet => packet.historyPacket && packet.historyFinal).length, 2, 'both conversations receive final full-history packets in hidden mode');
assert.ok(posted.some(packet => packet.eventName === 'collection-complete'), 'the hidden collector reaches a finite completion state');

console.log('WS hidden scheduler runtime: dormant rAF/page timers are advanced safely by the native heartbeat');
