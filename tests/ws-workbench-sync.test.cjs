'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'resources', 'app', 'modules', 'ws-workbench.js'), 'utf8');
const core = require(path.join(root, 'resources', 'app', 'modules', 'ws-workbench-core.js'));

assert.ok(core, 'WS core should load');
assert.deepEqual(core.matchCustomer([{ id: 'c1', wsAccountIds: ['alpha', 'beta'] }], { wsAccountId: 'beta' }).customer?.id, 'c1', 'existing multi-account linkage should match');
assert.equal(core.matchCustomer([{ id: 'c1', wsAccountIds: ['alpha'] }, { id: 'c2', wsAccountIds: ['beta'] }], { wsAccountId: 'beta' }).kind, 'account', 'account identity should match additively');

// Execute the same deterministic primitives used by import/capture and account writes.
const captured = core.dedupeMessages([
  { externalId: 'm-1', order: 2, originalText: '旧文本' },
  { externalId: 'm-2', order: 1, originalText: '先到消息' },
  { externalId: 'm-1', order: 2, originalText: '重试后的文本', translatedText: 'retry' },
]);
assert.deepEqual(captured.map(item => item.externalId), ['m-2', 'm-1'], 'duplicate capture/import rows are idempotently deduplicated and ordered');
assert.equal(captured[1].originalText, '重试后的文本', 'duplicate retry keeps the latest message payload');

const activeContext = { accountId: 'alpha', conversationId: 'chat-1', sequence: 7 };
assert.equal(core.contextCurrent(activeContext, { accountId: 'alpha', conversationId: 'chat-1', sequence: 7 }), true, 'current account context accepts writes');
assert.equal(core.contextCurrent(activeContext, { accountId: 'beta', conversationId: 'chat-1', sequence: 7 }), false, 'cross-account writes are rejected');
assert.equal(core.contextCurrent(activeContext, { accountId: 'alpha', conversationId: 'chat-1', sequence: 8 }), false, 'stale async responses are discarded');
assert.equal(core.contextCurrent(activeContext, { accountId: 'alpha', conversationId: 'chat-2', sequence: 7 }), false, 'cross-conversation writes are rejected');

const linkedCustomer = { id: 'c-sync', tags: ['old'], wsAccountIds: ['alpha'] };
core.mergeCustomerProfile(linkedCustomer, {
  wsAccountId: 'beta', wsExternalId: 'wa-22', conversationId: 'chat-2',
  phone: '+91 98765 43210', name: '同步客户', tags: ['new'],
});
assert.deepEqual(linkedCustomer.wsAccountIds, ['alpha', 'beta'], 'CRM linkage adds a second WS account without overwriting the first');
assert.deepEqual(linkedCustomer.wsExternalIds, ['wa-22'], 'CRM linkage stores external WS identity');
assert.deepEqual(linkedCustomer.wsConversationIds, ['chat-2'], 'CRM linkage stores conversation identity');
assert.deepEqual(linkedCustomer.tags, ['old', 'new'], 'CRM linkage preserves existing tags');

const followupState = { followups: [{ id: 'old-followup' }] };
const followupCustomer = { lastFollow: 'before', due: '2026-01-01' };
const followupSnapshot = { followups: followupState.followups.slice(), customer: { ...followupCustomer } };
followupState.followups.unshift({ id: 'new-followup' });
followupCustomer.lastFollow = 'after';
followupCustomer.due = '2026-02-02';
core.restoreFollowupSnapshot(followupState, followupCustomer, followupSnapshot);
assert.deepEqual(followupState.followups, [{ id: 'old-followup' }], 'follow-up failure restores the previous list');
assert.deepEqual({ lastFollow: followupCustomer.lastFollow, due: followupCustomer.due }, followupSnapshot.customer, 'follow-up failure restores customer dates');

assert.match(ui, /function captureContext[\s\S]*accountId[\s\S]*sequence/, 'sync paths capture immutable account context');
assert.match(ui, /refreshCollectionSummary[\s\S]*assertContext\(context\)/, 'collection summary fences stale responses');
assert.match(ui, /autoCaptureCurrentConversation[\s\S]*captureContext\([\s\S]*importVisible\(context\)/, 'automatic capture keeps account context');
assert.match(ui, /analyzeConversation\(context[\s\S]*api\('\/api\/ws\/analyses'[\s\S]*context/, 'AI analysis writes use originating account');
assert.match(ui, /wsAccountIds|activeAccountId/, 'CRM profile stores WS account identity');
assert.match(ui, /matchCustomer\([\s\S]*wsAccountId/, 'CRM matching uses WS account identity after phone');
assert.match(ui, /wsExternalId: externalId[\s\S]*wsAccountId: context\.accountId/, 'visible discovery matches WS external id and account identity');
assert.match(ui, /idempotencyKey/, 'reply writes retain idempotency keys');
assert.match(ui, /core\.restoreFollowupSnapshot/, 'follow-up writes use deterministic rollback helper');
console.log('ws-workbench-sync: dedupe, stale fencing, cross-account isolation, CRM linkage, rollback and idempotency pass');
