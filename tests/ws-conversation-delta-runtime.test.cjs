'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'resources', 'app', 'modules', 'ws-workbench.js'), 'utf8');
const start = source.indexOf('function conversationWatermark(');
const end = source.indexOf('\n  function boundsForBrowserView(', start);
assert.ok(start >= 0 && end > start);

const old = { id: 'old-water', updatedAt: '2026-11-14T00:00:00.000Z' };
const state = { activeAccountId: 'alpha', conversations: [old], conversationWatermarks: new Map([['alpha', { updatedAt: old.updatedAt, id: old.id }]]) };
let serverRows = [old];
let calls = 0;
const api = async url => {
  calls += 1;
  const parsed = new URL(url, 'http://local');
  const offset = Number(parsed.searchParams.get('cursor') || 0);
  const limit = Number(parsed.searchParams.get('limit') || 250);
  const page = serverRows.slice(offset, offset + limit);
  const nextOffset = offset + limit;
  return {
    conversations: page,
    scannedNewest: page[0] || null,
    scannedThrough: page.at(-1) || null,
    nextCursor: nextOffset < serverRows.length ? String(nextOffset) : '',
    excludedConversationIds: [],
  };
};
const runtime = vm.runInNewContext(`(() => { ${source.slice(start, end)}; return { loadConversationDeltaPages, applyConversationInventory }; })()`, {
  state,
  text: value => String(value ?? '').trim(),
  captureContext: () => ({ accountId: 'alpha' }),
  assertContext() {},
  api,
  loadAllConversationPages: async () => ({ conversations: serverRows, watermark: serverRows[0] }),
  personalConversationRows: rows => rows,
  Map, Set, String, Array, Math, Error, encodeURIComponent,
});

(async () => {
  let result = await runtime.loadConversationDeltaPages({ accountId: 'alpha' });
  assert.equal(calls, 1, 'an unchanged 50k-style inventory must stop after one 250-row page');
  runtime.applyConversationInventory(result, 'alpha');

  const updates = Array.from({ length: 1105 }, (_, index) => ({
    id: `new-${String(index).padStart(4, '0')}`,
    updatedAt: `2026-11-15T00:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
  })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
  serverRows = [...updates, old]; calls = 0;
  result = await runtime.loadConversationDeltaPages({ accountId: 'alpha' });
  assert.ok(calls >= 5, 'more than 1,000 updates must continue across all 250-row pages until crossing the watermark');
  const bulkCalls = calls;
  runtime.applyConversationInventory(result, 'alpha');
  assert.ok(state.conversations.some(row => row.id === updates.at(-1).id));

  const late = { id: 'late-during-page', updatedAt: '2026-11-16T00:00:00.000Z' };
  serverRows = [late, ...updates, old]; calls = 0;
  result = await runtime.loadConversationDeltaPages({ accountId: 'alpha' });
  runtime.applyConversationInventory(result, 'alpha');
  assert.ok(state.conversations.some(row => row.id === late.id), 'a row missed after moving above a prior cursor must be recovered by the next incremental cycle');
  assert.equal(state.conversationWatermarks.get('alpha').id, late.id);
  console.log(`WS conversation delta runtime: unchanged=1 page, 1105 updates=${bulkCalls} pages, late update recovered`);
})().catch(error => { console.error(error); process.exitCode = 1; });
