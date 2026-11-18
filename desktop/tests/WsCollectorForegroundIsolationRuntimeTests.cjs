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
assert.equal(result.collectorRole, 'foreground-on-demand', 'manual foreground capture must identify itself as on-demand');
assert.equal(result.supported, true, 'manual foreground capture must remain available');
assert.equal(scrollWrites, 0, 'foreground collector never writes the visible list scroll position');
assert.equal(scrollEvents, 0, 'foreground collector never dispatches list scroll events');
assert.equal(clicks, 0, 'foreground collector never opens a conversation');
assert.equal(focuses, 0, 'foreground collector never focuses a conversation row');
assert.doesNotMatch(script, /MutationObserver|setInterval|scrollTop\s*=|\.click\s*\(/,
  'on-demand foreground capture must not install collectors or mutate WhatsApp UI');

console.log('WS foreground isolation runtime: no persistent collector is injected; manual capture is read-only and on-demand');
