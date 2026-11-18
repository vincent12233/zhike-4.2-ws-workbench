'use strict';
// Real WS module and business renderers; only boot, DOM, transport and clocks
// are synthetic. No browser, profile, SQLite, network, Worker or paid AI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../resources/app/modules/ws-workbench-core.js');
const business = require('../resources/app/modules/ws-business-pages.js');
const { renderWsWorkbenchFixture } = require('./helpers/ws-workbench-render-fixture.cjs');
const source = fs.readFileSync(path.join(__dirname, '../resources/app/modules/ws-workbench.js'), 'utf8');
const CAPABILITY = Object.freeze({ state: 'blocked', code: 'COLLECTION_CAPABILITY_BLOCKED', reason: '后台采集依赖复制认证状态，已按安全边界停用；前台聊天和手动导入可用。', backgroundCollection: false, automaticHistory: false, groupMonitoring: false, foregroundFallback: false, manualVisibleImport: true });
function fixture(nativeReply) {
  const nativeCalls = [], requests = [], intervals = [], microtasks = [], toasts = [];
  const host = { state: { view: 'home', settings: {}, customers: [], activities: [] }, toast(message) { toasts.push(message); } };
  const document = { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener() {}, removeEventListener() {}, activeElement: null };
  const sandbox = {
    document, console, URL, URLSearchParams, AbortController, DOMException, performance,
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: () => 1, clearTimeout() {}, setInterval(callback) { intervals.push(callback); return intervals.length; }, clearInterval() {}, requestAnimationFrame: () => 0,
    queueMicrotask(callback) { microtasks.push(callback); },
    window: { location: { origin: 'http://127.0.0.1:1' }, innerWidth: 1440, innerHeight: 900, ZhikeWsCore: core, ZhikeWsBusinessPages: business, __zhikeRegistryHost: host,
      zhikeDesktop: { async ws(request) { nativeCalls.push(request); return nativeReply ? nativeReply(request) : { accountId: request.accountId, status: '已连接', supported: true, started: true, collectionCapability: CAPABILITY, conversations: [], messages: [], text: 'manual synthetic selection' }; } },
    },
    async fetch(route, options = {}) {
      requests.push({ route, method: options.method || 'GET', body: options.body || '' });
      return { ok: true, status: 200, headers: { get: () => null }, async json() { return { run: { id: 'run-kept', status: 'running', total: 3 }, conversations: [], groupConversations: [], profiles: [], alerts: [], jobs: [], items: [], groups: [], stats: {} }; } };
    },
  };
  const boot = /  boot\(\);\s*\}\)\(\);\s*$/;
  assert.match(source, boot);
  const exposed = 'state,updateAccountStatus,wsBridge,startBackgroundRuntime,restartBackgroundPolling,refreshCollectionSummary,requestAccountPipelineRefresh,createCollectionRun,collectAllReadConversations,maybeStartAutomaticReadHistoryCollection,updateCollectionRun,resumeCollectionFromCheckpoint,discoverConversations,syncVipGroupAllowlist,syncGroupMonitorNative,createGroupMonitor,scanGroupMonitorTargets,addGroupMonitorTarget,toggleGroupMonitor,toggleGroupMonitorTarget,wsBackgroundStatus,renderWsCockpit,renderCollectionCard,renderGroupMonitorBody,connectionAction,switchAccount';
  vm.runInNewContext(source.replace(boot, `  globalThis.rd02={${exposed}};\n})();`), sandbox, { filename: 'ws-workbench-rd02-real-module.js' });
  const api = sandbox.rd02, state = api.state;
  state.accounts = [{ id: 'a', displayName: '合成账号A', status: '已连接' }, { id: 'b', displayName: '合成账号B', status: '未连接' }];
  state.activeAccountId = 'a'; state.wsStatus = '已连接'; state.backgroundActive = true;
  state.collectionRun = { id: 'run-kept', status: 'running', total: 3, completed: 1, failed: 0, skipped: 0, analyzed: 1, retryable: 1, cursor: 'checkpoint-kept' };
  state.messages = [{ id: 'message-kept', originalText: 'synthetic stored message' }];
  state.conversations = [{ id: 'conversation-kept', accountId: 'a', externalId: 'synthetic-contact', title: '合成联系人', data: {} }];
  state.groupMonitor = { accountId: 'a', profile: { id: 'profile-kept', accountId: 'a', enabled: true, status: 'running', targets: [], pollIntervalSec: 45 }, health: {}, events: [], catalog: [], busy: false, loading: false, statusFilter: 'all', draftJid: '1203-synthetic@g.us', draftName: '合成群组' };
  const context = () => ({ accountId: 'a', conversationId: '', sequence: Number(state.accountLoadSequence || 0) });
  return { ...api, context, nativeCalls, requests, intervals, microtasks, toasts };
}
const cases = [];
const test = (name, run) => cases.push({ name, run });
const retained = state => JSON.stringify({ run: state.collectionRun, messages: state.messages, conversations: state.conversations });

test('native capability telemetry is account-scoped and never replaces connection state', () => {
  const f = fixture(); const before = retained(f.state);
  f.updateAccountStatus({ accountId: 'a', status: '已连接', collectionCapability: CAPABILITY });
  assert.equal(f.state.wsStatus, '已连接'); assert.equal(f.state.accounts[0].status, '已连接');
  assert.equal(f.state.accounts[0].collectionCapability.code, CAPABILITY.code);
  f.updateAccountStatus({ accountId: 'b', status: '等待登录', collectionCapability: { ...CAPABILITY, reason: 'B_CAPABILITY_REASON' } });
  assert.equal(f.state.accounts[0].collectionCapability.reason, CAPABILITY.reason);
  assert.equal(f.state.accounts[1].collectionCapability.reason, 'B_CAPABILITY_REASON'); assert.equal(f.state.wsStatus, '已连接');
  assert.equal(retained(f.state), before);
});

test('collector-dependent native bridge actions fail closed before any native call', async () => {
  const f = fixture();
  for (const action of ['discover-conversations', 'collect-all-read', 'configure-group-monitor', 'start-group-monitor', 'configure-ws-groups', 'configure-vip-groups']) {
    await assert.rejects(f.wsBridge(action, f.context()), error => error.code === CAPABILITY.code);
  }
  assert.equal(f.nativeCalls.length, 0, 'a missing native capability is not permission to use the legacy collector');
});

test('unrecognized capability telemetry cannot enable the legacy path or advertise authorization', async () => {
  const f = fixture();
  f.updateAccountStatus({ accountId: 'a', status: '已连接', collectionCapability: { state: 'available', code: 'unrecognized', reason: 'UNVERIFIED_AUTHORIZATION', backgroundCollection: true, automaticHistory: true } });
  assert.equal(f.state.accounts[0].collectionCapability.backgroundCollection, false);
  assert.notEqual(f.state.accounts[0].collectionCapability.reason, 'UNVERIFIED_AUTHORIZATION');
  await assert.rejects(f.wsBridge('collect-all-read', f.context()), error => error.code === CAPABILITY.code);
  assert.equal(f.nativeCalls.length, 0);
});

test('late blocked actions and mismatched native metadata cannot pollute another account', async () => {
  const f = fixture(); const stale = f.context();
  f.state.activeAccountId = 'b'; f.state.accountLoadSequence++; f.state.error = 'B_CURRENT_ERROR';
  await f.resumeCollectionFromCheckpoint(stale);
  assert.equal(f.state.error, 'B_CURRENT_ERROR'); assert.equal(f.toasts.length, 0); assert.equal(f.requests.length, 0);
  const mismatch = fixture(() => ({ accountId: 'b', collectionCapability: { ...CAPABILITY, reason: 'B_METADATA' } }));
  await mismatch.wsBridge('status', mismatch.context());
  assert.equal(mismatch.state.accounts[0].collectionCapability, undefined, 'response for B is not metadata for requested A');
});

test('unchanged capability heartbeats keep existing account references stable', () => {
  const f = fixture(); const payload = { accountId: 'a', status: '已连接', collectionCapability: CAPABILITY };
  f.updateAccountStatus(payload); const before = f.state.accounts;
  f.updateAccountStatus(payload); assert.equal(f.state.accounts, before);
});

test('manual foreground bridge operations and safe monitor stop are preserved', async () => {
  const f = fixture();
  for (const action of ['open', 'status', 'probe', 'reconnect', 'capture-visible-messages', 'capture-selection', 'send-text', 'send-media', 'pause-group-monitor', 'stop-group-monitor']) {
    await f.wsBridge(action, f.context(), { syntheticSafetyTicket: true });
  }
  assert.equal(f.nativeCalls.length, 10, 'this only verifies the capability boundary; native send acknowledgement remains separately enforced');
});

test('opening a connected foreground account does not turn blocked collection into a connection failure', async () => {
  const f = fixture(); await f.connectionAction('open');
  assert.equal(f.state.wsStatus, '已连接'); assert.equal(f.state.busy.connection, false);
  assert.deepEqual(f.nativeCalls.map(call => call.action), ['open']);
  assert.ok(f.requests.every(call => call.method === 'GET'), 'opening may read existing local history but cannot write collection tasks');
  assert.equal(f.intervals.length, 0); assert.equal(f.microtasks.length, 0);
});

test('manual account switches remain available without restarting any collector', async () => {
  const f = fixture(); assert.equal(await f.switchAccount('b'), true); assert.equal(f.state.activeAccountId, 'b');
  assert.equal(await f.switchAccount('a'), true); assert.equal(f.state.activeAccountId, 'a');
  assert.ok(f.nativeCalls.some(call => call.action === 'open' && call.accountId === 'b'));
  assert.ok(f.nativeCalls.every(call => ['open', 'pause-group-monitor', 'stop-group-monitor'].includes(call.action)));
  assert.ok(f.requests.every(call => call.method === 'GET')); assert.equal(f.microtasks.length, 0);
});

test('blocked collection never registers automatic polling or marks the background running', () => {
  const f = fixture(); f.restartBackgroundPolling();
  assert.equal(f.intervals.length, 0);
  assert.equal(f.wsBackgroundStatus().tone, 'blocked'); assert.match(f.wsBackgroundStatus().label, /不可用|已停用/);
});

test('automatic refresh and delayed account refresh do not consume or mutate queues', async () => {
  const f = fixture(); const before = retained(f.state);
  await f.refreshCollectionSummary({ background: true }); await f.requestAccountPipelineRefresh('b');
  assert.equal(f.requests.length, 0); assert.equal(f.nativeCalls.length, 0); assert.equal(f.microtasks.length, 0);
  assert.equal(retained(f.state), before);
});

test('create, collect, discover and resume are blocked before run API writes', async () => {
  for (const action of ['createCollectionRun', 'collectAllReadConversations', 'discoverConversations', 'resumeCollectionFromCheckpoint']) {
    const f = fixture(); const before = retained(f.state); await f[action](f.context());
    assert.equal(f.requests.length, 0, action + ' must not create or transition a persisted run');
    assert.equal(f.nativeCalls.length, 0); assert.equal(retained(f.state), before); assert.equal(f.state.busy.readHistory, false);
  }
});

test('automatic history scheduling and running transitions cannot bypass the capability', async () => {
  const f = fixture(); const before = retained(f.state);
  f.maybeStartAutomaticReadHistoryCollection(f.context()); await f.updateCollectionRun('running');
  assert.equal(f.microtasks.length, 0); assert.equal(f.requests.length, 0); assert.equal(retained(f.state), before);
});

test('blocked group-monitor enable and scan actions never persist enabled configurations', async () => {
  for (const action of ['createGroupMonitor', 'scanGroupMonitorTargets', 'addGroupMonitorTarget', 'toggleGroupMonitor', 'toggleGroupMonitorTarget']) {
    const f = fixture(); const before = JSON.stringify(f.state.groupMonitor.profile);
    await f[action](action === 'toggleGroupMonitor' ? true : action === 'toggleGroupMonitorTarget' ? { dataset: { targetId: 'target-kept', enabled: 'false' } } : undefined);
    assert.equal(f.requests.length, 0, action + ' must not write enabled=true before native rejects it');
    assert.equal(f.nativeCalls.length, 0); assert.equal(JSON.stringify(f.state.groupMonitor.profile), before);
  }
});

test('allowlist synchronization is a harmless blocked result, not a login failure', async () => {
  const f = fixture(); const result = await f.syncVipGroupAllowlist(f.context(), true);
  assert.equal(result.code, CAPABILITY.code); assert.equal(f.nativeCalls.length, 0);
  assert.equal(f.state.wsStatus, '已连接');
});

test('reading saved enabled monitor configuration cannot restart the native collector', async () => {
  const f = fixture(); const result = await f.syncGroupMonitorNative(f.state.groupMonitor.profile, f.context());
  assert.equal(result.code, CAPABILITY.code); assert.equal(f.nativeCalls.length, 0);
  assert.equal(f.state.groupMonitor.profile.enabled, true, 'historical configuration is preserved, not silently rewritten');
});

test('connected cockpit and collection views show the actual blocked capability', () => {
  const f = fixture(); const cockpit = f.renderWsCockpit(), collection = f.renderCollectionCard();
  assert.match(cockpit, /已连接/); assert.match(cockpit, /COLLECTION_CAPABILITY_BLOCKED/);
  assert.doesNotMatch(cockpit, /后台采集中|is-running/);
  assert.match(collection, /COLLECTION_CAPABILITY_BLOCKED/); assert.match(collection, /历史/);
  assert.doesNotMatch(collection, /后台运行|登录即采集|离开 WS 页面或最小化知客/);
  for (const action of ['create-collection-run', 'collect-all-read']) {
    const buttons = [...collection.matchAll(/<button\b[^>]*>/g)].map(match => match[0]).filter(tag => tag.includes(`data-ws-action="${action}"`));
    assert.ok(buttons.length > 0); assert.ok(buttons.every(tag => /\sdisabled(?:\s|>|=)/.test(tag)), action + ' must be disabled');
  }
});

test('group-monitor UI cannot present historical enabled configuration as live monitoring', () => {
  const f = fixture(); const html = f.renderGroupMonitorBody();
  assert.match(html, /COLLECTION_CAPABILITY_BLOCKED/); assert.doesNotMatch(html, /status-running|监控中|后台监控会在发现变更后/);
  const scan = [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0]).find(tag => tag.includes('data-ws-action="group-monitor-scan"'));
  assert.ok(scan); assert.match(scan, /\sdisabled(?:\s|>|=)/);
});

test('business run details retain checkpoint and identify historical status versus blocked execution', () => {
  const run = { id: 'run-kept', status: 'running', checkpoint: 'checkpoint-kept', updatedAt: '2026-11-17T00:00:00Z' }, before = JSON.stringify(run);
  const html = business.renderRunDetails(run, [{ id: 'item-kept' }], CAPABILITY);
  assert.match(html, /COLLECTION_CAPABILITY_BLOCKED/); assert.match(html, /历史/); assert.match(html, /checkpoint-kept/);
  assert.equal(JSON.stringify(run), before);
});

test('complete WS page renderers do not claim background collection while preserving manual tools', () => {
  for (const view of ['overview', 'accounts', 'chat', 'groups', 'collection', 'settings']) {
    const html = renderWsWorkbenchFixture({ view, wsStatus: '已连接', backgroundActive: true, manualToolsVisible: true });
    assert.match(html, /已连接/);
    assert.doesNotMatch(html, /后台补采中|调度已启动|完整历史采集中|后台采集中|后台采集仍会继续/, view + ' must not misrepresent the inactive collector');
    for (const action of ['discover-conversations', 'collect-all-read', 'create-collection-run', 'group-monitor-create', 'group-monitor-scan', 'group-monitor-add-target', 'group-monitor-add-selected']) {
      const controls = [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0]).filter(tag => tag.includes(`data-ws-action="${action}"`));
      assert.ok(controls.every(tag => /\sdisabled(?:\s|>|=)/.test(tag)), view + ': ' + action + ' stays disabled');
    }
    if (view === 'chat') {
      const status = html.match(/<span class="ws-chat-background-status"[^>]*>[\s\S]*?<\/span>/)?.[0];
      assert.ok(status, 'The compact chat header must expose the real blocked collection status');
      assert.match(status, /data-collection-capability="blocked"/);
      assert.match(status, /aria-label="[^"]*COLLECTION_CAPABILITY_BLOCKED/);
      assert.match(status, /后台采集不可用/);
      const manual = [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0]).find(tag => tag.includes('data-ws-action="capture-visible-messages"'));
      assert.ok(manual); assert.doesNotMatch(manual, /\sdisabled(?:\s|>|=)/);
    }
  }
});

(async () => {
  let failed = 0;
  for (const { name, run } of cases) {
    try { await run(); console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
  }
  console.log(`RD02 WS capability runtime: ${cases.length - failed}/${cases.length}; real modules, synthetic boundaries, no profile/database/network/browser`);
  if (failed) process.exitCode = 1;
})();
