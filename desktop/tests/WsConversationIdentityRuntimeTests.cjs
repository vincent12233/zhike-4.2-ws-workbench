'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '..', '..');
const host = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Views', 'LegacyUiHostPage.xaml.cs'), 'utf8');
const match = host.match(/internal static string BuildWsCollectorScript\(string accountId\)\s*\{[\s\S]*?return \$\$"""([\s\S]*?)""";/);
assert.ok(match, 'native WS collector script must remain embedded');
const script = match[1].replace(/\{\{encodedAccount\}\}/g, JSON.stringify('jid-test'));
assert.match(script, /const conversationIdentityFromRow\s*=\s*row\s*=>/, 'collector must centralize row identity extraction');
assert.match(script, /data-group-id.*data-jid.*data-chat-id/s, 'collector identity extraction must inspect native group/chat attributes');
assert.match(script, /const identity = conversationIdentityFromRow\(row\)/, 'readRows must use the native identity helper');
assert.match(script, /\[data-jid\]\[tabindex\].*\[data-chat-id\]\[tabindex\].*\[data-group-id\]\[tabindex\]/s, 'row selectors must include attribute-driven WhatsApp list rows');

const leaf = (attributes = {}, value = '') => ({
  innerText:value,
  textContent:value,
  getAttribute(name) { return attributes[name] || ''; },
  closest() { return null; },
});

function makeRow(attributes, title, preview = 'preview', nested = []) {
  const nameNode = leaf({ title }, title);
  const previewNode = leaf({ title:preview, 'data-testid':'last-msg' }, preview);
  const row = {
    getAttribute(name) { return attributes[name] || ''; },
    matches() { return false; },
    querySelectorAll(selector) {
      if (selector.includes('[data-id]') || selector.includes('[data-chat-id]') || selector.includes('[data-jid]') || selector.includes('[data-group-id]') || selector.includes('[data-chat-type]')) return nested;
      if (/cell-frame-title|span\[dir="auto"\]\[title\]/.test(selector)) return [nameNode];
      if (selector.includes('[aria-label]') || selector.includes('[data-testid]') || selector.includes('[title]')) return [nameNode, previewNode, ...nested];
      return [];
    },
    querySelector(selector) {
      if (selector === '[title]' || selector === '[title], span[dir="auto"]' || selector === 'span[dir="auto"]') return nameNode;
      if (selector.includes('last-msg') || selector.includes('preview') || selector.includes('span[title]')) return previewNode;
      return null;
    },
    closest() { return null; },
    dispatchEvent() { return true; },
    scrollIntoView() {},
    focus() {},
    click() {},
    innerText:`${title} ${preview}`,
    textContent:`${title} ${preview}`,
  };
  nameNode.closest = selector => /gridcell|cell-frame-container|tabindex/.test(selector) ? row : null;
  return row;
}

const rows = [
  makeRow({ 'data-jid':'120363001234567890@g.us', 'data-chat-type':'group', role:'row', 'data-testid':'cell-frame-container' }, 'JID group'),
  makeRow({ 'data-group-id':'120363009876543210', 'data-chat-type':'group', role:'row', 'data-testid':'cell-frame-container' }, 'Numeric group'),
  makeRow({ 'data-chat-id':'919876543210@s.whatsapp.net', 'data-chat-type':'direct', role:'row', 'data-testid':'cell-frame-container' }, 'Direct contact'),
];
const container = {
  scrollTop:0,
  scrollHeight:500,
  clientHeight:500,
  querySelectorAll(selector) { return /listitem|role="row"|cell-frame-container/.test(selector) ? rows : []; },
  dispatchEvent() {},
};
const document = {
  body:{},
  documentElement:{ clientWidth:1200, clientHeight:800 },
  readyState:'complete',
  querySelector(selector) {
    if (selector.includes('#pane-side') || selector.includes('chat-list') || selector === '[role="grid"]') return container;
    return null;
  },
  querySelectorAll(selector) {
    if (selector.includes('#pane-side') || selector.includes('chat-list') || selector === '[role="grid"]') return [container];
    if (/listitem|role="row"|cell-frame-container/.test(selector)) return rows;
    return [];
  },
};
const timers = [];
const frames = [];
const sandbox = {
  window:{ chrome:{ webview:{ postMessage() {} } }, addEventListener(){}, removeEventListener(){} },
  document,
  localStorage:{ getItem(){ return null; }, setItem(){} },
  MutationObserver:class { observe(){} disconnect(){} },
  Event:class { constructor(type, options) { this.type=type; Object.assign(this, options); } },
  MouseEvent:class { constructor(type, options) { this.type=type; this.isTrusted=false; Object.assign(this, options); } },
  requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
  setTimeout(callback) { timers.push(callback); return timers.length; },
  clearTimeout() {},
  setInterval() { return 1; },
  clearInterval() {},
  Date, JSON, Math, Set, Map, String, Number, Object, Array,
};

vm.runInNewContext(script, sandbox);
const discovery = sandbox.window.__zhikeWsDiscover();
const groupRows = discovery.groupConversations || discovery.excludedConversations.filter(row => row.isGroup === true);
assert.equal(groupRows.length, 2, 'both native group rows must be discoverable for group monitoring');
assert.ok(groupRows.some(row => row.conversationKey === '120363001234567890@g.us'), 'data-jid group identity must be preserved');
assert.ok(groupRows.some(row => row.conversationKey === '120363009876543210@g.us'), 'numeric data-group-id must be normalized to @g.us');
const direct = discovery.conversations.find(row => row.displayName === 'Direct contact');
assert.equal(direct?.conversationKey, '919876543210@s.whatsapp.net', 'data-chat-id direct identity must be preserved');
assert.equal(direct?.conversationType, 'direct');

rows.splice(0, rows.length,
  makeRow({ 'data-chat-type':'direct', role:'row' }, '同名客户', 'first'),
  makeRow({ 'data-chat-type':'direct', role:'row' }, '同名客户', 'second'));
const ambiguous = sandbox.window.__zhikeWsDiscoverDirectory();
assert.equal(ambiguous.rows.length, 0, 'two same-name entries cannot be merged into a synthetic customer');
assert.equal(ambiguous.unresolvedRowCount, 2, 'visible rows without an ID report a verifiable coverage gap');
assert.equal(sandbox.window.__zhikeWsReadHistoryCandidates(ambiguous.rows).read.length, 0);
rows.splice(0, rows.length,
  makeRow({ 'data-jid':'111111111@lid', role:'row' }, '同名客户'),
  makeRow({ 'data-jid':'222222222@lid', role:'row' }, '同名客户'));
assert.deepEqual(Array.from(sandbox.window.__zhikeWsDiscover().conversations, row => row.conversationKey), ['111111111@lid','222222222@lid']);

console.log('WS conversation identity runtime: data-jid/data-chat-id/data-group-id are extracted and groups are surfaced separately');
