'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '..', '..');
const host = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Views', 'LegacyUiHostPage.xaml.cs'), 'utf8');
const match = host.match(/internal static string BuildWsCollectorScript\(string accountId\)\s*\{[\s\S]*?return \$\$"""([\s\S]*?)""";/);
assert.ok(match, 'WS collector raw script must remain embedded in the native host');
const script = match[1].replace(/\{\{encodedAccount\}\}/g, JSON.stringify('default'));

// Exercise the collector with a list larger than the native bridge limit. The
// mock returns all rows in one DOM window so this test isolates the transport
// contract (bounded payloads and complete key coverage) from WhatsApp's DOM
// virtualization details, which are covered by the static collector contract.
const rows = Array.from({ length: 5000 }, (_, id) => ({
  id,
  getAttribute(name) { return name === 'data-id' ? `chat-${id}` : ''; },
  querySelector(selector) {
    if (selector.includes('[title]') || selector.includes('span[dir="auto"]')) {
      return { getAttribute: name => name === 'title' ? `客户 ${id}` : '', textContent: `客户 ${id}` };
    }
    return null;
  },
  querySelectorAll() { return []; },
  closest() { return null; },
  get innerText() { return `客户 ${id} 预览消息 ${id} ${'内容'.repeat(20)}`; },
  get textContent() { return this.innerText; },
}));
const container = {
  scrollTop: 0,
  scrollHeight: 600,
  clientHeight: 600,
  querySelectorAll(selector) {
    return selector.includes('listitem') || selector.includes('cell-frame-container') || selector.includes('[role="row"]') ? rows : [];
  },
  dispatchEvent() {},
};
const posted = [];
const frames = [];
const timers = [];
const document = {
  body: {},
  querySelector(selector) {
    return selector === '#pane-side, [data-testid="chat-list"], [data-testid="chatlist"], [aria-label="Chat list"], [aria-label="聊天列表"], [role="grid"]'
      ? container
      : null;
  },
  querySelectorAll(selector) {
    if (selector.includes('msg-container') || selector.includes('data-pre-plain-text')) return [];
    if (selector.includes('listitem') || selector.includes('cell-frame-container') || selector.includes('[role="row"]')) return rows;
    return [];
  },
};
const window = {
  chrome: { webview: { postMessage(raw) { posted.push(JSON.parse(raw)); } } },
  addEventListener() {},
};
class MutationObserver {
  constructor() {}
  observe() {}
  disconnect() {}
}
const sandbox = {
  window,
  document,
  MutationObserver,
  Event: class Event { constructor(type, options) { this.type = type; Object.assign(this, options); } },
  requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
  setTimeout(callback) { timers.push(callback); return timers.length; },
  clearTimeout() {},
  setInterval() { return 1; },
  clearInterval() {},
  Date,
  JSON,
  Math,
  Set,
  Map,
  String,
  Number,
  Object,
  Array,
};
vm.runInNewContext(script, sandbox);
// The initial emit schedules a delayed background scan; isolate the explicit
// full-list call for deterministic assertions.
timers.length = 0;
const result = window.__zhikeWsDiscoverAll();
assert.equal(result.scanning, true);
while (frames.length) frames.shift()();

const scanPackets = posted.filter(packet => packet.scanned === true);
assert.ok(scanPackets.length > 1, 'large full-list scans must be split into multiple bridge packets');
const keys = new Set(scanPackets.flatMap(packet => packet.conversations.map(row => row.conversationKey)));
assert.equal(keys.size, rows.length, 'chunked scan must preserve every discovered conversation key');
const firstRow = scanPackets.flatMap(packet => packet.conversations).find(row => row.conversationKey === 'chat-0');
assert.equal(firstRow.displayName, '客户 0', 'chunk compaction must preserve string display names');
assert.match(firstRow.previewText, /客户 0/, 'chunk compaction must preserve list previews');
for (const packet of scanPackets) {
  const size = JSON.stringify(packet).length;
  assert.ok(size <= 700000, `collector packet exceeds the 700k safety budget: ${size}`);
  assert.equal(packet.chunkCount, scanPackets.length);
}
console.log('WS native collector chunk runtime: 5,000 rows remain complete and each WebView2 payload stays below 700k');

