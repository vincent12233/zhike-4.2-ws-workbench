'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const repo = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(repo, 'resources/app/modules/ws-workbench.js'), 'utf8');

assert.match(source, /const CONVERSATION_RENDER_BATCH = 120;/,
  'the WS conversation DOM must use a bounded render batch');
assert.match(source, /matches\.slice\(windowStart, windowEnd\)\.map\(/,
  'only the current fixed conversation window may be converted into DOM rows');
assert.match(source, /data-ws-action="next-conversations"/,
  'large accounts must provide explicit bounded pagination');
assert.match(source, /classList\.contains\('ws-session-list'\)[\s\S]{0,1200}conversationWindowStart \+= CONVERSATION_RENDER_BATCH/,
  'scrolling near the end of the conversation rail must advance the fixed window');
assert.doesNotMatch(source, /conversationVisibleLimit/,
  'conversation DOM growth must not be unbounded');
assert.match(source, /loadConversationDeltaPages[\s\S]*?conversations\?limit=250/,
  'unchanged safety polls must request only a small incremental page');
const signatureSource = source.slice(source.indexOf('function collectionRenderSignature('), source.indexOf('\n  function scheduleAiQueuePump(', source.indexOf('function collectionRenderSignature(')));
assert.match(signatureSource, /visibleRows = conversations\.slice\(start, start \+ CONVERSATION_RENDER_BATCH\)/,
  'render signatures must inspect only the visible conversation window');
assert.doesNotMatch(signatureSource, /conversations\.map\(/,
  'render signatures must not map the entire 50k inventory on every poll');

const rows = Array.from({ length: 50000 }, (_, index) => ({
  title: `客户 ${index}`,
  externalId: `ws-${index}`,
  lastMessageText: index % 977 === 0 ? '重点预算客户' : '普通消息',
}));
const started = performance.now();
const query = '重点预算';
const visible = rows
  .filter(item => `${item.title} ${item.externalId} ${item.lastMessageText}`.toLocaleLowerCase().includes(query))
  .slice(0, 120);
const elapsed = performance.now() - started;
assert.ok(visible.length > 0 && visible.length <= 120);
assert.ok(elapsed < 1000, `50k conversation filter/window exceeded budget: ${elapsed.toFixed(1)} ms`);

console.log(`WS conversation list performance: 50k filter/window ${elapsed.toFixed(1)} ms, DOM capped at 120 rows`);
