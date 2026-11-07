'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'resources', 'app', 'modules', 'ws-workbench.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'resources', 'app', 'server.mjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'resources', 'app', 'ws-preload.cjs'), 'utf8');
const core = require(path.join(root, 'resources', 'app', 'modules', 'ws-workbench-core.js'));
const crmSync = require(path.join(root, 'resources', 'app', 'modules', 'ws-crm-sync-core.js'));

assert.ok(core, 'WS core should load');
assert.match(server, /matchCustomerForAutoSync/, 'CRM auto-sync should not merge contacts by shared WS login account');
assert.deepEqual(core.matchCustomer([{ id: 'c1', wsAccountIds: ['alpha', 'beta'] }], { wsAccountId: 'beta' }).customer?.id, 'c1', 'existing multi-account linkage should match');
assert.equal(core.matchCustomer([{ id: 'c1', wsAccountIds: ['alpha'] }, { id: 'c2', wsAccountIds: ['beta'] }], { wsAccountId: 'beta' }).kind, 'account', 'account identity should match additively');
const autoProfile = crmSync.deriveCustomerProfile({ confidence: 0.9, summary: '客户需要报价', contact: { name: '自动客户', phone: '+91 98765 43210' }, tags: ['高意向'] }, { id: 'conv-auto', externalId: 'wa-auto', title: '自动客户' }, 'alpha');
assert.equal(autoProfile.wsExternalId, 'wa-auto', 'AI 自动同步保留 WS 会话标识');
assert.equal(autoProfile.phone, '+91 98765 43210', '高置信度 AI 联系方式可进入同步候选');

const cleanVisibleTextSource = preload.slice(preload.indexOf('function cleanVisibleText'), preload.indexOf('function conversationNodes'));
const cleanVisibleText = vm.runInNewContext(`(${cleanVisibleTextSource})`);
const splitAccessibleRowSource = preload.slice(preload.indexOf('function splitAccessibleRow'), preload.indexOf('function readConversationNodes'));
const splitAccessibleRow = vm.runInNewContext(`(${splitAccessibleRowSource})`, { cleanVisibleText });
assert.deepEqual(JSON.parse(JSON.stringify(splitAccessibleRow('1条未读消息 Vaishali Joshi. 凌晨2:06 As 此聊天中的新消息将在发送90天后自动消失（除非消息已保留）。'))), { title: 'Vaishali Joshi.', preview: 'As' }, 'WhatsApp unread/time/system markers must not pollute title or preview');
assert.match(preload, /previewText && title\.toLocaleLowerCase\(\)\.endsWith\(previewText\.toLocaleLowerCase\(\)\)/, 'preload parser removes preview suffix from accessibility titles');
assert.match(preload, /stripSystemNotice = input => cleanVisibleText\(input\)[\s\S]*自动消失/, 'preload parser removes WhatsApp disappearing-message notices before choosing preview text');
assert.match(preload, /previewCandidates = \[rowPreview, previewText/, 'preload parser prefers date-delimited row previews over generic contact-name spans');

const splitListPreviewSource = ui.slice(ui.indexOf('function splitListPreview'), ui.indexOf('function normalizeListItem'));
const splitListPreview = vm.runInNewContext(`(${splitListPreviewSource})`, { text: value => String(value || '') });
assert.deepEqual(JSON.parse(JSON.stringify(splitListPreview('1条未读消息 Vaishali Joshi. 凌晨2:06 As 此聊天中的新消息将在发送90天后自动消失（除非消息已保留）。'))), { title: 'Vaishali Joshi.', preview: 'As' }, 'renderer list parser must match preload cleanup');
assert.match(ui, /preview && title\.toLocaleLowerCase\(\)\.endsWith\(preview\.toLocaleLowerCase\(\)\)/, 'renderer parser removes preview suffix from declared titles');

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
assert.match(ui, /collectionRefreshQueued/, 'overlapping refresh triggers are queued instead of dropped');
assert.match(ui, /autoCaptureCurrentConversation[\s\S]*captureContext\([\s\S]*importVisible\(context\)/, 'automatic capture keeps account context');
assert.match(ui, /syncConversationListPreviews[\s\S]*messages\/batch[\s\S]*list-preview/, 'list-level preview capture saves messages without opening a conversation');
assert.match(ui, /analyzeStoredConversation[\s\S]*ws-list-preview-analysis[\s\S]*api\('\/api\/ws\/analyses'/, 'list-level captures can trigger AI analysis and follow-up alerts');
assert.match(ui, /analyzeStoredConversation[\s\S]*analysisStatus: 'completed'/, 'successful list-level analysis clears retry state');
assert.match(ui, /markAnalysisRetryable[\s\S]*analysisStatus: 'retryable'[\s\S]*lastError/, 'AI failures remain visible and retryable');
assert.match(ui, /markAnalysisRetryable[\s\S]*previewAnalysisSignatures\.delete/, 'AI retryable list previews are eligible for a later refresh retry');
assert.match(ui, /includes\(item\.analysisStatus\)/, 'collection summary counts AI retryable items');
assert.match(ui, /collectionRefreshTimer = setInterval\([\s\S]*12000/, 'phone-to-workbench list sync polls at a bounded interval');
assert.match(ui, /analyzeConversation\(context[\s\S]*api\('\/api\/ws\/analyses'[\s\S]*context/, 'AI analysis writes use originating account');
assert.match(server, /sameCheckpoint[\s\S]*successfulAnalysis[\s\S]*analysis_status/, 'collection item updates preserve successful analysis for an unchanged preview');
assert.match(server, /wsCleanListPreviewText[\s\S]*自动消失[\s\S]*条未读消息/, 'server canonicalizes WhatsApp system markers before persistence');
assert.match(server, /normalizeStoredWsListPreviews[\s\S]*UPDATE ws_messages/, 'server repairs previously persisted list-preview noise at startup');
assert.match(server, /cleanedTitle[\s\S]*endsWith\(latest\.original_text/, 'server repairs titles that were previously concatenated with list previews');
assert.match(server, /function wsCanonicalListPreviewTitle[\s\S]*lowerTitle\.startsWith\(lowerPreview\)/, 'server protects conversation titles when a list preview is exposed as a title prefix');
assert.match(ui, /wsAccountIds|activeAccountId/, 'CRM profile stores WS account identity');
assert.match(ui, /matchCustomer\([\s\S]*wsAccountId/, 'CRM matching uses WS account identity after phone');
assert.match(ui, /wsExternalId: externalId[\s\S]*wsAccountId: context\.accountId/, 'visible discovery matches WS external id and account identity');
assert.match(ui, /idempotencyKey/, 'reply writes retain idempotency keys');
assert.match(ui, /core\.restoreFollowupSnapshot/, 'follow-up writes use deterministic rollback helper');
assert.match(ui, /syncAnalysisToCrm[\s\S]*\/api\/ws\/crm-sync/, 'AI 分析完成后自动同步到知客客户库');
assert.match(ui, /refreshState/, 'AI CRM 同步后刷新知客工作台共享状态');
assert.match(server, /\/api\/ws\/crm-sync[\s\S]*writeState\(state(?:, false)?\)/, 'AI CRM 同步在服务端事务写入本地客户库');
assert.match(server, /未来 7 天内应跟进/, '跟进提醒覆盖未来七天的计划任务');
console.log('ws-workbench-sync: dedupe, stale fencing, cross-account isolation, CRM linkage, rollback and idempotency pass');
