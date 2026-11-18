'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const workbench = read('resources/app/modules/ws-workbench.js');
const host = read('resources/app/modules/desktop-host.js');
const app = read('resources/app/app.js');

assert.match(host, /window\.__zhikeWsFollowups\?\.refresh\?\.\(id\)/,
  'desktop host must preserve the source account when refreshing after native ingestion');
assert.match(host, /on\?\.\('\s*ws\.message\s*'/,
  'desktop host must listen for native WS message events');
assert.match(host, /const refreshIngestion = payload => \(payload\?\.background === true && payload\?\.sharedState !== true\) \? refreshWsOnly\(payload\) : refresh\(payload\)/,
  'ordinary background ingestion must not trigger shared-page refreshes; group projections may refresh shared CRM state');
assert.match(host, /on\?\.\('\s*sync\.updated\s*'/,
  'desktop host must listen for local sync events');
assert.match(host, /on\?\.\('\s*ws\.background-tick\s*'/,
  'native heartbeat must wake the parent WS/AI refresh path while minimized');
assert.match(workbench, /window\.__zhikeWsFollowups\s*=\s*Object\.freeze\(/,
  'WS follow-up bridge must be exposed');
assert.match(workbench, /refresh:\s*accountId\s*=>\s*requestAccountPipelineRefresh\(accountId\)/,
  'WS follow-up bridge must route hidden refreshes to the originating account');
assert.match(workbench, /restoredStatus = await wsBridge\('status', restoreContext\)[\s\S]*?setStatus\(restoredStatus\.status/,
  'background account rotation must explicitly restore the original account status');
assert.match(workbench, /function deactivate\(\)[\s\S]*?state\.active = false;[\s\S]*?wsBridge\('hide'\)/,
  'route deactivation must hide the WebView without stopping the background session');
assert.match(workbench, /async function refreshCollectionSummary\(options = \{\}\)/,
  'refresh path must use the collection/list-sync/AI pipeline');
assert.match(workbench, /if \(state\.backgroundActive && payload\.status === '已连接'\)[\s\S]*?refreshCollectionSummary\(\s*(?:\{[^)]*\})?\s*\)/,
  'native WS status events must refresh the background pipeline off-route');
assert.match(workbench, /addEventListener\('beforeunload',[\s\S]*?stopBackgroundRuntime\(\)/,
  'application shutdown must cancel the background runtime explicitly');

(async () => {
  const nativeHandlers = new Map();
  let releaseFirstRefresh;
  const firstRefresh = new Promise(resolve => { releaseFirstRefresh = resolve; });
  let followupRefreshes = 0;
  const refreshedAccounts = [];
  let sharedRefreshes = 0;
  const window = {
    __zhikeWsFollowups: {
      refresh(accountId) {
        followupRefreshes += 1;
        refreshedAccounts.push(accountId || '');
        return followupRefreshes === 1 ? firstRefresh : Promise.resolve();
      },
    },
    __refreshSharedState() { sharedRefreshes += 1; return Promise.resolve(); },
    zhikeDesktop: { on(name, handler) { nativeHandlers.set(name, handler); } },
    addEventListener() {},
    dispatchEvent() {},
  };
  vm.runInNewContext(host, {
    window,
    document: { documentElement: { dataset: {} }, hidden: true },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    Promise,
    Boolean,
    queueMicrotask,
  });
  const heartbeat = nativeHandlers.get('ws.background-tick');
  assert.equal(typeof heartbeat, 'function', 'native background heartbeat must register a parent refresh handler');
  heartbeat();
  heartbeat();
  heartbeat();
  await Promise.resolve();
  assert.equal(followupRefreshes, 1, 'heartbeat bursts must not start concurrent AI/collection refreshes');
  releaseFirstRefresh();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(followupRefreshes, 2, 'coalesced heartbeat must schedule exactly one follow-up refresh');
  assert.equal(sharedRefreshes, 0, 'heartbeat must not pull/render the whole CRM when no business version changed');
  nativeHandlers.get('ws.message')({ accountId: 'alpha' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(followupRefreshes, 3, 'a real native ingestion event still refreshes the WS/AI pipeline');
  assert.equal(sharedRefreshes, 1, 'a real native ingestion event still checks shared business state');
  assert.equal(refreshedAccounts.at(-1), 'alpha', 'native ingestion refresh remains scoped to its WS account');

  const refreshStart = app.indexOf('async function refreshSharedState()');
  const refreshEnd = app.indexOf('  async function followupAction', refreshStart);
  assert.ok(refreshStart >= 0 && refreshEnd > refreshStart, 'shared-state refresh implementation must be extractable for runtime verification');
  const metricsStart = app.indexOf('  let metricsReadState=');
  const metricsEnd = app.indexOf('  const cloneStateData=', metricsStart);
  const scheduleStart = app.indexOf('  function scheduleHomeRefresh()');
  const scheduleEnd = app.indexOf('  async function syncFromBackend', scheduleStart);
  assert.ok(metricsStart >= 0 && metricsEnd > metricsStart && scheduleStart >= 0 && scheduleEnd > scheduleStart, 'real read provenance and home-refresh scheduler must be extractable');
  let backendState = { initialized: true, version: 'v1', customers: [] };
  const animationFrames = [];
  const flushAnimationFrames = () => { while (animationFrames.length) animationFrames.shift()(); };
  let fetches = 0, applies = 0, renders = 0;
  const refreshRuntime = {
    window: { __LOCAL_DB__: true },
    syncBusy: false,
    destructiveWriteBusy: false,
    pendingStateData: null,
    writeConflict: null,
    queuedWriteCount: 0,
    localDataRevision: 7,
    stateVersion: 'v1',
    state: { view: 'home' },
    syncReadFailure: null,
    lastCommittedState: null,
    homeRefreshPending: false,
    requestAnimationFrame(callback) { animationFrames.push(callback); return animationFrames.length; },
    $() { return null; },
    fetch: async () => {
      fetches += 1;
      return { ok: true, json: async () => ({ ...backendState }) };
    },
    applySharedData() { applies += 1; },
    cloneStateData(value) { return value; },
    statePayload() { return { customers: [] }; },
    markSyncVersion() {},
    render() { renders += 1; },
    String,
    Error,
  };
  vm.runInNewContext(`${app.slice(metricsStart, metricsEnd)}\n${app.slice(scheduleStart, scheduleEnd)}\n${app.slice(refreshStart, refreshEnd)}\nthis.metricsFixture={beginMetricsRead,completeMetricsRead,getState:()=>metricsReadState};`, refreshRuntime);
  const refreshSharedState = refreshRuntime.refreshSharedState;
  // This scenario starts with a previously read in-memory v1. Establish that
  // provenance through the production lifecycle, and flush its real scheduler.
  const initialRead = refreshRuntime.metricsFixture.beginMetricsRead();
  refreshRuntime.metricsFixture.completeMetricsRead(initialRead, 'applied');
  assert.equal(refreshRuntime.metricsFixture.getState().status, 'loaded');
  assert.equal(animationFrames.length, 1, 'real provenance transition schedules home status presentation');
  flushAnimationFrames();
  assert.equal(renders, 1, 'real home refresh callback executes once');
  renders = 0;
  assert.equal(await refreshSharedState(), true);
  assert.equal(applies, 0, 'unchanged shared-state version must not replace in-memory records');
  assert.equal(renders, 0, 'unchanged shared-state version must not rebuild the current form/page DOM');
  backendState = { initialized: true, version: 'v2', customers: [{ id: 'remote' }] };
  refreshRuntime.pendingStateData = { customers: [{ id: 'editing' }] };
  assert.equal(await refreshSharedState(), null, 'pending local edits postpone shared-state replacement');
  assert.equal(fetches, 1, 'pending local edits are guarded before a backend read');
  assert.equal(applies, 0, 'pending local edits cannot be overwritten by native ingestion refresh');
  refreshRuntime.pendingStateData = null;
  assert.equal(await refreshSharedState(), true);
  assert.equal(applies, 1, 'a genuinely newer business version remains refreshable after edits are safe');
  assert.equal(renders, 1, 'a genuinely newer business version renders once');
  assert.equal(refreshRuntime.stateVersion, 'v2');
  backendState = { initialized: true, version: 'v2-ws', customers: [{ id: 'remote-ws' }] };
  refreshRuntime.state.view = 'ws-workbench';
  assert.equal(await refreshSharedState(), true);
  assert.equal(applies, 2, 'WS route still adopts newer shared data in memory');
  assert.equal(renders, 1, 'WS route must not rebuild the shell during background shared-state refresh');
  refreshRuntime.state.view = 'home';
  let releaseOlderRead;
  refreshRuntime.fetch = async () => new Promise(resolve => {
    releaseOlderRead = () => resolve({ ok: true, json: async () => ({ initialized: true, version: 'v3', customers: [{ id: 'stale' }] }) });
  });
  const olderRead = refreshSharedState();
  await Promise.resolve();
  refreshRuntime.stateVersion = 'v4';
  releaseOlderRead();
  assert.equal(await olderRead, null, 'a response started under an older version is discarded after a newer sync wins');
  assert.equal(refreshRuntime.stateVersion, 'v4', 'a late response cannot roll the UI back to an older state version');
  assert.equal(applies, 2, 'a late older response cannot replace current customer data');
  assert.equal(renders, 1, 'a late older response cannot rebuild the current page');
  assert.equal(refreshRuntime.metricsFixture.getState().status, 'loaded', 'discarded response preserves proven read state');
  assert.equal(refreshRuntime.metricsFixture.getState().pending.size, 0, 'discarded read releases lifecycle bookkeeping');
  refreshRuntime.state.view = 'ws-workbench';
  refreshRuntime.fetch = async () => { throw new Error('isolated read failure'); };
  await assert.rejects(() => refreshSharedState(), /isolated read failure/, 'reader still propagates errors to its caller');
  assert.equal(refreshRuntime.metricsFixture.getState().status, 'error', 'actual provenance records read failure');
  assert.equal(refreshRuntime.metricsFixture.getState().errorCode, 'STATE_READ_FAILED');
  assert.equal(refreshRuntime.metricsFixture.getState().pending.size, 0);
  assert.equal(renders, 1, 'read failure must not rebuild WS shell');
  assert.equal(animationFrames.length, 0, 'read status feedback never schedules a WS shell refresh');
  refreshRuntime.fetch = async () => ({ ok: true, json: async () => ({ initialized: true, version: 'v5', customers: [] }) });
  assert.equal(await refreshSharedState(), true);
  assert.equal(refreshRuntime.metricsFixture.getState().status, 'loaded', 'real successful apply recovers read provenance');
  assert.equal(refreshRuntime.metricsFixture.getState().errorCode, null);
  assert.equal(applies, 3, 'valid recovery applies the existing business read path once');
  assert.equal(renders, 1, 'recovery must not rebuild WS shell');
  assert.equal(animationFrames.length, 0, 'recovered WS provenance does not schedule page rendering');
  console.log('WS live refresh contract: heartbeat is WS-only; real ingestion/version guards and actual read provenance recover safely without rebuilding WS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
