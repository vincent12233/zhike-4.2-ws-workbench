'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../resources/app/modules/ws-workbench.js'), 'utf8');
const extract = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from > 0 && to > from);
  return source.slice(from, to);
};
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
function fixture(delayB = false) {
  const gateA = deferred(), gateB = deferred(), startedB = deferred();
  const state = { activeAccountId: 'a', accountLoadSequence: 1, currentConversationId: 'old-account-a-conversation', conversationSelectionManual: true, accounts: [{ id: 'a' }, { id: 'b' }], wsWorkspaceView: 'groups', busy: {}, previewAnalysisSignatures: new Map(), analysisRefreshPending: new Set(), translationBusy: new Set(), conversations: [], backgroundActive: false };
  const native = [], calls = [];
  const contextCurrent = context => context.accountId === state.activeAccountId && context.sequence === state.accountLoadSequence;
  const sandbox = {
    state, String, Map, Set, Promise, clearTimeout, text: value => String(value ?? '').trim(), nowIso: () => '2026-11-16T12:00:00Z',
    modeAccount: id => state.accounts.find(account => String(account.id) === String(id)),
    invalidateExclusionPage: () => {},
    groupMonitorNativeSignature: '', settingsSaveTimer: undefined, settingsSaveSequence: 0,
    groupMonitorContext: () => ({ accountId: state.activeAccountId, sequence: state.accountLoadSequence }),
    captureContext: () => ({ accountId: state.activeAccountId, sequence: state.accountLoadSequence }),
    contextCurrent,
    assertContext(context) { if (!contextCurrent(context)) throw new Error('STALE_CONTEXT'); },
    api: async (route, options, context) => {
      calls.push({ route, accountId: context.accountId });
      if (route.includes('/groups?')) {
        if (context.accountId === 'a') return gateA.promise;
        startedB.resolve();
        return delayB ? gateB.promise : { groups: [{ accountId: 'b', groupJid: 'b@g.us' }] };
      }
      if (route === '/api/ws/group-monitors/profiles') return { profiles: [{ id: 'profile-b', accountId: 'b', slotKey: 'fixed-group-seat' }] };
      if (route.includes('/events?')) return { events: [{ id: 'event-b', accountId: 'b' }] };
      if (route === '/api/ws/group-monitors/profile-b') return { profile: { id: 'profile-b', accountId: 'b' }, health: { targetCount: 1 } };
      throw new Error('Unexpected service request: ' + route);
    },
    window: { zhikeDesktop: { ws: async payload => { native.push(payload); return {}; } } },
    syncGroupMonitorNative: async (profile, context) => { assert.ok(contextCurrent(context)); native.push({ monitor: profile?.id, accountId: context.accountId }); },
    syncVipGroupAllowlist: async () => {}, cancelAllAiWork: async () => {}, loadConversations: async () => {},
    loadGroupMembers: async () => {}, writeStoredAccountId: () => {}, render: () => {}, updateGroupMonitorDom: () => {},
    boundsForBrowserView: () => ({ hidden: true }), getHost: () => null,
  };
  vm.runInNewContext(
    extract('  function createGroupMonitorState(', '  const CONVERSATION_RENDER_BATCH') +
    extract('  async function loadGroupMonitor(', '  async function createGroupMonitor(') +
    extract('  async function switchAccount(', '  function toast(') +
    '\nglobalThis.makeMonitor=createGroupMonitorState;globalThis.load=loadGroupMonitor;globalThis.switchAccount=switchAccount;', sandbox);
  state.groupMonitor = { ...sandbox.makeMonitor('a'), profile: { id: 'old-a', accountId: 'a' }, events: [{ id: 'old-event-a' }] };
  state.groupCatalog = [{ accountId: 'a', groupJid: 'old-a@g.us' }];
  Object.assign(state, {
    hotProfile: { customerId: 'customer-a', fields: { preferred_name: { value: 'Account A private name' } } },
    hotProfileError: 'old-account-a-profile-error', hotProfileBusy: true,
    hotProfileEdits: { preferred_name: 'Account A unsaved edit' }, hotProfileColorDraft: 'red',
    archive: { customer: { id: 'customer-a', name: 'Account A private name' } }, archiveError: 'old-account-a-archive-error',
    crmSyncStatus: 'old-account-a-sync-status', matchCandidates: [{ id: 'customer-a', name: 'Account A private name' }],
  });
  return { state, sandbox, gateA, gateB, startedB, native, calls };
}
function assertNoPreviousAccountProfile(state) {
  assert.equal(state.hotProfile, null); assert.equal(state.hotProfileError, ''); assert.equal(state.hotProfileBusy, false);
  assert.equal(Object.keys(state.hotProfileEdits).length, 0); assert.equal(state.hotProfileColorDraft, '');
  assert.equal(state.archive, null); assert.equal(state.archiveError, ''); assert.equal(state.crmSyncStatus, '');
  assert.equal(state.matchCandidates.length, 0);
}
function switchHarness({ pauseStage = 'native', pauseAccount = 'b', failB = false } = {}) {
  const test = fixture(), paused = deferred(), entered = deferred(), newestNative = deferred();
  test.state.accounts.push({ id: 'c' }); test.state.wsWorkspaceView = 'members'; test.state.error = '';
  const steps = [], renders = [], stored = [];
  const invoke = async (stage, accountId) => {
    steps.push({ stage, accountId });
    if (failB && stage === 'native' && accountId === 'b') throw new Error('current B failed');
    if (accountId === pauseAccount && stage === pauseStage) { entered.resolve(); return paused.promise; }
    if (stage === 'native' && accountId === 'c') return newestNative.promise;
    return {};
  };
  test.sandbox.window.zhikeDesktop.ws = async payload => { test.native.push(payload); return invoke('native', payload.accountId); };
  test.sandbox.syncVipGroupAllowlist = context => invoke('vip', context.accountId);
  test.sandbox.loadConversations = () => invoke('conversations', test.state.activeAccountId);
  test.sandbox.loadGroupMonitor = () => invoke('monitor', test.state.activeAccountId);
  test.sandbox.loadGroupMembers = context => invoke('members', context.accountId);
  test.sandbox.writeStoredAccountId = accountId => stored.push(accountId);
  test.sandbox.render = () => renders.push({ accountId: test.state.activeAccountId, busy: test.state.accountBusy, error: test.state.error });
  return { ...test, paused, entered, newestNative, steps, renders, stored };
}
function assertNewSwitchUntouched(test, rendersBefore) {
  assert.equal(test.state.activeAccountId, 'c'); assert.equal(test.state.accountBusy, true);
  assert.equal(test.state.error, 'newest C state'); assert.equal(test.renders.length, rendersBefore);
  assert.equal(test.stored.at(-1), 'c');
}
(async () => {
  const lateA = fixture();
  const oldMonitor = lateA.state.groupMonitor;
  const requestA = lateA.sandbox.load({ silent: true });
  assert.equal(oldMonitor.loading, true);
  const switching = lateA.sandbox.switchAccount('b');
  assert.equal(lateA.state.currentConversationId, '', 'switching accounts must immediately clear the previous account conversation');
  assert.equal(lateA.state.conversationSelectionManual, false, 'switching accounts must reset manual selection before a new response arrives');
  assert.equal(lateA.state.groupMonitor.accountId, 'b');
  assert.equal(lateA.state.groupMonitor.profile, null, 'account B must never display account A profile while loading');
  assert.equal(lateA.state.groupMonitor.events.length, 0);
  assert.equal(lateA.state.groupCatalog.length, 0);
  assertNoPreviousAccountProfile(lateA.state);
  assert.equal(await switching, true);
  assert.equal(lateA.state.currentConversationId, '', 'an empty account B must not inherit an account A conversation');
  assertNoPreviousAccountProfile(lateA.state);
  const currentMonitor = lateA.state.groupMonitor;
  assert.equal(currentMonitor.profile.id, 'profile-b');
  assert.equal(currentMonitor.events[0].id, 'event-b');
  assert.equal(lateA.state.groupCatalog[0].groupJid, 'b@g.us');
  lateA.gateA.resolve({ groups: [{ accountId: 'a', groupJid: 'late-a@g.us' }] });
  await requestA;
  assert.equal(oldMonitor.loading, false, 'a stale request must release its captured lock');
  assert.equal(lateA.state.groupMonitor, currentMonitor);
  assert.equal(currentMonitor.profile.id, 'profile-b');
  assert.equal(lateA.state.groupCatalog[0].groupJid, 'b@g.us', 'late A response must not overwrite B catalog');
  assert.equal(currentMonitor.error, '');
  assertNoPreviousAccountProfile(lateA.state);
  assert.equal(lateA.native.filter(item => item.monitor).length, 1, 'a stale account response must never configure a native monitor');

  const earlyA = fixture(true);
  const pendingA = earlyA.sandbox.load({ silent: true });
  const pendingSwitch = earlyA.sandbox.switchAccount('b');
  await earlyA.startedB.promise;
  const pendingBMonitor = earlyA.state.groupMonitor;
  assert.equal(pendingBMonitor.loading, true);
  earlyA.gateA.resolve({ groups: [{ accountId: 'a', groupJid: 'stale-a@g.us' }] });
  await pendingA;
  assert.equal(pendingBMonitor.loading, true, 'stale A finally must not release B in-flight lock');
  earlyA.gateB.resolve({ groups: [{ accountId: 'b', groupJid: 'b@g.us' }] });
  assert.equal(await pendingSwitch, true);
  assert.equal(pendingBMonitor.loading, false);
  assert.equal(pendingBMonitor.profile.id, 'profile-b');

  for (const pauseStage of ['native', 'vip', 'conversations', 'monitor', 'members']) {
    const test = switchHarness({ pauseStage });
    const oldSwitch = test.sandbox.switchAccount('b'); await test.entered.promise;
    const newSwitch = test.sandbox.switchAccount('c'); test.state.error = 'newest C state';
    const rendersBefore = test.renders.length, stepsBefore = test.steps.length;
    test.paused.resolve({}); assert.equal(await oldSwitch, false);
    assertNewSwitchUntouched(test, rendersBefore);
    assert.equal(test.steps.length, stepsBefore, `stale ${pauseStage} success must not continue any account/native refresh`);
    test.newestNative.resolve({}); assert.equal(await newSwitch, true);
    assert.equal(test.state.activeAccountId, 'c'); assert.equal(test.state.accountBusy, false); assert.equal(test.state.error, '');
  }
  for (const pauseStage of ['native', 'conversations']) {
    const test = switchHarness({ pauseStage });
    const oldSwitch = test.sandbox.switchAccount('b'); await test.entered.promise;
    const newSwitch = test.sandbox.switchAccount('c'); test.state.error = 'newest C state';
    const rendersBefore = test.renders.length;
    test.paused.reject(new Error('old B timeout')); assert.equal(await oldSwitch, false);
    assertNewSwitchUntouched(test, rendersBefore);
    assert.equal(test.native.some(call => call.accountId === 'a'), false, 'late failure must not reopen the old account');
    test.newestNative.resolve({}); assert.equal(await newSwitch, true);
  }
  const latestFailure = switchHarness({ pauseAccount: 'unused', failB: true });
  assert.equal(await latestFailure.sandbox.switchAccount('b'), false);
  assert.equal(latestFailure.state.activeAccountId, 'a'); assert.equal(latestFailure.state.accountBusy, false);
  assert.deepEqual(latestFailure.native.map(call => call.accountId), ['b', 'a'], 'the current failed request must still restore the prior native account');
  assert.deepEqual(latestFailure.stored, ['b', 'a']); assert.equal(latestFailure.state.error, 'current B failed');

  for (const pauseStage of ['native', 'conversations', 'monitor', 'members']) {
    for (const fails of [false, true]) {
      const test = switchHarness({ pauseStage, pauseAccount: 'a', failB: true });
      const restoring = test.sandbox.switchAccount('b'); await test.entered.promise;
      const newSwitch = test.sandbox.switchAccount('c'); test.state.error = 'newest C state';
      const rendersBefore = test.renders.length, stepsBefore = test.steps.length;
      if (fails) test.paused.reject(new Error('old restore timeout')); else test.paused.resolve({});
      assert.equal(await restoring, false, 'a stale restore rejection must not escape into the global action error handler');
      assertNewSwitchUntouched(test, rendersBefore);
      assert.equal(test.steps.length, stepsBefore, `stale rollback ${pauseStage} completion must stop its restore chain`);
      test.newestNative.resolve({}); assert.equal(await newSwitch, true);
    }
  }
  const triple = switchHarness();
  const first = triple.sandbox.switchAccount('b'); await triple.entered.promise;
  const second = triple.sandbox.switchAccount('c');
  assert.equal(await triple.sandbox.switchAccount('a'), true);
  const finalRenders = triple.renders.length;
  triple.state.error = 'final A state';
  triple.newestNative.resolve({}); assert.equal(await second, false);
  triple.paused.reject(new Error('first B late error')); assert.equal(await first, false);
  assert.equal(triple.state.activeAccountId, 'a'); assert.equal(triple.state.accountBusy, false); assert.equal(triple.state.error, 'final A state');
  assert.equal(triple.renders.length, finalRenders); assert.deepEqual(triple.stored, ['b', 'c', 'a']);
  assert.deepEqual(triple.native.map(call => call.accountId), ['b', 'c', 'a']);
  console.log('WS account runtime: scoped monitor/profile state, every switch await boundary, stale native/API errors, rollback completion races and three-account sequence ownership PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
