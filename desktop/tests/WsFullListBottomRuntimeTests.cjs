'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '..', '..');
const host = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Views', 'LegacyUiHostPage.xaml.cs'), 'utf8');
const match = host.match(/internal static string BuildWsCollectorScript\(string accountId\)\s*\{[\s\S]*?return \$\$"""([\s\S]*?)""";/);
assert.ok(match);
const script = match[1].replace(/\{\{encodedAccount\}\}/g, JSON.stringify('default'));

let listScrollTop = 0;
let activeChat = '';
const clicks = [];
const makeRow = id => ({
  getAttribute(name) { return name === 'data-id' ? id : name === 'data-chat-type' ? 'direct' : ''; },
  querySelectorAll() { return []; },
  querySelector(selector) {
    if (selector.includes('[title]') || selector.includes('span[dir="auto"]')) return { getAttribute: () => id, textContent: id };
    return null;
  },
  scrollIntoView() {}, closest() { return null; },
  click() { activeChat = id; clicks.push(id); },
  innerText: `${id} preview`, textContent: `${id} preview`,
});
const topRow = makeRow('chat-top');
const bottomRow = makeRow('chat-bottom');
const visibleRows = () => listScrollTop < 250 ? [topRow] : [bottomRow];
const container = {
  get scrollTop() { return listScrollTop; }, set scrollTop(value) { listScrollTop = Number(value); },
  scrollHeight: 600, clientHeight: 300,
  querySelectorAll(selector) { return /listitem|role="row"|cell-frame-container/.test(selector) ? visibleRows() : []; },
  dispatchEvent() {},
};
const messageNode = {
  classList: { contains(value) { return value === 'message-in'; } },
  getAttribute(name) {
    if (name === 'data-id') return `message-${activeChat}`;
    if (name === 'data-pre-plain-text') return '[10:00, 13/11/2026] Customer:';
    return '';
  },
  querySelector() { return null; }, closest(selector) { return selector.includes('.message-in') ? messageNode : null; },
  get innerText() { return `history-${activeChat}`; }, get textContent() { return `history-${activeChat}`; },
  outerHTML: '<div class="message-in"></div>',
};
const pane = {
  scrollTop: 0, scrollHeight: 300, clientHeight: 300,
  querySelectorAll(selector) { return /msg-container|message-in|message-out|pre-plain-text|data-id/.test(selector) ? [messageNode] : []; },
  querySelector() { return messageNode; }, dispatchEvent() {},
};
const header = {
  getAttribute(name) { return name === 'data-id' ? activeChat : ''; },
  querySelector() { return null; },
  get innerText() { return activeChat; }, get textContent() { return activeChat; },
};
const document = {
  body: {},
  querySelector(selector) {
    if (selector.includes('conversation-header') || selector.includes('#main header')) return activeChat ? header : null;
    if (selector.includes('#pane-side') || selector.includes('chat-list') || selector === '[role="grid"]') return container;
    if (selector.includes('conversation-panel') || selector.includes('Messages') || selector.includes('消息') || selector.includes('copyable-area')) return pane;
    if (selector.includes('#main [data-pre-plain-text]')) return messageNode;
    return null;
  },
  querySelectorAll(selector) {
    if (selector.includes('#pane-side') || selector.includes('chat-list') || selector === '[role="grid"]') return [container];
    if (/listitem|role="row"|cell-frame-container/.test(selector)) return visibleRows();
    if (selector.includes('conversation-panel') || selector.includes('Messages') || selector.includes('消息') || selector.includes('copyable-area')) return [pane];
    if (/msg-container|data-pre-plain-text/.test(selector)) return activeChat ? [messageNode] : [];
    return [];
  },
};
const posted = [];
const timers = [];
const frames = [];
let now = Date.parse('2026-11-13T00:00:00Z');
class FakeDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
const sandbox = {
  window: { chrome: { webview: { postMessage(raw) { posted.push(JSON.parse(raw)); } } }, addEventListener() {}, removeEventListener() {} },
  document,
  localStorage: { getItem() { return null; }, setItem() {} },
  MutationObserver: class { observe() {} disconnect() {} },
  Event: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
  MouseEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
  requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
  setTimeout(callback, delay = 0) { timers.push({ callback, delay:Number(delay) || 0 }); return timers.length; }, clearTimeout() {},
  setInterval() { return 1; }, clearInterval() {},
  Date: FakeDate, JSON, Math, Set, Map, String, Number, Object, Array,
};
vm.runInNewContext(script, sandbox);
timers.length = 0; frames.length = 0; posted.length = 0;

sandbox.window.__zhikeWsCollectAllRead();
let guard = 0;
while (!posted.some(packet => packet.eventName === 'collection-complete') && (timers.length || frames.length) && guard++ < 1000) {
  while (frames.length) { now += 16; frames.shift()(); }
  if (timers.length) { const timer = timers.shift(); now += Math.max(1, timer.delay); timer.callback(); }
}
assert.ok(guard < 1000, 'collector did not settle within the bounded fake clock');
assert.deepEqual(clicks, ['chat-top', 'chat-bottom'], 'collector must render and process the physical bottom window before declaring completion');
assert.equal(posted.filter(packet => packet.historyPacket && packet.historyFinal).length, 2, 'both conversations must receive a final history packet');
assert.ok(posted.some(packet => packet.eventName === 'collection-complete'), 'completion is emitted after the bottom window is processed');

console.log('WS full-list runtime: the physical bottom window is rendered and collected before completion');
