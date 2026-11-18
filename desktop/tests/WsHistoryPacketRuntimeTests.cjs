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
let clickCount = 0;
let rowPreview = '客户一 最新消息';
const row = {
  getAttribute(name) { return name === 'data-id' ? 'chat-1' : name === 'data-chat-type' ? 'direct' : ''; },
  querySelectorAll() { return []; },
  querySelector(selector) {
    if (selector === '[title], span[dir="auto"]' || selector === 'span[dir="auto"]') return { getAttribute: () => '客户一', textContent: '客户一' };
    return null;
  },
  closest() { return null; },
  scrollIntoView() {},
  click() { activeChat = 'chat-1'; clickCount += 1; },
  get innerText() { return rowPreview; }, get textContent() { return rowPreview; },
};
let listScrollTop = 420;
const container = {
  get scrollTop() { return listScrollTop; }, set scrollTop(value) { listScrollTop = Number(value); },
  scrollHeight: 300, clientHeight: 300,
  querySelectorAll(selector) { return selector.includes('listitem') || selector.includes('[role="row"]') || selector.includes('cell-frame-container') ? [row] : []; },
  dispatchEvent() {},
};
const longBody = `  第一行保留前导空格\n第二行  保留连续空格\n${'长正文片段 '.repeat(2200)}\n末行保留  `;
assert.ok(longBody.length > 12000, 'fixture must exercise a body well beyond the retired 6,000-character cap');
let firstBody = longBody;
const quoteBlock = { innerText:'引用内容\n嵌套内容', textContent:'引用内容\n嵌套内容', parentElement:{ closest(){ return null; } } };
const nestedQuoteBlock = { innerText:'嵌套内容', textContent:'嵌套内容', parentElement:{ closest(){ return quoteBlock; } } };
const replyBlockOne = { innerText:'实际回复第一段', textContent:'实际回复第一段', parentElement:{ closest(){ return null; } } };
const replyBlockTwo = { innerText:'实际回复第二段  保留空格', textContent:'实际回复第二段  保留空格', parentElement:{ closest(){ return null; } } };
const multiBlockExpected = '引用内容\n嵌套内容\n实际回复第一段\n实际回复第二段  保留空格';
let forceUnknownDirection = false;
let forceTailConflict = false;
let forceInvalidPalette = false;
const messageNodes = Array.from({ length: 620 }, (_, index) => {
  const outgoing = index % 2 === 1;
  const directionClass = outgoing ? 'message-out' : 'message-in';
  const dataIdOnly = index === 4 || index === 5;
  const tailOnly = index === 6 || index === 7;
  const paletteOnly = index === 8 || index === 9;
  const geometryOnly = index === 10 || index === 11;
  const body = () => index === 0 ? firstBody : (index === 2 || index === 3 ? '双方完全相同的一句话' : `历史消息-${index + 1}`);
  let inner, middle, paletteBubble;
  const paletteAnchor = {
    tagName:'SPAN', parentElement:null, _paletteIndex:index,
    classList:{contains(){return false;}},
    getAttribute(name){ return name === 'data-pre-plain-text' ? `[10:00, 01/10/2026] 客户一:` : ''; },
    querySelector(){return null;}, matches(selector){return selector === '[data-pre-plain-text]';},
  };
  const outer = {
    tagName:'DIV', parentElement:null, _background:paletteOnly ? (outgoing ? 'rgb(255, 255, 255)' : 'rgb(217, 253, 211)') : 'rgba(0,0,0,0)',
    classList: { contains(value) { return !dataIdOnly && !tailOnly && !paletteOnly && !geometryOnly && !(forceUnknownDirection && index === 0) && value === directionClass; } },
    getAttribute(name) { return name === 'data-id' ? (dataIdOnly ? `${outgoing ? 'true' : 'false'}_native-${index + 1}` : `msg-${index + 1}`) : ''; },
    querySelector(selector) {
      if (selector === '[data-pre-plain-text]') return inner;
      if (tailOnly && selector === `[data-icon="${outgoing ? 'tail-in' : 'tail-out'}"]`) return { adjacentMessageTail:true };
      return null;
    },
    querySelectorAll(selector) { return index === 1 && selector === 'span.selectable-text' ? [quoteBlock, nestedQuoteBlock, replyBlockOne, replyBlockTwo] : []; },
    closest(selector) { return selector.includes('.message-out') || selector.includes('.message-in') ? outer : null; },
    get innerText() { return body(); }, get textContent() { return body(); },
    getBoundingClientRect() {
      if (!geometryOnly) return { left:0, width:1200 };
      return outgoing ? { left:1040, width:140 } : { left:20, width:140 };
    },
    outerHTML: `<div class="${directionClass}"><div data-testid="msg-container"></div></div>`,
  };
  middle = {
    tagName:'DIV', parentElement:outer,
    classList:{contains(){return false;}},
    getAttribute(name){ if(name === 'data-id') return `decoration-${index + 1}`; if(name === 'role' && tailOnly) return 'row'; return ''; },
    querySelector(){ return null; }, matches(){ return false; },
    getBoundingClientRect() {
      if (!geometryOnly) return { left:0, width:1200 };
      return outgoing ? { left:1050, width:120 } : { left:30, width:120 };
    },
  };
  paletteBubble = {
    tagName:'DIV', parentElement:null, _background:outgoing ? 'rgb(217, 253, 211)' : 'rgb(255, 255, 255)',
    classList:{contains(){return false;}}, getAttribute(){return '';}, querySelector(){return null;}, matches(){return false;},
  };
  paletteAnchor.parentElement = paletteBubble;
  inner = {
    tagName:'DIV', parentElement:middle,
    classList: { contains() { return false; } },
    getAttribute(name) {
      if (name === 'data-id') return `msg-${index + 1}`;
      if (name === 'data-testid') return 'msg-container';
      if (name === 'data-pre-plain-text') return `[10:${String(index % 60).padStart(2, '0')}, ${String((index % 28) + 1).padStart(2, '0')}/10/2026] 客户一:`;
      return '';
    },
    querySelector(selector) {
      if (selector === '[data-pre-plain-text]' && (paletteOnly || (forceInvalidPalette && index === 0))) return paletteAnchor;
      if (forceTailConflict && index === 0 && (selector === '[data-icon="tail-out"]' || selector === '[data-icon="tail-in"]')) return {};
      if (tailOnly && selector === `[data-icon="${outgoing ? 'tail-out' : 'tail-in'}"]`) return {};
      return null;
    },
    querySelectorAll(selector) { return index === 1 && selector === 'span.selectable-text' ? [quoteBlock, nestedQuoteBlock, replyBlockOne, replyBlockTwo] : []; },
    closest(selector) {
      if (selector === '.message-in, .message-out, [data-testid="msg-container"]') return inner;
      if (selector === '.message-out, .message-in' || selector === '.message-in, .message-out') return forceUnknownDirection && index === 0 ? null : outer;
      if (selector.includes('[data-testid="msg-container"]')) return inner;
      return null;
    },
    get innerText() { return body(); }, get textContent() { return body(); },
    getBoundingClientRect() {
      if (!geometryOnly) return { left:0, width:1200 };
      return outgoing ? { left:1060, width:100 } : { left:40, width:100 };
    },
    outerHTML: '<div data-testid="msg-container"></div>',
  };
  paletteBubble.parentElement = inner;
  return inner;
});
const pane = {
  scrollTop: 0, scrollHeight: 600, clientHeight: 600,
  querySelectorAll(selector) { return /msg-container|message-in|message-out|pre-plain-text|data-id/.test(selector) ? messageNodes : []; },
  querySelector() { return messageNodes[0]; },
  dispatchEvent() {},
  getBoundingClientRect() { return { left:0, width:1200, top:0, height:600 }; },
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
    if (selector.includes('#main [data-pre-plain-text]')) return messageNodes[0];
    return null;
  },
  querySelectorAll(selector) {
    if (selector.includes('#pane-side') || selector.includes('chat-list') || selector === '[role="grid"]') return [container];
    if (selector.includes('conversation-panel') || selector.includes('Messages') || selector.includes('消息') || selector.includes('copyable-area')) return [pane];
    if (selector.includes('listitem') || selector.includes('[role="row"]') || selector.includes('cell-frame-container')) return [row];
    if (selector.includes('msg-container') || selector.includes('data-pre-plain-text')) return messageNodes;
    return [];
  },
};
const posted = [];
const timers = [];
const frames = [];
const storage = new Map();
let mutationCallback = null;
const sandbox = {
  window: { chrome: { webview: { postMessage(raw) { posted.push(JSON.parse(raw)); } } }, addEventListener() {} },
  document,
  localStorage: { getItem(key) { return storage.get(key) || null; }, setItem(key, value) { storage.set(key, value); } },
  MutationObserver: class { constructor(callback) { mutationCallback = callback; } observe() {} disconnect() {} },
  Event: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
  requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
  setTimeout(callback) { timers.push(callback); return timers.length; }, clearTimeout() {},
  setInterval() { return 1; }, clearInterval() {},
  getComputedStyle(node) {
    const invalid = forceInvalidPalette && node?._paletteIndex === 0;
    return {
      backgroundColor: node?._background || 'rgba(0, 0, 0, 0)', alignSelf:'auto', textAlign:'',
      getPropertyValue(name) {
        if (name === '--outgoing-background') return invalid ? 'rgb(255, 255, 255)' : 'rgb(217, 253, 211)';
        if (name === '--incoming-background') return 'rgb(255, 255, 255)';
        return '';
      },
    };
  },
  Date, JSON, Math, Set, Map, String, Number, Object, Array,
};
vm.runInNewContext(script, sandbox);
sandbox.window.__zhikeStopCapture();
timers.length = 0; frames.length = 0; posted.length = 0;
const assertLocalTimestamp = (raw, expected) => {
  const iso = sandbox.window.__zhikeWsCollectorDiagnostics.parseMessageTimestamp(raw);
  assert.ok(iso, `timestamp should parse: ${raw}`);
  const value = new Date(iso);
  assert.deepEqual(
    [value.getFullYear(), value.getMonth() + 1, value.getDate(), value.getHours(), value.getMinutes()],
    expected,
    `localized timestamp components changed: ${raw}`,
  );
};
assertLocalTimestamp('[上午10:38, 2026年11月4日] 客户一:', [2026, 11, 4, 10, 38]);
assertLocalTimestamp('[2026年11月4日 下午3:07] 客户一:', [2026, 11, 4, 15, 7]);
assertLocalTimestamp('[22:05, 2026/11/04] 客户一:', [2026, 11, 4, 22, 5]);
assertLocalTimestamp('[04/11/2026, 22:05] 客户一:', [2026, 11, 4, 22, 5]);
assertLocalTimestamp('[10:05 PM, 11/23/2026] Customer:', [2026, 11, 23, 22, 5]);
assert.equal(sandbox.window.__zhikeWsCollectorDiagnostics.parseMessageTimestamp('[未知时间] 客户一:'), '', 'unknown timestamps must stay unknown instead of using collection time');
activeChat = 'chat-1';
const visibleCapture = sandbox.window.__zhikeWsCapture();
assert.equal(visibleCapture.messages[0].conversationKey, 'chat-1', 'visible capture uses the current conversation header identity');
assert.equal(visibleCapture.messages[1].conversationKey, 'chat-1', 'different bubble data-id values must not split one customer into multiple conversations');
assert.equal(visibleCapture.messages[0].externalMessageId, 'msg-1');
assert.equal(visibleCapture.messages[1].externalMessageId, 'msg-2');
assert.equal(visibleCapture.messages[0].direction, 'incoming', 'white incoming bubble keeps the customer role');
assert.equal(visibleCapture.messages[1].direction, 'outgoing', 'green outgoing bubble is detected through the outer wrapper');
assert.equal(visibleCapture.messages[1].directionSource, 'class-message-out', 'direction is backed by an explicit DOM signal');
assert.equal(visibleCapture.messages[5].direction, 'outgoing', 'ancestor traversal reaches an outer true_ id behind unrelated inner ids');
assert.equal(visibleCapture.messages[5].directionSource, 'data-id-outgoing', 'outer explicit id is recorded as the direction source');
assert.equal(visibleCapture.messages[5].externalMessageId, 'true_native-6', 'the traversed explicit id remains the canonical message id');
assert.equal(visibleCapture.messages[6].direction, 'incoming', 'tail-in identifies the customer message within its own row');
assert.equal(visibleCapture.messages[6].directionSource, 'icon-tail-in');
assert.equal(visibleCapture.messages[7].direction, 'outgoing', 'adjacent tail-out identifies only its own operator message');
assert.equal(visibleCapture.messages[7].directionSource, 'icon-tail-out');
assert.equal(visibleCapture.messages[8].direction, 'incoming', 'nearest in-message white palette identifies a tailless customer bubble');
assert.equal(visibleCapture.messages[8].directionSource, 'palette-incoming');
assert.equal(visibleCapture.messages[9].direction, 'outgoing', 'nearest in-message green palette identifies a tailless operator bubble');
assert.equal(visibleCapture.messages[9].directionSource, 'palette-outgoing');
assert.equal(visibleCapture.messages[10].direction, 'incoming', 'left-aligned bubble uses geometry when explicit direction signals are absent');
assert.equal(visibleCapture.messages[10].directionSource, 'geometry-left');
assert.equal(visibleCapture.messages[11].direction, 'outgoing', 'right-aligned bubble uses geometry when explicit direction signals are absent');
assert.equal(visibleCapture.messages[11].directionSource, 'geometry-right');
forceUnknownDirection = true; forceTailConflict = true;
assert.ok(!sandbox.window.__zhikeWsCapture().messages.some(message => message.externalMessageId === 'msg-1'), 'conflicting tail evidence remains unknown');
forceTailConflict = false; forceInvalidPalette = true;
assert.ok(!sandbox.window.__zhikeWsCapture().messages.some(message => message.externalMessageId === 'msg-1'), 'equal incoming/outgoing palettes cannot classify a message');
const earlyStructureDiagnostic = posted.find(packet => packet.eventName === 'direction-unresolved-structure');
forceUnknownDirection = false; forceInvalidPalette = false;
const sameSentence = visibleCapture.messages.filter(message => message.body === '双方完全相同的一句话');
assert.deepEqual(Array.from(sameSentence, message => message.direction), ['incoming', 'outgoing'], 'identical text from both speakers remains two role-distinct messages');
assert.ok(!visibleCapture.messages.some(message => /^msg-[12]$/.test(message.conversationKey)), 'message bubble data-id is never used as a conversation key');
activeChat = 'different-chat';
assert.equal(sandbox.window.__zhikeWsCollectorDiagnostics.matchesCurrentConversation({ conversationKey:'chat-1', displayName:'客户一' }), false, 'a stale or failed click must not be attributed to the target customer');
activeChat = '';

const started = sandbox.window.__zhikeWsCollectAllRead();
assert.equal(started.started, true);
assert.equal(listScrollTop, 0, 'history collection must start from the top of the chat list');
let guard = 0;
while ((timers.length || frames.length) && guard++ < 10000) {
  while (frames.length) frames.shift()();
  if (timers.length) timers.shift()();
}
assert.ok(guard < 10000, 'collector did not settle');
assert.equal(clickCount, 1, 'the read conversation is opened once');

const historyPackets = posted.filter(packet => packet.historyPacket === true);
assert.ok(historyPackets.length >= 3, 'large histories must be chunked');
assert.ok(historyPackets.slice(0, -1).every(packet => packet.conversations[0].historyLoaded === false), 'non-final chunks must not claim full history');
assert.equal(historyPackets.at(-1).conversations[0].historyLoaded, true, 'only the final chunk claims full history');
assert.equal(historyPackets.at(-1).conversations[0].directionVersion, 4, 'only a direction-verified v4 capture may confirm full history');
assert.ok(historyPackets.every(packet => packet.conversations[0].unreadCount === 0), 'every chunk carries authoritative unread state');
const orders = historyPackets.flatMap(packet => packet.messages.map(message => message.order));
assert.deepEqual(orders, Array.from({ length: 620 }, (_, index) => index + 1), 'message order remains globally monotonic across chunks');
const transportedLongBody = historyPackets.flatMap(packet => packet.messages).find(message => message.externalMessageId === 'msg-1')?.body;
assert.equal(transportedLongBody, longBody, 'long multiline body must remain byte-for-byte identical in the bridge packet');
const transportedTimestamp = historyPackets.flatMap(packet => packet.messages).find(message => message.externalMessageId === 'msg-1');
assert.equal(transportedTimestamp.timestampText, '10:00, 01/10/2026', 'original WhatsApp preamble timestamp metadata is preserved without the sender name');
assert.equal(transportedTimestamp.timestampSource, 'whatsapp-preamble', 'parsed message time declares its authoritative source');
const transportedMultiBlock = historyPackets.flatMap(packet => packet.messages).find(message => message.externalMessageId === 'msg-2')?.body;
assert.equal(transportedMultiBlock, multiBlockExpected, 'quoted and multi-block reply text stays ordered while nested selectable spans are not duplicated');
assert.ok(historyPackets.every(packet => Buffer.byteLength(JSON.stringify(packet), 'utf8') <= 600000), 'every UTF-8 history packet stays within the 600 KB bridge budget');
assert.ok(historyPackets.flatMap(packet => packet.messages).every(message => /^2026-10-/.test(message.sentAt)), 'original message timestamps are preserved');
assert.ok(posted.some(packet => packet.eventName === 'collection-complete'), 'collector emits a completion event');

const final = historyPackets.at(-1).conversations[0];
sandbox.window.__zhikeWsAcknowledgeHistory([{ conversationKey:final.conversationKey, fingerprint:final.lastMessageFingerprint, historyMessageCount:final.historyMessageCount, conversationType:'direct' }]);
posted.length = 0; timers.length = 0; frames.length = 0; activeChat = ''; listScrollTop = 200;
sandbox.window.__zhikeWsCollectAllRead();
guard = 0;
while ((timers.length || frames.length) && guard++ < 10000) {
  while (frames.length) frames.shift()();
  if (timers.length) timers.shift()();
}
assert.equal(clickCount, 1, 'restart checkpoint skips an unchanged completed chat');
assert.equal(posted.filter(packet => packet.historyPacket).length, 0, 'checkpoint resume does not re-ingest unchanged history');

// A read message sent from the phone changes the list fingerprint. The DOM
// observer must schedule an incremental pass, reopen that one conversation and
// emit a new final packet so the server can re-run AI after durable ingest.
posted.length = 0; timers.length = 0; frames.length = 0;
rowPreview = '客户一 手机端新增消息';
mutationCallback?.([]);
guard = 0;
while ((timers.length || frames.length) && guard++ < 10000) {
  while (frames.length) frames.shift()();
  if (timers.length) timers.shift()();
}
assert.ok(guard < 10000, 'incremental collector did not settle');
assert.equal(clickCount, 2, 'changed phone fingerprint must reopen the acknowledged conversation exactly once');
assert.ok(posted.some(packet => packet.historyPacket && packet.historyFinal === true), 'phone increment must emit a new final history packet');

// A message beyond the supported 128,000-character body boundary must never
// be truncated and reported as complete. The conversation remains retryable so
// the original can be recaptured after an explicit compatibility fix.
posted.length = 0; timers.length = 0; frames.length = 0; activeChat = '';
firstBody = `oversized\n${'x'.repeat(128001)}`;
rowPreview = '客户一 超长正文待重试';
sandbox.window.__zhikeWsCollectAllRead();
guard = 0;
while (!posted.some(packet => packet.eventName === 'collection-retry-scheduled') && (timers.length || frames.length) && guard++ < 10000) {
  while (frames.length) frames.shift()();
  if (timers.length) timers.shift()();
}
assert.ok(posted.some(packet => packet.eventName === 'collection-retry-scheduled'), 'oversized body schedules a retry instead of silent completion');
const oversizedCheckpoints = posted.flatMap(packet => packet.conversations || []).filter(item => item.conversationKey === 'chat-1');
assert.ok(oversizedCheckpoints.some(item => item.collectionStatus === 'retryable' && item.coverage === 'read-history-body-too-large'), 'oversized body is visible as a retryable checkpoint');
assert.ok(!posted.some(packet => packet.historyFinal === true), 'oversized body must never emit a final-history claim');

posted.length = 0; timers.length = 0; frames.length = 0; activeChat = '';
firstBody = '方向不明但原文必须等待安全重采';
forceUnknownDirection = true;
forceTailConflict = true;
rowPreview = '客户一 方向证据待重试';
sandbox.window.__zhikeWsCollectAllRead();
guard = 0;
while (!posted.some(packet => packet.eventName === 'collection-retry-scheduled') && (timers.length || frames.length) && guard++ < 10000) {
  while (frames.length) frames.shift()();
  if (timers.length) timers.shift()();
}
const directionUnknown = posted.flatMap(packet => packet.conversations || []).filter(item => item.conversationKey === 'chat-1');
assert.ok(directionUnknown.some(item => item.collectionStatus === 'retryable' && item.coverage === 'read-history-direction-unresolved'), 'unresolved direction stays visible and retryable');
assert.ok(!posted.some(packet => packet.historyFinal === true), 'unresolved direction cannot claim a complete history');
const structureDiagnostic = posted.find(packet => packet.eventName === 'direction-unresolved-structure') || earlyStructureDiagnostic;
assert.ok(structureDiagnostic?.directionSignals?.length > 0, 'unknown direction emits bounded technical structure diagnostics');
assert.ok(structureDiagnostic.directionSignals.length <= 12, 'direction diagnostics never walk beyond the bounded ancestor depth');
const diagnosticJson = JSON.stringify(structureDiagnostic);
assert.doesNotMatch(diagnosticJson, /方向不明但原文|客户一|msg-1|chat-1/, 'direction diagnostics never include message text or customer/message identifiers');
assert.ok(structureDiagnostic.directionSignals.every(signal => ['none','other','true','false'].includes(signal.dataPrefix)), 'data ids are reduced to a fixed prefix category');

console.log('WS history packet runtime: bidirectional roles, multiline fidelity, 600 KB chunking, durable resume, phone increment and retry safety pass');
