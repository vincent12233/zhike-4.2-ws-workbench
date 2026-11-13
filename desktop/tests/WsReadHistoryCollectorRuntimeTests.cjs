'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '..', '..');
const host = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Views', 'LegacyUiHostPage.xaml.cs'), 'utf8');
const match = host.match(/return \$\$"""([\s\S]*?)""";/);
assert.ok(match, 'WS collector raw script must remain embedded in the native host');
assert.match(match[1], /historyLoaded:\s*isFinal/, 'collector must claim full history only on the final durable packet');
const script = match[1].replace(/\{\{encodedAccount\}\}/g, JSON.stringify('default'));

const clicks = [];
let activeChat = '';
const rows = [
  {
    getAttribute(name) { return name === 'data-id' ? 'read-1' : name === 'data-chat-type' ? 'direct' : ''; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    closest() { return null; },
    click() { clicks.push('read-1'); activeChat = 'read-1'; },
    innerText: '已读客户 最新消息', textContent: '已读客户 最新消息',
  },
  {
    getAttribute(name) { return name === 'data-id' ? 'unread-1' : name === 'data-chat-type' ? 'direct' : ''; },
    querySelectorAll(selector) {
      if (selector.includes('[aria-label]') || selector.includes('[data-testid]')) return [{
        textContent: '2',
        getAttribute(name) { return name === 'aria-label' ? '2 unread messages' : name === 'data-testid' ? 'icon-unread-count' : ''; },
      }];
      return [];
    },
    querySelector(selector) {
      if (selector.includes('unread')) return { textContent: '2', getAttribute: () => '2' };
      return null;
    },
    closest() { return null; },
    click() { clicks.push('unread-1'); activeChat = 'unread-1'; },
    innerText: '未读客户 2 条未读消息', textContent: '未读客户 2 条未读消息',
  },
];
const container = {
  scrollTop: 0, scrollHeight: 200, clientHeight: 200,
  querySelectorAll(selector) { return selector.includes('listitem') || selector.includes('cell-frame-container') || selector.includes('[role="row"]') ? rows : []; },
  dispatchEvent() {},
};
let directionUnknown = false;
function createMessageNode(id, body) {
  const messageRow = {
    parentElement: null,
    classList: { contains() { return false; } },
    getAttribute(name) { return name === 'role' ? 'row' : ''; },
    querySelector() { return null; },
    matches() { return false; },
  };
  const messageBubble = {
    parentElement: messageRow,
    innerText: body, textContent: body,
    classList: { contains(value) { return !directionUnknown && value === 'message-in'; } },
    getAttribute(name) { return name === 'data-testid' ? 'msg-container' : ''; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    matches() { return false; },
  };
  return {
    parentElement: messageBubble,
    innerText: body, textContent: body,
    classList: { contains() { return false; } },
    getAttribute(name) { return name === 'data-id' ? id : ''; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    matches() { return false; },
    closest(selector) {
      if (selector === '.message-in, .message-out, [data-testid="msg-container"]') return messageBubble;
      if (selector === '.message-out, .message-in' || selector === '.message-in, .message-out') return directionUnknown ? null : messageBubble;
      return null;
    },
  };
}
const messageNode = createMessageNode('msg-1', '历史消息一');
const delayedMessageNode = createMessageNode('msg-2', '网络稍后加载的更早消息');
let visibleMessageNodes = [messageNode];
let messagePaneHeight = 200;
let historyBusy = false;
const messagePane = {
  scrollTop: 0, clientHeight: 200,
  get scrollHeight() { return messagePaneHeight; },
  getAttribute(name) { return name === 'aria-busy' ? String(historyBusy) : ''; },
  querySelectorAll(selector) { return selector.includes('msg-container') || selector.includes('pre-plain-text') ? visibleMessageNodes : []; },
  dispatchEvent() {},
};
const posted = [];
const document = {
  body: {},
  querySelector(selector) {
    if (selector.includes('#pane-side') || selector.includes('chat-list')) return container;
    if (selector.includes('conversation-header') || selector.includes('#main header')) return activeChat ? {
      getAttribute(name) { return name === 'data-id' ? activeChat : ''; },
      querySelector() { return null; },
      innerText: activeChat,
      textContent: activeChat,
    } : null;
    if (selector.includes('conversation-panel') || selector.includes('Messages') || selector.includes('消息')) return messagePane;
    return null;
  },
  querySelectorAll(selector) {
    if (selector.includes('listitem') || selector.includes('cell-frame-container') || selector.includes('[role="row"]')) return rows;
    if (selector.includes('conversation-panel') || selector.includes('Messages') || selector.includes('消息')) return [messagePane];
    return [];
  },
};
const frames = [];
const timers = [];
let nowMs = Date.parse('2026-11-13T00:00:00.000Z');
let nextTimerId = 0;
class ControlledDate extends Date {
  constructor(...args) { super(...(args.length ? args : [nowMs])); }
  static now() { return nowMs; }
}
function scheduleTimer(callback, delay = 0) {
  const timer = { id: ++nextTimerId, callback, due: nowMs + Math.max(0, Number(delay) || 0), cancelled: false };
  timers.push(timer);
  return timer.id;
}
function cancelTimer(id) {
  const timer = timers.find(item => item.id === id);
  if (timer) timer.cancelled = true;
}
function runUntil(predicate, { deadline = Infinity, maxSteps = 10000 } = {}) {
  let steps = 0;
  while (!predicate() && steps < maxSteps) {
    if (frames.length) {
      frames.shift()();
      steps += 1;
      continue;
    }
    timers.sort((left, right) => left.due - right.due || left.id - right.id);
    while (timers[0]?.cancelled) timers.shift();
    const timer = timers[0];
    if (!timer || timer.due > deadline) break;
    timers.shift();
    nowMs = Math.max(nowMs, timer.due);
    timer.callback();
    steps += 1;
  }
  if (Number.isFinite(deadline) && nowMs < deadline) nowMs = deadline;
  return steps;
}
const sandbox = {
  window: { chrome: { webview: { postMessage(raw) { posted.push(JSON.parse(raw)); } } }, addEventListener() {} },
  document,
  MutationObserver: class { observe() {} disconnect() {} },
  Event: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
  requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
  setTimeout: scheduleTimer,
  clearTimeout: cancelTimer, setInterval() { return 1; }, clearInterval() {},
  Date: ControlledDate, JSON, Math, Set, Map, String, Number, Object, Array,
  localStorage: { getItem() { return null; }, setItem() {} },
};
vm.runInNewContext(script, sandbox);
assert.equal(typeof sandbox.window.__zhikeWsCollectAllRead, 'function', 'collector must expose automatic read-history collection');
const started = sandbox.window.__zhikeWsCollectAllRead();
assert.equal(started.started, true, 'automatic read-history collection should start asynchronously');
let steps = runUntil(() => posted.some(packet => packet.eventName === 'collection-complete'));
assert.ok(steps < 10000, 'finite read-history pass must not spin indefinitely');
assert.ok(posted.some(packet => packet.eventName === 'collection-complete'), 'the known-direction read pass completes');
assert.deepEqual(clicks, ['read-1'], 'automatic collector must never click unread rows');
assert.ok(posted.every(packet => !(packet.messages || []).some(message => message.conversationKey === 'unread-1')), 'unread conversation must not emit history messages');
const historyPackets = posted.filter(packet => packet.coverage === 'read-history');
assert.ok(historyPackets.length >= 1, 'read-history collection must identify history packets');
assert.ok(historyPackets.some(packet => packet.conversations.some(row => row.historyLoaded === true)), 'history packets must mark the conversation as fully loaded');
assert.ok(historyPackets.some(packet => packet.messages.some(message => message.body === '历史消息一')), 'valid nested message DOM must produce the visible message body');
assert.ok(historyPackets.every(packet => packet.messages.every(message => message.direction === 'incoming' && message.directionSource === 'class-message-in')), 'known incoming bubble has an explicit role signal');
sandbox.window.__zhikeStopCapture();
timers.length = 0; frames.length = 0; posted.length = 0; clicks.length = 0; activeChat = ''; directionUnknown = true;
sandbox.window.__zhikeWsCollectAllRead();
steps = runUntil(() => posted.some(packet => packet.eventName === 'collection-retry-scheduled'));
assert.ok(steps < 10000, 'unknown-role pass must reach an explicit retry state');
assert.ok(posted.some(packet => packet.eventName === 'collection-retry-scheduled'), 'unknown direction is retryable');
assert.ok(!posted.some(packet => packet.historyFinal === true), 'unknown direction cannot claim verified full history');
assert.ok(!clicks.includes('unread-1'), 'unknown-direction retries still never open unread chats');
sandbox.window.__zhikeStopCapture();
timers.length = 0; frames.length = 0; posted.length = 0; clicks.length = 0; activeChat = '';
directionUnknown = false;
visibleMessageNodes = [messageNode];
messagePaneHeight = 200;
messagePane.scrollTop = 0;
historyBusy = true;
const slowRunStartedAt = nowMs;
sandbox.window.__zhikeWsCollectAllRead();
steps = runUntil(() => false, { deadline: slowRunStartedAt + 5500, maxSteps: 1000 });
assert.ok(steps < 1000, 'busy history fixture must remain bounded');
assert.ok(!posted.some(packet => packet.historyFinal === true), 'aria-busy history loading must block a false full-history acknowledgement beyond the quiet threshold');

historyBusy = false;
const busyClearedAt = nowMs;
runUntil(() => false, { deadline: busyClearedAt + 1500, maxSteps: 1000 });
assert.ok(!posted.some(packet => packet.historyFinal === true), 'clearing the loader must start a fresh quiet window');

visibleMessageNodes = [messageNode, delayedMessageNode];
messagePaneHeight = 420;
const delayedGrowthAt = nowMs;
runUntil(() => false, { deadline: delayedGrowthAt + 1500, maxSteps: 1000 });
assert.ok(!posted.some(packet => packet.historyFinal === true), 'a delayed older message must reset the top quiet window');

steps = runUntil(() => posted.some(packet => packet.eventName === 'collection-complete'), { deadline: delayedGrowthAt + 12000, maxSteps: 5000 });
assert.ok(steps < 5000, 'slow history completion must remain bounded');
const slowFinal = posted.find(packet => packet.historyFinal === true);
assert.ok(slowFinal, 'history may complete after the loader clears and the delayed growth becomes quiet');
assert.deepEqual(slowFinal.messages.map(message => message.body).sort(), ['历史消息一', '网络稍后加载的更早消息'].sort(), 'the final packet must include the message that arrived after the former three-round heuristic');
assert.equal(slowFinal.conversations[0].historyMessageCount, 2);
assert.ok(!clicks.includes('unread-1'), 'slow-load probing must still never open unread chats');
sandbox.window.__zhikeStopCapture();
timers.length = 0; frames.length = 0;
console.log('WS read-history collector runtime: read-only collection, unknown fail-safe, busy guard and delayed-history quiet window passed');

