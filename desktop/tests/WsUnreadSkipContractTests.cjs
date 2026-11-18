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
assert.match(script, /skipped_unread/, 'collector must define an explicit unread-skip state');
assert.match(script, /__zhikeWsReadHistoryCandidates/, 'collector must expose read-history candidate filtering for regression');
assert.match(script, /unreadCount|unread/i, 'collector must inspect unread markers');

const rows = [
  { conversationKey: 'read-1', displayName: '已读客户', conversationType: 'direct', unreadCount: 0, unread: false },
  { conversationKey: 'unread-1', displayName: '未读客户', conversationType: 'direct', unreadCount: 2, unread: true },
  { conversationKey: 'badge-1', displayName: '徽标未读', conversationType: 'direct', unreadCount: 0, unread: true },
];
const sandbox = {
  window: { chrome: { webview: { postMessage() {} } }, addEventListener() {} },
  document: { body: {}, querySelector() { return null; }, querySelectorAll() { return []; } },
  MutationObserver: class { observe() {} disconnect() {} },
  Event: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
  requestAnimationFrame(callback) { callback(); return 1; },
  setTimeout(callback) { callback(); return 1; },
  clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
  Date, JSON, Math, Set, Map, String, Number, Object, Array,
};
vm.runInNewContext(script, sandbox);
const result = sandbox.window.__zhikeWsReadHistoryCandidates(rows);
assert.deepEqual(Array.from(result.read, row => row.conversationKey), ['read-1'], 'only fully read conversations may enter history collection');
assert.deepEqual(Array.from(result.skipped, row => row.conversationKey), ['unread-1', 'badge-1'], 'any unread signal must be skipped');
assert.ok(Array.from(result.skipped).every(row => row.status === 'skipped_unread'), 'skipped rows must carry skipped_unread status');
console.log('WS unread skip contract: unread conversations are never eligible for automatic opening');

