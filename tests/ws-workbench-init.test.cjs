const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../resources/app/modules/ws-workbench-core.js');

const workbenchSource = fs.readFileSync(path.join(__dirname, '..', 'resources', 'app', 'modules', 'ws-workbench.js'), 'utf8');
const selectionStart = workbenchSource.indexOf('  function isNavigationConversationPreview(');
const selectionEnd = workbenchSource.indexOf('\n  function preserveHistoryCollectionState(', selectionStart);
assert.ok(selectionStart >= 0 && selectionEnd > selectionStart, 'initial conversation selector must remain runtime-testable');
const selectionSandbox = {
  text: value => String(value == null ? '' : value).trim(),
  fullHistorySourceFingerprint(conversation) {
    const data = conversation?.data || {};
    const current = String(data.historyFingerprint || '').trim();
    const latest = String(data.lastMessageFingerprint || '').trim();
    return data.historyLoaded === true && Number(data.directionVersion || 0) >= 4 && current && current === latest ? current : '';
  },
};
vm.runInNewContext(`${workbenchSource.slice(selectionStart, selectionEnd)}\n  globalThis.__resolveInitialConversationId=resolveInitialConversationId;`, selectionSandbox, { filename: 'ws-initial-selection-runtime.js' });
const resolveInitialConversationId = selectionSandbox.__resolveInitialConversationId;

const archivedPreview = { id: 'archived-preview', title: '已归档2', externalId: 'archive-nav', data: { source: 'ws-list-discovery', previewOnly: true } };
const normalPreview = { id: 'normal-preview', title: '+91 90000 00001', externalId: '919000000001', conversationType: 'direct', data: { source: 'ws-list-discovery', conversationType: 'direct', previewOnly: true } };
const fullHistory = { id: 'full-v4', title: '+91 90000 00002', conversationType: 'direct', data: { conversationType: 'direct', historyLoaded: true, directionVersion: 4, historyFingerprint: 'history-current', lastMessageFingerprint: 'history-current', previewOnly: false } };
const importedPartial = { id: 'manual-import', title: '手动导入会话', data: { source: 'file-import', previewOnly: false } };

assert.equal(resolveInitialConversationId([archivedPreview, normalPreview, fullHistory], '', false), 'full-v4', 'first load must prefer a verified v4 full-history conversation over a stale navigation preview');
assert.equal(resolveInitialConversationId([archivedPreview, normalPreview, fullHistory], 'archived-preview', false), 'full-v4', 'an automatic stale preview selection must be replaced by a verified full conversation');
assert.equal(resolveInitialConversationId([archivedPreview, normalPreview], '', false), 'normal-preview', 'without full history, a normal conversation preview must be preferred over navigation rows');
assert.equal(resolveInitialConversationId([archivedPreview], '', false), '', 'navigation-only rows must not become the automatic active conversation');
assert.equal(resolveInitialConversationId([archivedPreview, normalPreview, fullHistory], 'archived-preview', true), 'archived-preview', 'an explicit user selection must remain selected');
assert.equal(resolveInitialConversationId([archivedPreview, normalPreview, fullHistory], 'missing-manual-row', true), 'full-v4', 'a removed manual row must safely fall back to the best current conversation');
assert.equal(resolveInitialConversationId([archivedPreview, normalPreview, fullHistory, importedPartial], 'manual-import', false), 'manual-import', 'a non-preview local conversation must not be replaced on background refresh');
assert.match(workbenchSource, /state\.activeAccountId = id;[\s\S]{0,180}state\.currentConversationId = '';[\s\S]{0,120}state\.conversationSelectionManual = false;/, 'switching accounts must reset the manual conversation selection');
assert.match(workbenchSource, /action === 'select-conversation'[\s\S]{0,160}state\.conversationSelectionManual = true/, 'clicking a conversation must mark the selection as explicit');
assert.match(workbenchSource, /payload\.restoreAccountId[\s\S]{0,900}state\.conversationSelectionManual = false;/, 'restoring another account must reset the previous account selection');

(async () => {
  let attempts = 0;
  const result = await core.retryTransient(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('本地数据服务尚未准备好。');
    return { accounts: [{ id: 'default' }] };
  }, { attempts: 4, delayMs: 0 });
  assert.deepEqual(result, { accounts: [{ id: 'default' }] });
  assert.equal(attempts, 3, '账号列表加载应在瞬时服务失败后重试');
  console.log('ws-workbench-init: pass');
})().catch(error => { console.error(error); process.exitCode = 1; });
