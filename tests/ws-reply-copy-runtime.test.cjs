'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../resources/app/modules/ws-workbench.js'), 'utf8');
const start = source.indexOf('  async function copyReply('), end = source.indexOf('  async function translateBroadcast(', start);
assert.ok(start > 0 && end > start);
const input = 'Hello from the workspace';
function fixture(copyResult, sensitive = false) {
  const store = new Map([['zhike.ws.reply-drafts', JSON.stringify({'a:chat-a': input, 'b:chat-a': 'other draft'})]]);
  const state = { activeAccountId: 'a', currentConversationId: 'chat-a', accountLoadSequence: 1, busy: { reply: false }, settings: {}, replies: [] };
  const draft = { replyInput: input, replyError: '', replyOperationId: '' };
  const copies = [], saves = [], notices = [];
  const sandbox = {
    $: () => null,
    localStorage: { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) },
    state, text: value => String(value ?? '').trim(), activeConversation: () => ({ id: 'chat-a' }), currentDraft: () => draft,
    captureContext: () => ({ accountId: state.activeAccountId, sequence: state.accountLoadSequence }),
    contextCurrent: context => context.accountId === state.activeAccountId && context.sequence === state.accountLoadSequence,
    assertContext(context) { assert.equal(context.accountId, state.activeAccountId); assert.equal(context.sequence, state.accountLoadSequence); },
    core: { shouldTranslate: () => false, isSensitiveReply: () => sensitive },
    confirm: () => false, render: () => {}, stableHash: () => 'runtime-fixture',
    toast: (message, icon) => notices.push({ message, icon }),
    window: { zhikeDesktop: { tools: async payload => { copies.push(payload); return copyResult; } } },
    api: async (route, init, context) => { saves.push({ route, body: JSON.parse(init.body), context }); return { id: 'saved-reply-a' }; },
  };
  vm.runInNewContext(source.slice(source.indexOf('  const DRAFT_STORAGE_KEY'), source.indexOf('  function scheduleDraftPersist(')) + source.slice(start, end) + '\nglobalThis.copy=copyReply;', sandbox);
  return { state, draft, store, copies, saves, notices, run: () => sandbox.copy() };
}
(async () => {
  for (const response of [{ copied: true }, { ok: true, length: input.length }]) {
    const success = fixture(response); await success.run();
    assert.equal(success.copies.length, 1); assert.equal(success.copies[0].action, 'copy'); assert.equal(success.copies[0].text, input);
    assert.equal(success.saves.length, 1); assert.equal(success.saves[0].route, '/api/ws/replies');
    assert.equal(success.saves[0].body.conversationId, 'chat-a'); assert.equal(success.saves[0].body.originalText, input);
    assert.equal(success.saves[0].body.translatedText, input); assert.equal(success.saves[0].body.status, 'copied');
    assert.equal(success.state.replies[0].id, 'saved-reply-a'); assert.equal(success.draft.replyError, '');
    assert.equal(success.draft.replyOperationId, ''); assert.equal(success.state.busy.reply, false);
    assert.deepEqual(JSON.parse(success.store.get('zhike.ws.reply-drafts')), { 'b:chat-a': 'other draft' });
    assert.match(success.notices[0].message, /回复已完整复制/);
  }
  for (const response of [{ copied: false }, { copied: true, truncated: true }, { copied: true, length: input.length - 1 }, { ok: true }]) {
    const failure = fixture(response); await failure.run();
    assert.match(failure.draft.replyError, /回复复制不完整/);
    assert.equal(failure.draft.replyInput, input); assert.equal(failure.state.busy.reply, false);
    assert.equal(failure.saves.length, 0, 'unconfirmed or partial clipboard output must not be recorded as copied');
    assert.equal(failure.state.replies.length, 0);
    assert.ok(failure.notices.every(item => !/回复已完整复制/.test(item.message)), 'failure must never display copy success');
  }
  const cancelled = fixture({ copied: true }, true); await cancelled.run();
  assert.equal(cancelled.copies.length, 0, 'declining sensitive content confirmation must still prevent copying');
  assert.equal(cancelled.saves.length, 0); assert.equal(cancelled.draft.replyInput, input); assert.equal(cancelled.state.busy.reply, false);
  console.log('WS reply copy runtime: native copied DTO, legacy exact-length confirmation, safe failure/audit behavior and sensitive-copy cancellation PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
