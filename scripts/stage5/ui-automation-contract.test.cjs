'use strict';

// Executes the application's refresh controller. This is a controller test,
// not a substitute for Windows desktop/WebView visual acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const repo = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(repo, 'resources/app/modules/ws-workbench.js'), 'utf8');
const start = source.indexOf('  function workspacePageHeader(');
const end = source.indexOf('  function renderWsWorkspacePage(', start);
assert.ok(start > 0 && end > start);
const pending = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture(view = 'collection') {
  const state = { activeAccountId: 'a', accountLoadSequence: 1, wsWorkspaceView: view, error: '', groupMonitor: {}, currentConversationId: 'chat-a', wsWorkspacePageState: {} };
  const calls = []; let renders = 0;
  const sandbox = {
    state, String, Number, Date, Promise, esc: String,
    businessPages: require('../../resources/app/modules/ws-business-pages.js'),
    captureContext: conversationId => ({ accountId: state.activeAccountId, sequence: state.accountLoadSequence, conversationId }),
    contextCurrent: context => context.accountId === state.activeAccountId && context.sequence === state.accountLoadSequence,
    assertContext(context) { if (context.accountId !== state.activeAccountId || context.sequence !== state.accountLoadSequence) throw new Error('过期操作'); },
    wsWorkspacePageState(v = state.wsWorkspaceView, a = state.activeAccountId) { return state.wsWorkspacePageState[a + ':' + v] ||= { busy: false, error: '', status: '尚未刷新', scrollTop: 0 }; },
    render() { renders += 1; },
    api: async route => { calls.push(route); return route.includes('collection-runs') ? { run: { id: 'run-a' } } : route.includes('followup-alerts') ? { alerts: [{ id: 'alert-a' }] } : { stats: { queued: 3 } }; },
    loadAccounts: async () => { state.accountLoadSequence += 1; calls.push('accounts'); },
    loadGroupMonitor: async () => { calls.push('group-monitor'); },
    loadDataArchive: async () => { calls.push('archive'); },
    loadHotProfile: async () => { calls.push('profile'); },
    core: { normalizeTranslationSettings: value => value },
    window: { ZhikeAiReviewCenter: { refresh: async () => { calls.push('review'); } } },
  };
  vm.runInNewContext(source.slice(start, end) + '\n globalThis.runRefresh=refreshWorkspacePage; globalThis.header=workspacePageHeader;', sandbox);
  return { sandbox, state, calls, page: () => sandbox.wsWorkspacePageState(), renders: () => renders };
}
(async () => {
  const normal = fixture(); await normal.sandbox.runRefresh();
  assert.equal(normal.state.collectionRun.id, 'run-a');
  assert.equal(normal.state.followupAlerts[0].id, 'alert-a');
  assert.equal(normal.page().busy, false); assert.match(normal.page().status, /已刷新/);
  assert.equal(normal.calls.length, 4, 'refresh reads three summaries plus the selected run items without starting a consumer');
  assert.match(normal.calls[3], /^\/api\/ws\/collection-items\?runId=run-a&limit=1000$/);
  assert.doesNotMatch(source.slice(start, end), /refreshCollectionSummary\(|wsBridge\(|scheduleAiQueuePump\(/, 'manual UI refresh must not start collection or AI consumption');

  const accounts = fixture('accounts'); await accounts.sandbox.runRefresh();
  assert.equal(accounts.page().busy, false, 'account list sequence changes must not strand the page busy');
  assert.match(accounts.page().status, /已刷新/);
  const accountFailure = fixture('accounts'); accountFailure.sandbox.loadAccounts = async () => { accountFailure.state.error = '账号读取失败'; };
  await accountFailure.sandbox.runRefresh(); assert.equal(accountFailure.page().error, '账号读取失败');

  const blocked = fixture(); const wait = pending(); blocked.sandbox.api = async () => wait.promise;
  const inFlight = blocked.sandbox.runRefresh(); const oldPage = blocked.page();
  assert.equal(oldPage.busy, true); await blocked.sandbox.runRefresh();
  blocked.state.activeAccountId = 'b'; blocked.state.accountLoadSequence += 1;
  wait.resolve({}); await inFlight;
  assert.equal(oldPage.busy, false, 'stale completion releases only its originating page');
  assert.equal(blocked.page().error, '', 'old account error must not leak to new account');
  assert.equal(blocked.state.collectionRun, undefined, 'stale results must not replace current account data');

  const navigation = fixture(); const navWait = pending(); navigation.sandbox.api = async () => navWait.promise;
  const navRefresh = navigation.sandbox.runRefresh(); const priorPage = navigation.page(); navigation.state.wsWorkspaceView = 'tasks';
  navWait.resolve({}); await navRefresh; assert.equal(priorPage.busy, false); assert.equal(navigation.page().status, '尚未刷新');
  assert.equal(navigation.renders(), 1, 'old page completion must not rerender the newly selected page');

  const error = fixture(); error.sandbox.api = async () => { throw new Error('本机服务暂时不可用'); };
  await error.sandbox.runRefresh(); assert.equal(error.page().busy, false); assert.match(error.page().error, /本机服务/);
  assert.match(error.sandbox.header({ id: 'collection', label: '采集', hint: '' }, 'A'), /aria-live="polite"/);
  const ai = fixture('ai'); await ai.sandbox.runRefresh(); assert.ok(ai.calls.includes('review'));
  const crm = fixture('crm'); await crm.sandbox.runRefresh(); assert.deepEqual(crm.calls, ['archive', 'profile', 'review']);
  const contacts = fixture('contacts');
  contacts.sandbox.api = async route => { contacts.calls.push(route); return { accountId: 'a', rows: [], total: 0, page: 1, pageCount: 1 }; };
  await contacts.sandbox.runRefresh();
  assert.equal(contacts.calls.length, 1, 'contacts uses its real read-only directory rather than the collection poller');
  assert.match(contacts.calls[0], /^\/api\/ws\/workspace\/contacts\?/);
  assert.equal(contacts.page().business.loaded, true); assert.equal(contacts.page().business.total, 0);
  const chat = fixture('chat'); await chat.sandbox.runRefresh();
  assert.equal(chat.calls.length, 0, 'chat refresh must not start a query, collection or AI service');
  assert.equal(chat.renders(), 0);
  console.log('stage5 UI controller: read-only refresh, account/page races, errors, busy recovery and review routing PASS; native visual acceptance NotTested');
})().catch(error => { console.error(error); process.exitCode = 1; });
