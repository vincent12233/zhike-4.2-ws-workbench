'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '..', '..');
const host = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Views', 'LegacyUiHostPage.xaml.cs'), 'utf8');
const match = host.match(/internal static string BuildWsVisibleCaptureScript\(string accountId\)\s*\{[\s\S]*?return \$\$"""([\s\S]*?)""";/);
assert.ok(match, 'visible WS capture must be a dedicated one-shot script');
const script = match[1].replace(/\{\{encodedAccount\}\}/g, JSON.stringify('default'));

let scrollWrites = 0;
let scrollEvents = 0;
let clicks = 0;
let focuses = 0;
const row = {
  getAttribute(name) {
    if (name === 'data-id') return 'chat-foreground';
    if (name === 'data-chat-type') return 'direct';
    if (name === 'role') return 'row';
    return '';
  },
  querySelectorAll() { return []; },
  querySelector() { return null; },
  closest() { return null; },
  scrollIntoView() { scrollWrites += 1; },
  focus() { focuses += 1; },
  click() { clicks += 1; },
  innerText: '前台聊天',
  textContent: '前台聊天',
};
let top = 0;
const container = {
  get scrollTop() { return top; },
  set scrollTop(value) { scrollWrites += 1; top = Number(value) || 0; },
  scrollHeight: 1200,
  clientHeight: 600,
  querySelectorAll() { return [row]; },
  dispatchEvent() { scrollEvents += 1; },
};
const posted = [];
const document = {
  body: {},
  querySelector(selector) {
    if (selector.includes('#pane-side') || selector.includes('chat-list') || selector === '[role="grid"]') return container;
    return null;
  },
  querySelectorAll(selector) {
    if (selector.includes('#pane-side') || selector.includes('chat-list') || selector === '[role="grid"]') return [container];
    return [];
  },
};
const sandbox = {
  window: { getSelection() { return { toString() { return ''; } }; } },
  document,
  getComputedStyle() { return { backgroundColor: '', alignSelf: '' }; },
  Date, JSON, Math, Set, Map, String, Number, Object, Array,
};

const result = JSON.parse(vm.runInNewContext(script, sandbox));
const directoryScript = host.match(/private const string WsVisibleDirectoryScript = """([\s\S]*?)""";/)[1];
assert.doesNotMatch(directoryScript, /MutationObserver|setInterval|setTimeout|scrollTop\s*=|\.click\s*\(|\.focus\s*\(|localStorage|document\.cookie|fetch\(/);
row.getClientRects = () => [{}];
const groupRow = { ...row, getAttribute: name => name === 'data-group-id' ? '1203630001' : '' };
const hiddenRow = { ...row, getClientRects: () => [] };
const unknownRow = { ...row, getAttribute: () => '' };
const list = { getClientRects: () => [{}], querySelectorAll: () => [row, groupRow, hiddenRow, unknownRow] };
const listDoc = { querySelector: selector => selector.includes('#pane-side') ? list : null };
const live = JSON.parse(vm.runInNewContext(directoryScript + '("ordinary")', { document: listDoc }));
const groups = JSON.parse(vm.runInNewContext(directoryScript + '("dedicated")', { document: listDoc }));
assert.deepEqual(live.rows.map(item => [item.conversationKey, item.conversationType]), [['chat-foreground','direct']]);
assert.deepEqual(groups.rows.map(item => [item.conversationKey, item.conversationType]), [['1203630001@g.us','group']]);
assert.equal(live.coverage, 'foreground-visible-only');
assert.equal(live.conversationListVisible, true);
assert.equal(live.unresolvedRowCount, 1, 'a visible unknown entry cannot be reported as a verified empty directory');
const person = id => ({ getClientRects: () => [{}], closest: () => null, getAttribute: field => field === 'data-contact-id' ? id : null,
  querySelector: () => ({ getAttribute: () => '同名联系人' }) });
const picker = { getClientRects: () => [{}], closest: () => null, contains: () => false,
  querySelectorAll: () => [person('11111@lid'), person('22222@lid'), person('11111@lid'), person(''), person('1203630001@g.us')] };
const pickerDoc = {querySelector: descriptor => descriptor.includes('contact-picker') ? picker : null};
const onlyContacts = JSON.parse(vm.runInNewContext(directoryScript+'("ordinary")', {document:pickerDoc}));
assert.equal(onlyContacts.contactsVisible, true);
assert.equal(onlyContacts.conversationListVisible, false);
assert.deepEqual(onlyContacts.contacts.map(item => item.contactId), ['11111@lid','22222@lid']);
assert.deepEqual(onlyContacts.rows, [], 'a visible contact picker does not create conversations');
assert.equal(onlyContacts.unresolvedContactCount, 1, 'a canonical group is not an unresolved contact');
assert.equal(JSON.parse(vm.runInNewContext(directoryScript+'("dedicated")', {document:pickerDoc})).supported, false);
assert.equal(JSON.parse(vm.runInNewContext(directoryScript + '("ordinary")', { document:{querySelector:()=>null} })).supported, false);
assert.equal(result.collectorRole, 'foreground-on-demand', 'manual foreground capture must identify itself as on-demand');
assert.equal(result.supported, true, 'manual foreground capture must remain available');
assert.equal(scrollWrites, 0, 'foreground collector never writes the visible list scroll position');
assert.equal(scrollEvents, 0, 'foreground collector never dispatches list scroll events');
assert.equal(clicks, 0, 'foreground collector never opens a conversation');
assert.equal(focuses, 0, 'foreground collector never focuses a conversation row');
assert.doesNotMatch(script, /MutationObserver|setInterval|scrollTop\s*=|\.click\s*\(/,
  'on-demand foreground capture must not install collectors or mutate WhatsApp UI');

console.log('WS foreground isolation runtime: no persistent collector is injected; manual capture is read-only and on-demand');
