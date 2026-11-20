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
const switchStart = workbenchSource.indexOf('  async function switchAccount(');
const switchEnd = workbenchSource.indexOf('  function toast(', switchStart);
assert.ok(switchStart >= 0 && switchEnd > switchStart);
assert.match(workbenchSource.slice(switchStart, switchEnd), /state\.activeAccountId = id;[\s\S]*?state\.currentConversationId = '';[\s\S]*?state\.conversationSelectionManual = false;/, 'switching accounts must reset manual selection within the owning function; runtime ordering is covered by the account race test');
assert.match(workbenchSource, /action === 'select-conversation'[\s\S]{0,160}state\.conversationSelectionManual = true/, 'clicking a conversation must mark the selection as explicit');
assert.match(workbenchSource, /payload\.restoreAccountId[\s\S]{0,900}resetAccountPresentation\(payload\.restoreAccountId\)/, 'native restore must use the same account presentation reset as a normal switch');
assert.match(workbenchSource, /function resetAccountPresentation\(accountId\)[\s\S]*?state\.currentConversationId = '';[\s\S]*?state\.conversationSelectionManual = false;/, 'the shared reset must clear previous manual conversation selection; its actual restore ordering is covered by stage 5.5B runtime tests');

(async () => {
  // Execute the actual startup body: loading local conversations clears errors,
  // but a failed native open must remain visible even without preview metadata.
  async function startup(openFails, preview = undefined, switchDuringOpen = false) {
    const state = { workspaceMode: 'ordinary', activeAccountId: 'a', accountLoadSequence: 0, accountPresentationGeneration: 0, connectionAttemptGeneration: 0, error: '' };
    const sandbox = {
      state, getHost: () => ({ state: {} }),
      normalizeWorkspaceMode: mode => mode,
      workspaceLabel: () => '普通 WS', modeAccount: id => id ? { id } : null,
      startBackgroundRuntime: () => (state.backgroundActive = true),
      backgroundGeneration: 1, backgroundStartGeneration: 0, backgroundStartPromise: null,
      document: { documentElement: { dataset: {} }, body: { classList: { add() {} } } },
      $: () => ({}), $$: () => [], render() {}, loadAccounts: async () => {},
      captureContext: () => ({}), syncVipGroupAllowlist: async () => {},
      loadConversations: async () => { state.error = ''; }, loadGroupMonitor: async () => {},
      refreshCollectionSummary: async () => {}, updateAccountStatus() {},
      setStatus: (status, detail) => { state.wsStatus = status; state.wsDetail = detail; },
      wsErrorDetail: error => error.message,
      wsBridge: async action => {
        if (action === 'open') {
          if (switchDuringOpen === true) { state.activeAccountId = 'b'; state.accountLoadSequence++; state.accountPresentationGeneration++; state.wsStatus = 'B ready'; }
          if (switchDuringOpen === 'refresh') state.accountLoadSequence++;
          if (switchDuringOpen === 'reconnect') { state.connectionAttemptGeneration++; state.wsStatus = 'explicit ready'; }
          if (openFails) throw new Error('isolated open failed');
        }
        return { status: '未连接', ...(preview === undefined ? {} : { isolatedPreview: preview }) };
      },
    };
    const from = workbenchSource.indexOf('  function activate() {');
    const to = workbenchSource.indexOf('  function deactivate()', from);
    vm.runInNewContext(workbenchSource.slice(from, to) + '\nactivate();', sandbox);
    await sandbox.backgroundStartPromise;
    return state;
  }
  const failedOpen = await startup(true);
  assert.equal(failedOpen.wsStatus, '连接失败', 'native open errors must not depend on an optional isolatedPreview flag');
  assert.equal(failedOpen.error, 'isolated open failed', 'local conversation refresh must not erase the actionable native failure');
  assert.equal((await startup(false)).wsStatus, '未连接', 'normal status remains truthful');
  assert.equal((await startup(true, undefined, true)).wsStatus, 'B ready', 'late startup failure must not overwrite a newer account');
  assert.equal((await startup(true, undefined, 'refresh')).wsStatus, '连接失败', 'same-account directory refresh does not invalidate a pending native open');
  assert.equal((await startup(true, undefined, 'reconnect')).wsStatus, 'explicit ready', 'a newer explicit connection attempt owns the final status');
  const { renderWsWorkbenchFixture } = require('./helpers/ws-workbench-render-fixture.cjs');
  const failedOverview = renderWsWorkbenchFixture({ view: 'overview', wsStatus: '连接失败', error: 'isolated open failed' });
  assert.match(failedOverview.split('<div class="page-heading ws-page-heading">')[0], /data-ws-workspace-page="overview"[\s\S]*?role="alert"[\s\S]*?isolated open failed[\s\S]*?data-ws-action="open"[^>]*>重试打开 WS/, 'failure is inside the visible overview page and retries the native open');

  const createdIds = [];
  const accountState = { accountFormName: '隔离账号', accounts: [] };
  const accountSandbox = {
    state: accountState, text: value => String(value || '').trim(), $: () => null,
    render() {}, requestAnimationFrame() {}, toast() {}, writeWsWorkspaceState() {},
    createWsAccountRecord: async account => {
      createdIds.push(account.id);
      if (createdIds.length === 1) throw new Error('isolated reply lost');
      return account;
    },
    switchAccount: async () => true,
  };
  const createFrom = workbenchSource.indexOf('  async function createAccount()');
  const createTo = workbenchSource.indexOf('  async function switchAccount(', createFrom);
  vm.runInNewContext(workbenchSource.slice(createFrom, createTo) + '\nglobalThis.create = createAccount;', accountSandbox);
  await accountSandbox.create();
  assert.equal(accountState.accounts.length, 0, 'failed creation must not publish an account');
  await new Promise(resolve => setTimeout(resolve, 2));
  await accountSandbox.create();
  assert.equal(createdIds[1], createdIds[0], 'explicit retry of the same form must reuse its id after an uncertain response');
  assert.equal(accountState.accounts.length, 1);

  let fallbackWrites = 0;
  const nativeFailure = Object.assign(new Error('isolated index unavailable'), { code: 'WS_ACCOUNT_INDEX_WRITE_FAILED' });
  const bridgeSandbox = {
    normalizeWorkspaceMode: mode => mode === undefined ? 'ordinary' : mode,
    accountWorkspaceMode: account => account.workspaceMode === undefined ? 'ordinary' : account.workspaceMode,
    window: { zhikeDesktop: { wsAccounts: async () => { throw nativeFailure; } } },
    withWsAccountTimeout: task => task(),
    api: async () => { fallbackWrites++; return { account: { id: 'partial' } }; },
  };
  const bridgeFrom = workbenchSource.indexOf('  async function createWsAccountRecord(');
  vm.runInNewContext(workbenchSource.slice(bridgeFrom, createFrom) + '\nglobalThis.create = createWsAccountRecord;', bridgeSandbox);
  await assert.rejects(bridgeSandbox.create({ id: 'partial' }), error => error === nativeFailure);
  assert.equal(fallbackWrites, 0, 'a native index failure must not become success through sidecar-only fallback');
  bridgeSandbox.window.zhikeDesktop.wsAccounts = async request => {
    if (request.action === 'create') throw Object.assign(new Error('isolated timeout'), { code: 'TIMEOUT' });
    return { accounts: [] };
  };
  await assert.rejects(bridgeSandbox.create({ id: 'partial' }), /桌面索引尚未同步/, 'sidecar success alone cannot publish native readiness');
  bridgeSandbox.window.zhikeDesktop.wsAccounts = async request => {
    if (request.action === 'create') throw new Error('isolated timeout');
    return { accounts: [{ id: 'partial', displayName: 'confirmed' }] };
  };
  assert.equal((await bridgeSandbox.create({ id: 'partial' })).displayName, 'confirmed');

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
