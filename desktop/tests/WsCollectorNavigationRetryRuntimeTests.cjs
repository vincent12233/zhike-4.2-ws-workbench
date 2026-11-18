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

let activeChat = '';
let activeTitle = '';
const clicks = [];
const windowListeners = new Map();
const bubbleToWindow = (type, event, target) => {
  event.target = target;
  for (const handler of windowListeners.get(type) || []) handler(event);
};
const makeRow = ({ id = '', title, ariaLabel = '', onClick }) => {
  let activationArmed = false;
  const identityTitleNode = {
    getAttribute(name) { return name === 'title' ? title : ''; },
    textContent: title,
    closest() { return null; },
  };
  const activationTarget = {
    getAttribute(name) {
      if (name === 'role') return 'gridcell';
      if (name === 'tabindex') return '0';
      if (name === 'aria-label') return title;
      return '';
    },
    scrollIntoView() {}, focus() {}, getBoundingClientRect() { return { left:10, top:20, width:80, height:40 }; },
    dispatchEvent(event) {
      bubbleToWindow(event.type, event, this);
      if (event.type === 'pointerdown' && event.button === 0 && event.buttons === 1 && event.detail === 1 && event.clientX === 50 && event.clientY === 40) activationArmed = true;
      return true;
    },
    click() {
      clicks.push(id || 'archive-navigation');
      if (activationArmed) onClick();
      activationArmed = false;
    },
  };
  return {
  getAttribute(name) {
    if (name === 'data-id') return id;
    if (name === 'role') return 'row';
    if (name === 'title') return title;
    if (name === 'aria-label') return ariaLabel;
    if (name === 'data-chat-type') return id ? 'direct' : '';
    return '';
  },
  querySelectorAll(selector) {
    if (/span\[dir="auto"\]\[title\]|cell-frame-title/.test(selector)) return [identityTitleNode];
    return /gridcell|cell-frame-container|tabindex/.test(selector) ? [activationTarget] : [];
  },
  querySelector(selector) {
    if (selector === '[title], span[dir="auto"]' || selector === 'span[dir="auto"]')
      return { getAttribute: name => name === 'title' ? '打开资料' : '', textContent: '打开资料' };
    return null;
  },
  scrollIntoView() {}, closest() { return container; },
  dispatchEvent(event) { bubbleToWindow(event.type, event, this); return true; },
  click() { clicks.push(id || 'archive-navigation'); onClick(); },
  innerText: title, textContent: title,
  };
};
const rows = [
  makeRow({ title: '已归档 2', ariaLabel: '已归档 2', onClick() { activeChat = 'archive-navigation'; } }),
  makeRow({ id: 'chat-failure', title: '身份失败客户', onClick() { activeChat = 'different-chat'; activeTitle = '另一位客户'; } }),
  makeRow({ id: 'chat-success', title: '成功客户', onClick() { activeChat = 'chat-success'; activeTitle = '成功客户'; } }),
];
const container = {
  scrollTop: 0, scrollHeight: 300, clientHeight: 300,
  querySelectorAll(selector) { return /listitem|role="row"|cell-frame-container/.test(selector) ? rows : []; },
  dispatchEvent() {},
};
const messageNode = {
  classList: { contains(value) { return value === 'message-in'; } },
  getAttribute(name) {
    if (name === 'data-id') return 'message-success-1';
    if (name === 'data-pre-plain-text') return '[10:00, 13/11/2026] 成功客户:';
    return '';
  },
  querySelector() { return null; }, closest(selector) { return selector.includes('.message-in') ? messageNode : null; },
  innerText: '完整历史消息', textContent: '完整历史消息', outerHTML: '<div class="message-in"></div>',
};
const pane = {
  scrollTop: 0, scrollHeight: 300, clientHeight: 300,
  querySelectorAll(selector) { return activeChat === 'chat-success' && /msg-container|message-in|message-out|pre-plain-text|data-id/.test(selector) ? [messageNode] : []; },
  querySelector(selector) { return activeChat === 'chat-success' && /msg-container|message-in|message-out|pre-plain-text|selectable-text/.test(selector) ? messageNode : null; },
  dispatchEvent() {},
};
const header = {
  getAttribute() { return ''; },
  querySelector(selector) {
    if (selector === '[title]') return { getAttribute: name => name === 'title' ? '查看头像' : '' };
    return null;
  },
  querySelectorAll(selector) {
    if (/span\[dir="auto"\]\[title\]|conversation-info-header/.test(selector)) return [{
      getAttribute(name) { return name === 'title' ? activeTitle : ''; },
      get textContent() { return activeTitle; },
      closest() { return null; },
    }];
    return [];
  },
  get innerText() { return `${activeTitle} 在线`; }, get textContent() { return `${activeTitle} 在线`; },
};
const document = {
  body: {},
  querySelector(selector) {
    // Exercise the non-semantic header variant used by current WhatsApp Web;
    // the collector must not depend on a literal <header> element.
    if (selector.includes('conversation-info-header')) return activeChat ? header : null;
    if (selector.includes('#pane-side') || selector.includes('chat-list') || selector === '[role="grid"]') return container;
    if (selector.includes('conversation-panel') || selector.includes('Messages') || selector.includes('消息') || selector.includes('copyable-area')) return pane;
    if (selector.includes('#main [data-pre-plain-text]')) return activeChat === 'chat-success' ? messageNode : null;
    return null;
  },
  querySelectorAll(selector) {
    if (selector.includes('#pane-side') || selector.includes('chat-list') || selector === '[role="grid"]') return [container];
    if (/listitem|role="row"|cell-frame-container/.test(selector)) return rows;
    if (selector.includes('conversation-panel') || selector.includes('Messages') || selector.includes('消息') || selector.includes('copyable-area')) return [pane];
    if (/msg-container|data-pre-plain-text/.test(selector)) return activeChat === 'chat-success' ? [messageNode] : [];
    return [];
  },
};
let now = Date.parse('2026-11-13T00:00:00Z');
class FakeDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
const posted = [];
const timers = [];
const frames = [];
const sandbox = {
  window: {
    chrome: { webview: { postMessage(raw) { posted.push(JSON.parse(raw)); } } },
    addEventListener(type, handler) { const handlers = windowListeners.get(type) || []; handlers.push(handler); windowListeners.set(type, handlers); },
    // Keep the captured handler available after the test calls stopCapture to
    // cancel the initial timer; production removal is covered by contracts.
    removeEventListener() {},
  },
  document,
  localStorage: { getItem() { return null; }, setItem() {} },
  MutationObserver: class { observe() {} disconnect() {} },
  Event: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
  MouseEvent: class { constructor(type, options) { this.type = type; this.isTrusted = false; Object.assign(this, options); } },
  requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
  setTimeout(callback, delay = 0) { timers.push({ callback, delay:Number(delay) || 0 }); return timers.length; }, clearTimeout() {},
  setInterval() { return 1; }, clearInterval() {},
  Date: FakeDate, JSON, Math, Set, Map, String, Number, Object, Array,
};
vm.runInNewContext(script, sandbox);
sandbox.window.__zhikeStopCapture();
timers.length = 0; frames.length = 0; posted.length = 0;

sandbox.window.__zhikeWsCollectAllRead();
let guard = 0;
while (!posted.some(packet => packet.eventName === 'collection-retry-scheduled') && (timers.length || frames.length) && guard++ < 1000) {
  while (frames.length) { now += 16; frames.shift()(); }
  if (timers.length) { const timer = timers.shift(); now += Math.max(1, timer.delay); timer.callback(); }
}
assert.ok(posted.some(packet => packet.eventName === 'collection-retry-scheduled'), 'one failed identity must not be requeued forever in the same pass');
assert.deepEqual(clicks, ['chat-failure', 'chat-success'], 'archive navigation is excluded and each valid conversation is attempted only once per pass');
assert.equal(activeChat, 'chat-success', 'chat activation uses a primary-button pointer sequence on the main focusable cell');
assert.ok(posted.some(packet => packet.historyPacket && packet.historyFinal && packet.conversations[0].conversationKey === 'chat-success'), 'the second valid customer must still finish full-history collection');
assert.ok(posted.some(packet => packet.eventName === 'collection-window' && packet.rowCount === 2 && packet.readCount === 2 && packet.skipCount === 0 && packet.pendingCount >= 1 && packet.domNodeKnownCount === 2), 'window diagnostics expose only aggregate read/skip/pending/DOM-node counts');
const failureCheckpoints = posted.flatMap(packet => packet.conversations || []).filter(item => item.conversationKey === 'chat-failure');
assert.ok(failureCheckpoints.length > 0, 'identity failure must be persisted as checkpoint metadata');
assert.equal(failureCheckpoints.at(-1).collectionStatus, 'retryable', 'the final metadata for a failed conversation remains visibly retryable');
activeTitle = 'CustomerAlpha';
assert.equal(sandbox.window.__zhikeWsCollectorDiagnostics.matchesCurrentConversation({ displayName:'PrefixCustomerAlpha' }), false, 'human names require an exact normalized match and must never use suffix matching');
activeTitle = '+91 98765 43210';
assert.equal(sandbox.window.__zhikeWsCollectorDiagnostics.matchesCurrentConversation({ displayName:'9876543210' }), true, 'normalized phone identities may use a country-code suffix match');

// A genuine user pointer event must still yield control immediately. Synthetic
// MouseEvents above bubble through this exact same window capture handler.
sandbox.window.__zhikeStopCapture();
timers.length = 0; frames.length = 0; posted.length = 0; clicks.length = 0; activeChat = '';
sandbox.window.__zhikeWsCollectAllRead();
bubbleToWindow('pointerdown', { type:'pointerdown', isTrusted:true }, rows[1]);
while (frames.length) frames.shift()();
assert.ok(posted.some(packet => packet.eventName === 'collection-paused' && packet.reason === 'user-interaction'), 'trusted user pointerdown must pause collection');
assert.equal(clicks.length, 0, 'trusted user interaction pauses before an automatic click');
let resumeGuard = 0;
while (!clicks.length && (timers.length || frames.length) && resumeGuard++ < 200) {
  while (frames.length) { now += 16; frames.shift()(); }
  if (timers.length) { const timer = timers.shift(); now += Math.max(1, timer.delay); timer.callback(); }
}
assert.equal(clicks[0], 'chat-failure', 'collection resumes from a new pass after trusted user activity becomes idle');

console.log('WS navigation/retry runtime: archive rows are excluded and identity failures do not block later customers');
