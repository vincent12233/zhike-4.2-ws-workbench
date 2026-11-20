'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../resources/app/modules/ws-workbench.js'), 'utf8');
const start = source.indexOf('  function summarizeAccountMetrics('), end = source.indexOf('  function renderAccountList(', start);
assert.ok(start >= 0 && end > start);
const now = Date.now();
const accounts = Array.from({ length: 50 }, (_, i) => ({ id: 'a' + i, workspaceMode: i < 25 ? 'ordinary' : 'dedicated', status: '已连接', lastSeen: new Date(now).toISOString() }));
const records = accounts.map(row => ({ accountId: row.id, workspaceMode: row.workspaceMode, savedSession: 'none', foregroundSavedSession: 'none', collectorSavedSession: 'none', onlineState: 'not-observed', lastOnlineProbeAt: null, foregroundInitialized: false, collectorInitialized: false, collectorRunning: false }));
const snapshot = { generatedAt: new Date(now).toISOString(), onlineFreshnessSeconds: 30, accounts: records };
const state = { accounts, accountMetrics: snapshot, workspaceMode: 'ordinary' };
const context = { state, accountWorkspaceMode: account => account.workspaceMode === undefined ? 'ordinary' : account.workspaceMode,
  workspaceLabel: () => state.workspaceMode === 'ordinary' ? '普通 WS' : '专用 WS', esc: value => String(value).replaceAll('<', '&lt;') };
const { summarizeAccountMetrics: summary, renderAccountMetrics: render } = vm.runInNewContext(source.slice(start, end) + '\n;({summarizeAccountMetrics,renderAccountMetrics})', context);

test('50 registered offline accounts do not imply saved sessions, online or initialized WebViews', () => {
  for (const mode of ['ordinary', 'dedicated']) {
    const actual = summary(accounts, snapshot, mode, now);
    assert.equal(actual.registered, 25); assert.equal(actual.saved, 0); assert.equal(actual.savedUnknown, 0);
    assert.equal(actual.online, 0); assert.equal(actual.onlineUnknown, 25);
    assert.equal(actual.foreground, 0); assert.equal(actual.collector, 0); assert.equal(actual.running, 0);
    state.workspaceMode = mode;
    const html = render();
    for (const label of ['已登记账号', '已保存登录会话', '近期检测在线账号', '已初始化 WebView2', '运行采集会话']) assert.ok(html.includes(label));
    assert.match(html, /25 个未知/); assert.match(html, /不会新开登录窗口/);
  }
});
test('legacy statuses never fill missing native login or runtime evidence', () => {
  const actual = summary(accounts, null, 'ordinary', now);
  assert.equal(actual.saved, 0); assert.equal(actual.savedUnknown, 25); assert.equal(actual.online, 0); assert.equal(actual.webViewUnknown, 25); assert.equal(actual.runningUnknown, 25);
  const wrongMode = { ...snapshot, accounts: [{ ...records[0], workspaceMode: 'dedicated', savedSession: 'confirmed', onlineState: 'recent', lastOnlineProbeAt: new Date(now).toISOString(), collectorRunning: true }] };
  assert.equal(summary(accounts, wrongMode, 'ordinary', now).savedUnknown, 25);
});
test('online timestamps expire independently and collector login cannot inflate foreground online count', () => {
  const data = { ...snapshot, accounts: records.map(row => ({ ...row })) };
  Object.assign(data.accounts[0], { savedSession: 'confirmed', onlineState: 'recent', lastOnlineProbeAt: new Date(now - 1000).toISOString(), foregroundInitialized: true });
  Object.assign(data.accounts[1], { savedSession: 'confirmed', onlineState: 'recent', lastOnlineProbeAt: new Date(now - 31000).toISOString() });
  Object.assign(data.accounts[2], { onlineState: 'recent', lastOnlineProbeAt: new Date(now + 1000).toISOString() });
  Object.assign(data.accounts[3], { savedSession: 'confirmed', collectorInitialized: true, collectorRunning: true });
  const actual = summary(accounts, data, 'ordinary', now);
  assert.equal(actual.saved, 3); assert.equal(actual.online, 1); assert.equal(actual.foreground, 1); assert.equal(actual.collector, 1); assert.equal(actual.running, 1);
  assert.equal(summary(accounts, data, 'ordinary', now + 32000).online, 0);
});
test('a delayed old-mode metrics response cannot overwrite the current workspace', async () => {
  const loadStart = source.indexOf('  async function loadAccounts()'), loadEnd = source.indexOf('  function updateAccountStatus(', loadStart);
  assert.ok(loadStart >= 0 && loadEnd > loadStart);
  let resolve;
  const old = new Promise(done => { resolve = done; });
  const current = { workspaceMode: 'ordinary', accountLoadSequence: 0, accounts: [], accountMetrics: null };
  const load = vm.runInNewContext(source.slice(loadStart, loadEnd) + '\n;loadAccounts', {
    state: current, render() {}, core: { retryTransient: operation => operation() }, window: { zhikeDesktop: { wsAccounts: () => old } },
  });
  const pending = load(); current.workspaceMode = 'dedicated'; current.accountLoadSequence += 1; current.accountMetrics = { marker: 'new-mode' };
  resolve({ accounts, accountMetrics: snapshot }); await pending;
  assert.equal(current.accountMetrics.marker, 'new-mode'); assert.deepEqual(current.accounts, []);
});
test('two independently saved surfaces count as two sessions belonging to one account', () => {
  const data = { ...snapshot, accounts: records.map(row => row.accountId === 'a0' ? { ...row, savedSession: 'confirmed', foregroundSavedSession: 'confirmed', collectorSavedSession: 'confirmed' } : row) };
  const result = summary(accounts, data, 'ordinary', now);
  assert.equal(result.saved, 1); assert.equal(result.savedForeground + result.savedCollector, 2); assert.equal(result.savedSessionUnknown, 0);
});
test('account pages no longer label a registration count as an isolated logged-in session', () => {
  assert.doesNotMatch(source, /已加载(?: WS )?账号[^\n]{0,150}本机隔离会话/);
  assert.doesNotMatch(source, /state\.accounts\.length\} 个本机隔离会话/);
  assert.match(source, /activeView === 'accounts'[^\n]+renderAccountMetrics\(\)/);
  assert.match(source, /刷新账号列表<\/button>[^\n]+renderAccountMetrics\(\)/);
});
test('manual account refresh reads the completed current probe and never opens another WebView', async () => {
  const loadStart = source.indexOf('  async function loadAccounts()'), loadEnd = source.indexOf('  function updateAccountStatus(', loadStart);
  const current = { workspaceMode: 'dedicated', accountLoadSequence: 0, accounts: [], activeAccountId: 'a25' };
  const calls = [];
  const refreshed = { ...snapshot, accounts: records.map(row => row.accountId === 'a25' ? { ...row, onlineState: 'recent', lastOnlineProbeAt: new Date(now).toISOString() } : row) };
  let lists = 0;
  const load = vm.runInNewContext(source.slice(loadStart, loadEnd) + '\n;loadAccounts', {
    state: current, render() {}, core: { retryTransient: operation => operation() }, accountWorkspaceMode: context.accountWorkspaceMode,
    readStoredAccountId: () => 'a25', writeStoredAccountId() {}, resetAccountPresentation: id => { current.activeAccountId = id; },
    activeAccount: () => current.accounts.find(row => row.id === current.activeAccountId), updateAccountStatus() {},
    window: { zhikeDesktop: {
      wsAccounts: async payload => { calls.push(payload); return { accounts, accountMetrics: ++lists === 1 ? snapshot : refreshed }; },
      ws: async payload => { calls.push(payload); return { accountId: payload.accountId, status: '已连接' }; },
    } },
  });
  await load();
  assert.deepEqual(calls.map(call => call.action), ['list', 'status', 'list']);
  assert.equal(calls[1].accountId, 'a25'); assert.equal(summary(current.accounts, current.accountMetrics, 'dedicated', now).online, 1);
});
