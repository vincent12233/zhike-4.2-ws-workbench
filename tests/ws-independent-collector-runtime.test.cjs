'use strict';

// Execute the shipped workbench and renderer. Only native responses, the DOM,
// clocks and local HTTP transport are synthetic; no WhatsApp account is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../resources/app/modules/ws-workbench-core.js');
const business = require('../resources/app/modules/ws-business-pages.js');
const { renderWsWorkbenchFixture } = require('./helpers/ws-workbench-render-fixture.cjs');
const source = fs.readFileSync(path.join(__dirname, '../resources/app/modules/ws-workbench.js'), 'utf8');
const CAPABILITY = Object.freeze({
  state: 'available', code: 'COLLECTION_INDEPENDENT_SESSION', provider: 'native-independent-session', protocolVersion: 1,
  backgroundCollection: true, automaticHistory: true, groupMonitoring: true, automaticAi: false,
  foregroundFallback: false, manualVisibleImport: true, collectorState: 'running',
});
const STATES = ['not-started', 'awaiting-login', 'login-visible', 'running', 'paused', 'error'];
const COLLECTOR_ACTIONS = ['discover-conversations', 'collect-all-read', 'configure-group-monitor', 'start-group-monitor', 'configure-ws-groups', 'configure-vip-groups'];
const capability = (collectorState, extra = {}) => ({ ...CAPABILITY, collectorState, ...extra });

function fixture(nativeReply, options = {}) {
  const nativeCalls = [], requests = [], microtasks = [], toasts = [], aiCalls = [], events = [];
  const intervals = new Map();
  let nextTimer = 0;
  const host = { state: { view: 'home', settings: {}, customers: [], activities: [] }, toast(value) { toasts.push(value); } };
  const document = { querySelector: selector => selector === '#wsBrowserHost' ? options.browserHost || null : null, querySelectorAll: () => [], getElementById: () => null, addEventListener() {}, removeEventListener() {}, activeElement: null };
  const sandbox = {
    document, console, URL, URLSearchParams, AbortController, DOMException, performance,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame: () => 0,
    setInterval(callback) { const id = ++nextTimer; intervals.set(id, callback); return id; },
    clearInterval(id) { intervals.delete(id); },
    queueMicrotask(callback) { microtasks.push(callback); },
    window: {
      location: { origin: 'http://127.0.0.1:1' }, innerWidth: 1440, innerHeight: 900,
      ZhikeWsCore: core, ZhikeWsBusinessPages: business, __zhikeRegistryHost: host,
      zhikeDesktop: {
        async ws(request) {
          nativeCalls.push(request);
          events.push('native:' + request.action);
          return nativeReply ? nativeReply(request) : {
            accountId: request.accountId, supported: true, started: true,
            collectionCapability: capability('running'), conversations: [], groupConversations: [],
          };
        },
        async wsAccounts(request) {
          return options.accountReply ? options.accountReply(request) : { accounts: [
            { id: 'a', displayName: '合成账号 A', status: '已连接' },
            { id: 'b', displayName: '合成账号 B', status: '未连接' },
          ] };
        },
        async ai(request) { aiCalls.push(request); throw new Error('Automatic paid AI must remain disabled'); },
      },
    },
    async fetch(route, options = {}) {
      requests.push({ route, method: options.method || 'GET', body: options.body || '' });
      events.push('http:' + (options.method || 'GET'));
      return { ok: true, status: 200, headers: { get: () => null }, async json() {
        if (replyToFetch) return replyToFetch(route, options);
        return { run: null, conversations: [], groupConversations: [], profiles: [], alerts: [], jobs: [], items: [], groups: [], stats: {} };
      } };
    },
  };
  const boot = /  boot\(\);\s*\}\)\(\);\s*$/;
  assert.match(source, boot);
  const replyToFetch = options.fetchReply;
  const exposed = 'state,collectionCapability,collectionReady,rememberCollectionCapability,collectorAction,renderCollectorControls,updateAccountStatus,wsBridge,restartBackgroundPolling,scheduleAiQueuePump,wsBackgroundStatus,renderCollectionCard,resetAccountPresentation,loadAccounts,updateCollectionRun';
  vm.runInNewContext(source.replace(boot, `  globalThis.independentCollector={${exposed}};\n})();`), sandbox, { filename: 'ws-independent-collector-real-module.js' });
  const api = sandbox.independentCollector;
  api.state.accounts = [{ id: 'a', displayName: '合成账号 A', status: '已连接' }, { id: 'b', displayName: '合成账号 B', status: '未连接' }];
  api.state.activeAccountId = 'a';
  api.state.wsStatus = '已连接';
  api.state.backgroundActive = false;
  api.state.aiEnabled = true;
  const context = () => ({ accountId: 'a', conversationId: '', sequence: Number(api.state.accountLoadSequence || 0) });
  const publish = (collectorState, accountId = 'a', extra = {}) => api.updateAccountStatus({ accountId, collectionCapability: capability(collectorState, extra) });
  return { ...api, nativeCalls, requests, microtasks, toasts, aiCalls, intervals, context, publish, events };
}

const cases = [];
const test = (name, run) => cases.push({ name, run });

test('exact native protocol exposes support separately from ready collector state', () => {
  for (const collectorState of STATES) {
    const f = fixture();
    f.publish(collectorState);
    const current = f.collectionCapability('a');
    assert.equal(current.state, 'available', collectorState);
    assert.equal(current.collectorState, collectorState);
    assert.equal(current.backgroundCollection, true);
    assert.equal(current.automaticHistory, true);
    assert.equal(current.groupMonitoring, true);
    assert.equal(current.automaticAi, false);
    assert.equal(current.foregroundFallback, false);
    assert.equal(f.collectionReady('backgroundCollection', 'a'), collectorState === 'running');
    assert.equal(f.collectionReady('automaticHistory', 'a'), collectorState === 'running');
    assert.equal(f.collectionReady('groupMonitoring', 'a'), collectorState === 'running');
    assert.equal(f.state.wsStatus, '已连接', 'collector authentication must not replace foreground connectivity');
  }
});

test('unknown provider, version, flags and lifecycle states fail closed', async () => {
  const invalid = [
    { state: 'enabled' }, { code: 'COLLECTION_NATIVE_SESSION' }, { provider: 'native-account-session' },
    { protocolVersion: 2 }, { protocolVersion: '1' }, { backgroundCollection: false },
    { automaticHistory: 'true' }, { groupMonitoring: undefined }, { automaticAi: true },
    { foregroundFallback: true }, { manualVisibleImport: false }, { collectorState: 'connected' },
  ];
  for (const override of invalid) {
    const f = fixture();
    f.publish('running', 'a', override);
    assert.equal(f.collectionReady('backgroundCollection', 'a'), false, JSON.stringify(override));
    await assert.rejects(f.wsBridge('collect-all-read', f.context()), error => error.code === 'COLLECTION_CAPABILITY_BLOCKED');
    assert.equal(f.nativeCalls.length, 0);
    assert.equal(f.intervals.size, 0);
  }
});

test('capability metadata cannot cross the native request account boundary', async () => {
  const f = fixture(() => ({ accountId: 'b', collectionCapability: capability('running') }));
  await f.wsBridge('status', f.context());
  assert.equal(f.collectionReady('backgroundCollection', 'a'), false);
  f.rememberCollectionCapability({ accountId: 'b', collectionCapability: capability('running') }, 'a');
  assert.equal(f.collectionReady('backgroundCollection', 'a'), false, 'explicit requested account cannot launder mismatched metadata');
  f.publish('running', 'b');
  assert.equal(f.collectionReady('backgroundCollection', 'b'), true);
  assert.equal(f.collectionReady('backgroundCollection', 'a'), false);
  assert.equal(f.state.wsStatus, '已连接');
});

test('identical native heartbeats retain account identity and one polling timer', () => {
  const f = fixture();
  f.state.backgroundActive = true;
  f.publish('running');
  assert.equal(f.intervals.size, 1, 'native readiness must start polling even without a foreground status transition');
  const accounts = f.state.accounts;
  f.publish('running');
  assert.equal(f.state.accounts, accounts);
  assert.equal(f.intervals.size, 1);
  f.publish('paused');
  assert.equal(f.intervals.size, 0, 'pause cancels the account polling timer');
  assert.equal(f.collectionReady('backgroundCollection', 'a'), false);
  f.publish('running');
  assert.equal(f.intervals.size, 1);
  f.publish('running', 'a', { protocolVersion: 99 });
  assert.equal(f.intervals.size, 0, 'revoking protocol support stops existing automatic work');
});

test('discovery, history and monitor commands require the independently authenticated collector', async () => {
  for (const collectorState of STATES.filter(value => value !== 'running')) {
    const f = fixture();
    f.publish(collectorState);
    for (const action of COLLECTOR_ACTIONS) await assert.rejects(f.wsBridge(action, f.context()));
    assert.equal(f.nativeCalls.length, 0, collectorState);
    assert.equal(f.requests.length, 0, 'not-ready commands do not mutate persisted collection tasks');
  }
  const running = fixture();
  running.publish('running');
  for (const action of COLLECTOR_ACTIONS) await running.wsBridge(action, running.context());
  assert.deepEqual(running.nativeCalls.map(request => request.action), COLLECTOR_ACTIONS);
  assert.ok(running.nativeCalls.every(request => request.accountId === 'a'));
});

test('independent collector controls preserve the foreground connection and account scope', async () => {
  const resultStates = { 'open-collector': 'login-visible', 'hide-collector': 'awaiting-login', 'pause-collector': 'paused', 'resume-collector': 'running' };
  const f = fixture(request => ({ accountId: request.accountId, collectionCapability: capability(resultStates[request.action] || 'running') }));
  f.publish('not-started');
  for (const action of Object.keys(resultStates)) {
    await f.collectorAction(action);
    assert.ok(f.nativeCalls.some(request => request.action === action && request.accountId === 'a'), action);
    assert.equal(f.collectionCapability('a').collectorState, resultStates[action]);
    assert.equal(f.state.wsStatus, '已连接', action + ' must not claim the foreground account logged out');
  }
  assert.equal(f.aiCalls.length, 0);
});

test('switching accounts during collector login releases busy controls without applying stale UI results', async () => {
  let resolveLogin;
  const f = fixture(request => request.action === 'open-collector'
    ? new Promise(resolve => { resolveLogin = resolve; })
    : { accountId: request.accountId, collectionCapability: capability('paused') });
  f.publish('not-started');
  f.publish('paused', 'b');
  const pending = f.collectorAction('open-collector');
  assert.equal(f.state.busy.collector, true);
  f.state.accountLoadSequence++;
  f.resetAccountPresentation('b');
  f.state.error = 'B-owned status';
  assert.equal(f.state.busy.collector, false, 'a new account must not inherit the old collector command lock');
  resolveLogin({ accountId: 'a', collectionCapability: capability('login-visible') });
  await pending;
  assert.equal(f.state.activeAccountId, 'b');
  assert.equal(f.collectionCapability('b').collectorState, 'paused');
  assert.equal(f.state.error, 'B-owned status');
  assert.equal(f.toasts.length, 0);
  assertEnabled(f.renderCollectorControls(), 'resume-collector');
});

test('same-account list reload cannot strand a pending collector command lock', async () => {
  let resolveLogin;
  const f = fixture(request => request.action === 'open-collector'
    ? new Promise(resolve => { resolveLogin = resolve; })
    : { accountId: request.accountId, collectionCapability: capability('awaiting-login') });
  f.publish('not-started');
  const pending = f.collectorAction('open-collector');
  assert.equal(f.state.busy.collector, true);
  const sequenceBeforeReload = f.state.accountLoadSequence;
  await f.loadAccounts();
  assert.equal(f.state.activeAccountId, 'a');
  assert.ok(f.state.accountLoadSequence > sequenceBeforeReload, 'real account refresh invalidates the old request context');
  f.state.error = 'Latest account refresh owns this status';
  resolveLogin({ accountId: 'a', collectionCapability: capability('login-visible') });
  await pending;
  assert.equal(f.state.busy.collector, false, 'the completed operation still owns and releases its busy flag');
  assert.equal(f.state.error, 'Latest account refresh owns this status');
  assertEnabled(f.renderCollectorControls(), 'hide-collector');
});

test('returning from the collection page supplies visible foreground chat bounds to native', async () => {
  const browserHost = { getBoundingClientRect: () => ({ left: 120, top: 180, width: 900, height: 600 }) };
  const f = fixture(request => ({ accountId: request.accountId, collectionCapability: capability('awaiting-login') }), { browserHost });
  f.publish('login-visible');
  f.state.active = true;
  f.state.wsWorkspaceView = 'collection';
  await f.collectorAction('hide-collector');
  const request = f.nativeCalls.find(call => call.action === 'hide-collector');
  assert.ok(request);
  assert.equal(f.state.wsWorkspaceView, 'chat');
  assert.equal(request.bounds.hidden, false, 'restore the chat route before dispatching native bounds');
  assert.deepEqual(JSON.parse(JSON.stringify(request.bounds)), { hidden: false, x: 120, y: 180, width: 900, height: 600 });
  assert.equal(f.state.wsStatus, '已连接');
});

test('failed or unconfirmed native pause never marks the persisted task paused or stopped', async () => {
  for (const status of ['paused', 'stopped']) for (const mode of ['rejected', 'unconfirmed', 'wrong-account']) {
    const f = fixture(request => {
      assert.equal(request.action, 'pause-collector');
      if (mode === 'rejected') throw new Error('Synthetic native pause failure');
      return { accountId: mode === 'wrong-account' ? 'b' : request.accountId,
        collectionCapability: capability(mode === 'unconfirmed' ? 'running' : 'paused') };
    });
    f.publish('running');
    f.state.collectionRun = { id: 'run-synthetic', status: 'running' };
    await f.updateCollectionRun(status);
    assert.equal(f.requests.length, 0, mode + ': persisted task cannot claim an unconfirmed native stop');
    assert.equal(f.state.collectionRun.status, 'running');
    assert.ok(f.state.error, 'the operator receives the pause failure');
  }
});

test('task pause and stop wait for native acknowledgement before the local status PATCH', async () => {
  for (const status of ['paused', 'stopped']) {
    let resolvePause;
    const f = fixture(request => new Promise(resolve => {
      assert.equal(request.action, 'pause-collector');
      resolvePause = resolve;
    }), { fetchReply: (_, init) => ({ run: JSON.parse(init.body) }) });
    f.publish('running');
    f.state.collectionRun = { id: 'run-synthetic', status: 'running' };
    const pending = f.updateCollectionRun(status);
    assert.equal(f.requests.length, 0, 'local status must wait while native is pausing');
    assert.equal(f.state.collectionRun.status, 'running');
    resolvePause({ accountId: 'a', collectionCapability: capability('paused') });
    await pending;
    assert.deepEqual(f.events, ['native:pause-collector', 'http:PATCH']);
    assert.equal(f.requests.length, 1);
    assert.equal(JSON.parse(f.requests[0].body).status, status);
    assert.equal(f.state.collectionRun.status, status);
    assert.equal(f.collectionCapability('a').collectorState, 'paused');
  }
});

test('task resume restarts a paused authenticated collector but never opens a login session', async () => {
  const f = fixture(request => ({ accountId: request.accountId, supported: false, collectionCapability: capability('running') }),
    { fetchReply: (_, init) => ({ run: JSON.parse(init.body) }) });
  f.publish('paused');
  f.state.collectionRun = { id: 'run-synthetic', status: 'paused' };
  await f.updateCollectionRun('running');
  assert.equal(f.nativeCalls[0].action, 'resume-collector');
  assert.equal(f.nativeCalls.some(call => call.action === 'open-collector'), false);
  assert.equal(f.events[0], 'native:resume-collector');
  assert.equal(f.events[1], 'http:PATCH');
  assert.equal(f.state.collectionRun.status, 'running');
  assert.equal(f.collectionReady('automaticHistory', 'a'), true);

  for (const collectorState of ['not-started', 'awaiting-login', 'login-visible', 'error']) {
    const waiting = fixture();
    waiting.publish(collectorState);
    waiting.state.collectionRun = { id: 'run-synthetic', status: 'paused' };
    await waiting.updateCollectionRun('running');
    assert.equal(waiting.nativeCalls.length, 0, collectorState + ': no implicit login or native start');
    assert.equal(waiting.requests.length, 0);
    assert.equal(waiting.state.collectionRun.status, 'paused');
    assert.match(waiting.state.error, /COLLECTOR_NOT_READY/);
  }
});

test('automatic AI remains disabled even when collection is running and the manual AI toggle is on', async () => {
  const f = fixture();
  f.publish('running');
  f.state.backgroundActive = true;
  f.microtasks.length = 0;
  await f.scheduleAiQueuePump(f.context());
  assert.equal(f.microtasks.length, 0, 'collection capability cannot schedule automatic AI consumption');
  assert.equal(f.requests.length, 0, 'automatic AI must not claim or recover queued jobs');
  assert.equal(f.aiCalls.length, 0);
  assert.equal(f.state.aiEnabled, true, 'the explicit manual AI preference remains available');
});

function buttonTags(html, action) {
  return [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0]).filter(tag => tag.includes(`data-ws-action="${action}"`));
}
function assertEnabled(html, action) {
  const tags = buttonTags(html, action);
  assert.ok(tags.length, 'missing ' + action + ' control');
  assert.ok(tags.some(tag => !/\sdisabled(?:\s|>|=)/.test(tag)), action + ' must be usable');
}

test('collector lifecycle controls offer login, return, pause and resume at their actual states', () => {
  const f = fixture();
  f.publish('not-started'); assertEnabled(f.renderCollectorControls(), 'open-collector');
  f.publish('login-visible'); assertEnabled(f.renderCollectorControls(), 'hide-collector');
  f.publish('running'); assertEnabled(f.renderCollectorControls(), 'pause-collector');
  f.publish('paused'); assertEnabled(f.renderCollectorControls(), 'resume-collector');
  assert.doesNotMatch(f.renderCollectorControls(), /COLLECTION_CAPABILITY_BLOCKED/);
});

test('complete accounts, collection and chat renderers expose independent collector controls', () => {
  for (const view of ['accounts', 'collection', 'chat']) {
    const options = { view, wsStatus: '已连接', backgroundActive: true, activeAccountId: 'a', manualToolsVisible: true };
    const running = renderWsWorkbenchFixture({ ...options, accounts: [{ id: 'a', displayName: '测试账号', status: '已连接', collectionCapability: capability('running') }] });
    assert.doesNotMatch(running, /COLLECTION_CAPABILITY_BLOCKED|后台采集依赖复制认证状态|后台采集按安全边界停用|自动采集已停用/, view);
    assertEnabled(running, 'pause-collector');
    const waiting = renderWsWorkbenchFixture({ ...options, accounts: [{ id: 'a', displayName: '测试账号', status: '已连接', collectionCapability: capability('not-started') }] });
    assertEnabled(waiting, 'open-collector');
    assert.doesNotMatch(waiting, /后台持续运行|后台采集中/, view + ' must not infer ready collection from foreground login');
    const historyButtons = buttonTags(waiting, 'collect-all-read');
    assert.ok(historyButtons.every(tag => /\sdisabled(?:\s|>|=)/.test(tag)), 'full-history operations wait for collector authentication');
  }
});

test('business task details preserve checkpoint without presenting ready support as completed work', () => {
  const run = { id: 'run-synthetic', status: 'paused', checkpoint: 'checkpoint-retained', updatedAt: '2026-11-19T00:00:00Z' };
  const before = JSON.stringify(run);
  for (const collectorState of ['not-started', 'running', 'paused']) {
    const html = business.renderRunDetails(run, [{ id: 'item-synthetic' }], capability(collectorState));
    assert.doesNotMatch(html, /COLLECTION_CAPABILITY_BLOCKED|后台采集依赖复制认证状态/);
    assert.match(html, /checkpoint-retained/);
  }
  assert.equal(JSON.stringify(run), before);
});

(async () => {
  let failed = 0;
  for (const { name, run } of cases) {
    try { await run(); console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + ': ' + (error.stack || error.message)); }
  }
  console.log(`Independent collector frontend: ${cases.length - failed}/${cases.length}; real modules, synthetic native/DOM/HTTP, no real account or paid AI`);
  if (failed) process.exitCode = 1;
})();
