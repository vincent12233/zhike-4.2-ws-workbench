'use strict';

// Execute the shipped read-only business-page module. No browser, WS account,
// customer database, Worker, AI provider or copied UI implementation is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ui = require(path.resolve(__dirname, '../../resources/app/modules/ws-business-pages.js'));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const scope = 'account-a';
const result = (id, accountId = scope) => ({ accountId, rows: [{ id, accountId, name: 'Contact ' + id, normalizedPhone: '919000000051', source: 'ws_conversations', sourceLabel: '本地同步会话' }], total: 1, page: 1, pageSize: 40, pageCount: 1, coverage: 'Only synced local records' });
function page(overrides = {}) {
  const value = { page: 1, filter: '', businessFilters: {}, ...overrides };
  ui.directoryState(value);
  return value;
}

function queryContract() {
  const value = page({ page: 3, filter: '客户 & accountId=other + ?' });
  value.businessFilters = { duplicate: 'duplicate', category: 'audit', type: 'suggestion.approve', outcome: 'applied', from: '2026-11-01T00:00:00.000Z', to: '2026-11-17T00:00:00.000Z', jobId: 'job/a?x=1', objectId: 'object#member' };
  for (const view of ['contacts', 'logs']) {
    const target = new URL(ui.buildDirectoryQuery(view, value, scope), 'https://zhike.local');
    assert.equal(target.pathname, '/api/ws/workspace/' + (view === 'logs' ? 'audit' : 'contacts'));
    assert.deepEqual(target.searchParams.getAll('accountId'), [scope], 'account must be encoded once, never accepted from a query string');
    assert.equal(target.searchParams.get('q'), value.filter);
    assert.equal(target.searchParams.get('page'), '3');
    assert.equal(target.searchParams.get('pageSize'), '40');
    if (view === 'contacts') assert.equal(target.searchParams.get('duplicate'), 'duplicate');
    else for (const key of ['category', 'type', 'outcome', 'jobId', 'objectId']) assert.equal(target.searchParams.get(key), value.businessFilters[key]);
  }
  assert.throws(() => ui.buildDirectoryQuery('chat', value, scope), 'a directory read cannot be silently repurposed for another business page');
  assert.throws(() => ui.buildDirectoryQuery('contacts', value, ''), 'unscoped contacts must not silently fall back to another account');
  assert.throws(() => ui.buildDirectoryQuery('logs', page({ businessFilters: { from: 'not a date' } }), scope));
  assert.throws(() => ui.buildDirectoryQuery('logs', page({ businessFilters: { from: '2026-11-17T00:00:00Z', to: '2026-11-16T00:00:00Z' } }), scope));
}

function acceptanceAndRendering() {
  const value = page();
  assert.equal(value.business.loaded, false); assert.equal(value.business.loading, false);
  assert.equal(value.business.total, null, 'unknown totals must stay unknown before a real response');
  const wrong = result('private-b', 'account-b');
  assert.throws(() => ui.acceptDirectoryResult(value.business, wrong, scope));
  assert.equal(value.business.rows.length, 0, 'mismatched root account must not alter the displayed directory');
  const mixed = result('private-b'); mixed.rows[0].accountId = 'account-b';
  assert.throws(() => ui.acceptDirectoryResult(value.business, mixed, scope));
  assert.equal(value.business.rows.length, 0, 'mismatched row account must be rejected even when the response root looks valid');

  const payload = result('contact-a');
  Object.assign(payload.rows[0], { name: '<img src=x onerror="alert(1)">', externalId: '919000000051@c.us', phone: '+91 90000 00051', phoneStatus: 'valid', customerId: '', crmLinkStatus: 'unlinked', duplicateCount: 2, updatedAt: '2026-11-16T10:00:00Z' });
  assert.equal(ui.acceptDirectoryResult(value.business, payload, scope), true);
  const html = ui.renderDirectory('contacts', value, [{ id: scope, displayName: 'A <script>' }], scope);
  assert.ok(html.includes('919000000051'), 'display the service-normalized phone');
  assert.ok(html.includes('&lt;img'), 'contact display names are text, never executable markup');
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('本地同步会话'), 'show the actual provenance instead of claiming a full platform address book');
  assert.match(html, /重复 2/, 'the actual duplicate count must be distinguishable from new CRM records');
  assert.doesNotMatch(html, /data-ws-action="(?:save-customer|create-customer|contacts-import)/, 'read-only directory must not expose an unapproved CRM/import write');
  const unidentified = page();
  const unknownContact = result('opaque-contact');
  Object.assign(unknownContact.rows[0], { externalId: 'opaque@lid', phone: '', normalizedPhone: '', phoneStatus: 'unprovided', duplicateCount: 0 });
  ui.acceptDirectoryResult(unidentified.business, unknownContact, scope);
  const unknownTable = ui.renderDirectory('contacts', unidentified, [], scope).match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] || '';
  assert.doesNotMatch(unknownTable, /<td>无重复<\/td>/, 'no phone means duplicate status is unknown, not confirmed unique');

  value.business.rows = [];
  value.business.total = 0;
  assert.ok(ui.renderDirectory('contacts', value, [], scope).length > 0, 'valid empty state must render');
  value.business.loading = true;
  assert.match(ui.renderDirectory('contacts', value, [], scope), /加载|loading|aria-busy/, 'loading must be visibly distinguishable from zero records');
  value.business.loading = false; value.business.error = '<script>directory failed</script>';
  const errorHtml = ui.renderDirectory('contacts', value, [], scope);
  assert.ok(errorHtml.includes('&lt;script&gt;directory failed'), 'error text must also be escaped');
  assert.ok(!errorHtml.includes('<script>directory failed'));

  const auditPage = page();
  const audit = { accountId: scope, rows: [{ id: 'ai_task_audit:one', accountId: scope, source: 'ai_task_audit', category: 'audit', action: 'suggestion.approve', outcome: 'applied', at: '2026-11-16T12:00:00Z', jobId: 'job-1', objectType: 'customer', objectId: 'customer-1', reason: '<svg onload=alert(1)>', details: { fieldName: 'occupation', apiKey: 'do-not-display-key', nested: { cookie: 'do-not-display-cookie', originalText: 'do-not-display-chat', authorization: 'Bearer do-not-display-token' } } }], total: 1, page: 1, pageSize: 40, pageCount: 1, category: 'audit', types: ['suggestion.approve'], outcomes: ['applied'], coverage: 'Existing account-scoped audit tables only' };
  audit.coverage = { audit: ['ws_group_audit', 'ai_task_audit', 'ws_send_audit'], snapshot: ['ai_jobs'], unavailable: [{ source: 'Worker / diagnostic files', reason: 'No verified account field' }] };
  assert.equal(ui.acceptDirectoryResult(auditPage.business, audit, scope), true);
  auditPage.detailId = 'ai_task_audit:one';
  const auditHtml = ui.renderDirectory('logs', auditPage, [], scope);
  assert.ok(auditHtml.includes('suggestion.approve'));
  assert.ok(auditHtml.includes('job-1'));
  assert.ok(auditHtml.includes('ws_group_audit') && auditHtml.includes('ws_send_audit'), 'actual coverage sources remain visible');
  assert.ok(auditHtml.includes('No verified account field'), 'account-less audit gaps are explained, not guessed into this account');
  assert.ok(!auditHtml.includes('[object Object]'));
  assert.ok(!auditHtml.includes('<svg onload='), 'audit error/evidence cannot inject markup');
  assert.ok(auditHtml.includes('[已脱敏]'), 'details explicitly show that sensitive fields were removed');
  assert.doesNotMatch(auditHtml, /do-not-display-(?:key|cookie|chat|token)/, 'even detail view must not expose nested credentials or chat text');
  auditPage.businessFilters.category = 'diagnostic';
  auditPage.business.rows = []; auditPage.business.coverage = '诊断日志不在此处提供';
  assert.match(ui.renderDirectory('logs', auditPage, [], scope), /诊断/, 'unavailable diagnostics must remain explicit rather than a fabricated history');
  auditPage.businessFilters.category = 'audit';
  auditPage.business.category = 'snapshot';
  auditPage.business.rows = [{ id: 'ai_jobs:one', accountId: scope, category: 'snapshot', source: 'ai_jobs', action: 'ai.state', outcome: 'pending' }];
  assert.match(ui.renderDirectory('logs', auditPage, [], scope), /<strong>运行状态快照<\/strong>/, 'changing a filter cannot relabel already received runtime snapshots as formal audit');
}

function relationshipIdentity() {
  const members = [{ accountId: scope, groupJid: 'g-one@g.us', groupName: 'Group One', memberJid: 'member@c.us', memberPhone: '9000000051', role: 'admin', status: 'active' }, { accountId: scope, groupJid: 'g-two@g.us', groupName: 'Group Two', memberJid: 'member@c.us', memberPhone: '9000000051', role: '', status: 'left' }];
  const memberPage = page({ statusFilter: 'all', detailId: 'g-one@g.us|member@c.us' });
  const html = ui.renderMembers(members, memberPage);
  assert.ok(html.includes('g-one@g.us') && html.includes('g-two@g.us'), 'same sender in different groups must remain two relationships');
  assert.match(html, /管理员/);
  assert.match(html, /未提供/, 'missing role is not fabricated as an administrator/member fact');
  memberPage.groupFilter = 'g-two@g.us';
  assert.equal(ui.localWindow(members, memberPage).rows.length, 1);
  assert.equal(ui.localWindow(members, memberPage).rows[0].groupJid, 'g-two@g.us');
  const customers = [{ id: 'known', name: 'Shared display name' }, { id: 'other-account', name: 'Shared display name' }, { id: 'deleted', deleted: true }, { id: 'unknown-scope' }, { id: 'no-link', name: 'Shared display name' }];
  const conversations = [{ id: 'a-conversation', accountId: scope, customerId: 'known' }, { id: 'b-conversation', accountId: 'account-b', customerId: 'other-account' }, { id: 'deleted-conversation', accountId: scope, customerId: 'deleted' }, { id: 'unscoped-conversation', customerId: 'unknown-scope' }];
  assert.deepEqual(ui.customerRows(customers, conversations, scope).map(row => row.id), ['known'], 'current-account explicit links only; names, deleted customers, foreign or missing scope never imply a CRM relationship');
}

async function loadingOwnership() {
  const value = page(), a = deferred(), b = deferred();
  let current = 1;
  const first = ui.loadDirectory({ view: 'contacts', page: value, accountId: scope, request: () => a.promise, isCurrent: () => current === 1 });
  current = 2;
  const second = ui.loadDirectory({ view: 'contacts', page: value, accountId: scope, request: () => b.promise, isCurrent: () => current === 2 });
  assert.equal(value.business.loading, true);
  a.resolve(result('late-a'));
  assert.equal(await first, false);
  assert.equal(value.business.loading, true, 'an old finally must not release the new request loading state');
  assert.equal(value.business.rows.some(row => row.id === 'late-a'), false);
  b.resolve(result('current-b'));
  assert.equal(await second, true);
  assert.equal(value.business.loading, false);
  assert.equal(value.business.rows[0].id, 'current-b');

  const stalePage = page(), old = deferred();
  let active = true;
  const pending = ui.loadDirectory({ view: 'logs', page: stalePage, accountId: scope, request: () => old.promise, isCurrent: () => active });
  active = false;
  old.reject(new Error('Account A private failure'));
  assert.equal(await pending, false);
  assert.equal(stalePage.business.loading, false, 'release the old page object without writing into the new account page');
  assert.equal(stalePage.business.error, '', 'a stale failure must not surface on another account');

  const failedPage = page();
  assert.equal(await ui.loadDirectory({ view: 'contacts', page: failedPage, accountId: scope, request: async () => { throw new Error('read unavailable'); }, isCurrent: () => true }), false);
  assert.equal(failedPage.business.loading, false);
  assert.match(failedPage.business.error, /read unavailable/);
  const categoryPage = page({ businessFilters: { category: 'audit' } });
  assert.equal(await ui.loadDirectory({ view: 'logs', page: categoryPage, accountId: scope, request: async () => ({ ...result('snapshot-record'), category: 'snapshot' }), isCurrent: () => true }), false, 'mismatched snapshot response cannot be accepted into an audit query');
  assert.equal(categoryPage.business.rows.length, 0);
}

async function accountSummaryReset() {
  const source = fs.readFileSync(path.resolve(__dirname, '../../resources/app/modules/ws-workbench.js'), 'utf8');
  const extract = (start, end) => { const from = source.indexOf(start), to = source.indexOf(end, from); assert.ok(from > 0 && to > from); return source.slice(from, to); };
  const native = deferred();
  const state = { activeAccountId: 'a', accountLoadSequence: 1, accounts: [{ id: 'a' }, { id: 'b' }], wsWorkspaceView: 'tasks', busy: {}, previewAnalysisSignatures: new Map(), analysisRefreshPending: new Set(), translationBusy: new Set(), conversations: [], backgroundActive: false, followupAlerts: [{ id: 'private-account-a-task', accountId: 'a' }], collectionRun: { id: 'private-account-a-run', accountId: 'a' }, aiQueueStats: { queued: 73, running: 4, total: 80 } };
  const contextCurrent = context => context.accountId === state.activeAccountId && context.sequence === state.accountLoadSequence;
  const sandbox = { state, String, Number, Map, Set, Promise, clearTimeout, text: value => String(value ?? '').trim(), nowIso: () => '2026-11-16T12:00:00Z', groupMonitorNativeSignature: '', settingsSaveTimer: undefined, settingsSaveSequence: 0, loadSequence: 0,
    createGroupMonitorState: accountId => ({ accountId }), cancelAllAiWork: async () => {}, writeStoredAccountId: () => {}, render: () => {}, boundsForBrowserView: () => ({ hidden: true }), window: { zhikeDesktop: { ws: () => native.promise } },
    captureContext: () => ({ accountId: state.activeAccountId, sequence: state.accountLoadSequence }), contextCurrent, assertContext: context => assert.ok(contextCurrent(context)), syncVipGroupAllowlist: async () => {}, loadGroupMonitor: async () => {}, loadGroupMembers: async () => {},
    loadAllConversationPages: async () => ({ conversations: [], groupConversations: [] }), api: async () => { throw new Error('summary read unavailable'); }, applyConversationInventory: result => { state.conversations = result.conversations; }, mergeDiscoveredGroupRows: () => {}, resolveInitialConversationId: () => '', loadConversationData: async () => {},
    businessPages: ui, esc: ui.esc, wsWorkspacePageState: () => ({ status: '已刷新 · 旧缓存状态' }),
  };
  vm.runInNewContext(extract('  async function loadConversations()', '  function currentConversationRefreshSignature(') + extract('  async function switchAccount(', '  function toast(') + extract('  function renderWorkspaceOperationalOverview()', '  function renderWorkspaceMembers(') + '\nglobalThis.switchAccountForTest=switchAccount;globalThis.overviewForTest=renderWorkspaceOperationalOverview;', sandbox);
  const switching = sandbox.switchAccountForTest('b');
  const assertNoForeignSummaries = () => {
    assert.equal(state.followupAlerts.length, 0, 'account A tasks must disappear synchronously before opening B');
    assert.equal(state.collectionRun, null, 'account A run/checkpoint must not be displayed under B');
    assert.notEqual(state.aiQueueStats?.queued, 73, 'account A AI totals must not be reused as B totals');
    assert.equal(state.summaryLoaded?.collection, false); assert.equal(state.summaryLoaded?.followups, false); assert.equal(state.summaryLoaded?.ai, false);
    const overview = sandbox.overviewForTest();
    assert.match(overview, /已加载跟进提醒<\/span><strong>—<\/strong>/, 'an old page refresh marker cannot turn an unread account summary into a false zero');
    assert.match(overview, /AI 排队任务<\/span><strong>—<\/strong>/);
  };
  assertNoForeignSummaries();
  native.resolve({});
  assert.equal(await switching, true);
  assertNoForeignSummaries();
}

async function mainRefreshOwnership() {
  const source = fs.readFileSync(path.resolve(__dirname, '../../resources/app/modules/ws-workbench.js'), 'utf8');
  const from = source.indexOf('  async function refreshWorkspacePage()'), to = source.indexOf('  function renderWorkspaceOperationalOverview()', from);
  assert.ok(from > 0 && to > from);
  const pages = new Map(), requests = [], renders = [], gateA = deferred(), gateB = deferred(), gateA2 = deferred();
  const state = { activeAccountId: 'a', accountLoadSequence: 1, wsWorkspaceView: 'contacts' };
  const pageFor = (view = state.wsWorkspaceView, accountId = state.activeAccountId) => {
    const key = accountId + ':' + view;
    if (!pages.has(key)) pages.set(key, page());
    return pages.get(key);
  };
  const captureContext = () => ({ accountId: state.activeAccountId, sequence: state.accountLoadSequence });
  const contextCurrent = context => context.accountId === state.activeAccountId && context.sequence === state.accountLoadSequence;
  const sandbox = { state, String, Number, Promise, Date, businessPages: ui, wsWorkspacePageState: pageFor, captureContext, contextCurrent,
    assertContext(context) { if (!contextCurrent(context)) throw new Error('STALE_CONTEXT'); },
    render: () => renders.push({ accountId: state.activeAccountId, sequence: state.accountLoadSequence }),
    api: (pathname, init, context) => { requests.push({ pathname, context }); return context.sequence === 1 ? gateA.promise : context.sequence === 2 ? gateB.promise : gateA2.promise; },
  };
  vm.runInNewContext(source.slice(from, to) + '\nglobalThis.refreshForTest=refreshWorkspacePage;', sandbox);
  const first = sandbox.refreshForTest(), oldPage = pageFor();
  state.activeAccountId = 'b'; state.accountLoadSequence = 2;
  const second = sandbox.refreshForTest(), pageB = pageFor();
  state.activeAccountId = 'a'; state.accountLoadSequence = 3;
  const newest = sandbox.refreshForTest();
  assert.equal(requests.length, 3, 'A→B→A must not be blocked by the old A busy marker');
  assert.equal(oldPage.busy, true); assert.equal(oldPage.business.loading, true);
  gateA.reject(new Error('late private A failure'));
  await first;
  assert.equal(oldPage.busy, true, 'old main finally must not clear the current A refresh busy flag');
  assert.equal(oldPage.business.loading, true);
  assert.equal(oldPage.error || '', '');
  assert.equal(oldPage.business.error, '');
  const renderCount = renders.length;
  gateB.resolve(result('b-private', 'b'));
  await second;
  assert.equal(pageB.busy, false);
  assert.equal(renders.length, renderCount, 'B completion must not repaint the active A page');
  gateA2.resolve(result('a-current', 'a'));
  await newest;
  assert.equal(oldPage.busy, false); assert.equal(oldPage.business.loading, false);
  assert.equal(oldPage.business.rows[0].id, 'a-current');
  assert.equal(oldPage.business.rows.some(row => /private/.test(row.id)), false);
}

async function nativeRestoreReset() {
  const source = fs.readFileSync(path.resolve(__dirname, '../../resources/app/modules/ws-workbench.js'), 'utf8');
  const extract = (start, end) => { const from = source.indexOf(start), to = source.indexOf(end, from); assert.ok(from > 0 && to > from); return source.slice(from, to); };
  const listing = deferred();
  const state = { activeAccountId: 'a', accountLoadSequence: 1, accounts: [{ id: 'a' }, { id: 'b' }], busy: {}, previewAnalysisSignatures: new Map(), analysisRefreshPending: new Set(['private-a-analysis']), translationBusy: new Set(),
    followupAlerts: [{ id: 'private-a-task' }], collectionRun: { id: 'private-a-run' }, aiQueueStats: { queued: 73 }, summaryLoaded: { collection: true, followups: true, ai: true },
    currentConversationId: 'private-a-conversation', conversations: [{ id: 'private-a-conversation' }], discoveredConversations: [{ id: 'private-a-discovered' }], discoveredGroupConversations: [{ id: 'private-a-group' }], messages: [{ text: 'private-a-message' }],
    analysis: { occupation: 'private-a-occupation' }, analysisMeta: { id: 'private-a-meta' }, replies: ['private-a-reply'], hotProfile: { id: 'private-a-profile' }, hotProfileEdits: { private: 'a' }, archive: { id: 'private-a-archive' }, matchCandidates: ['private-a-candidate'],
    groupMonitor: { accountId: 'a', rows: [{ id: 'private-a-group' }] }, groupCatalog: [{ id: 'private-a-group' }], groupMembers: { accountId: 'a', rows: [{ id: 'private-a-member' }] }, readHistorySkipped: [{ id: 'private-a-skip' }],
  };
  let registered, requested = 0;
  const sandbox = { state, String, Number, Map, Set, Promise, clearTimeout, settingsSaveTimer: undefined, settingsSaveSequence: 0, groupMonitorNativeSignature: '',
    text: value => String(value ?? '').trim(), createGroupMonitorState: accountId => ({ accountId, rows: [] }), cancelAllAiWork: async () => {}, writeStoredAccountId: () => {}, render: () => {}, updateAccountStatus: () => {},
    core: { retryTransient: work => work() }, window: { zhikeDesktop: { onWsStatus: callback => { registered = callback; }, wsAccounts: () => { ++requested; return listing.promise; } } },
  };
  const reset = extract('  function resetAccountPresentation(', '  function toast(');
  vm.runInNewContext(reset + extract('  async function loadAccounts()', '  function updateAccountStatus(') + '\nconst actualLoadAccounts=loadAccounts;loadAccounts=function(){accountLoad=actualLoadAccounts();return accountLoad;};' + extract('    window.zhikeDesktop?.onWsStatus?.(', '    window.addEventListener(\'resize\','), sandbox);
  assert.equal(typeof registered, 'function', 'exercise the registered native restore callback, not an invented account-switch approximation');
  registered({ restoreAccountId: 'b', accountId: 'b', status: '连接失败' });
  const assertCleared = () => {
    assert.equal(state.activeAccountId, 'b');
    assert.equal(state.followupAlerts.length, 0, 'native restore must clear the prior account task summary synchronously');
    assert.equal(state.collectionRun, null); assert.notEqual(state.aiQueueStats.queued, 73);
    for (const key of ['collection', 'followups', 'ai']) assert.equal(state.summaryLoaded[key], false);
    for (const key of ['conversations', 'discoveredConversations', 'discoveredGroupConversations', 'messages', 'replies', 'groupCatalog', 'readHistorySkipped', 'matchCandidates']) assert.equal(state[key].length, 0, key + ' must not survive a native restore to another account');
    for (const key of ['analysis', 'analysisMeta', 'hotProfile', 'archive']) assert.equal(state[key], null, key + ' must not survive a native restore');
    assert.equal(state.groupMonitor.accountId, 'b'); assert.equal(state.groupMembers.accountId, 'b'); assert.equal(state.groupMembers.rows.length, 0);
    assert.doesNotMatch(JSON.stringify(state.groupMonitor), /private-a/, 'prior-account group display must not survive native restore');
  };
  assertCleared();
  assert.equal(requested, 1, 'native restore still invokes the real account-list loading path');
  listing.reject(new Error('B native account list unavailable'));
  await sandbox.accountLoad;
  assertCleared();
  assert.match(state.error, /B native account list unavailable/);
  assert.equal(state.accountsLoading, false);
}

function directoryFormSubmission() {
  const source = fs.readFileSync(path.resolve(__dirname, '../../resources/app/modules/ws-workbench.js'), 'utf8');
  const extract = (start, end) => { const from = source.indexOf(start), to = source.indexOf(end, from); assert.ok(from > 0 && to > from); return source.slice(from, to); };
  const handlers = new Map(), actions = [];
  const sandbox = { view: { addEventListener: (type, callback) => handlers.set(type, callback) }, state: { wsWorkspaceView: 'contacts' },
    handleAction: (action, element) => { actions.push({ action, view: element.dataset.businessView }); }, Promise,
  };
  vm.runInNewContext(extract("    view?.addEventListener('click',", "    view?.addEventListener('toggle',") + extract("    view?.addEventListener('submit',", '    // keydown Escape'), sandbox);
  for (const businessView of ['contacts', 'logs']) {
    const html = ui.renderDirectory(businessView, page(), [{ id: scope }], scope);
    const formMarkup = html.match(/<form\b[^>]*data-ws-business-form="[^"]+"[\s\S]*?<\/form>/)?.[0];
    assert.ok(formMarkup, 'the shipped module must expose an actual query form');
    const queryMarkup = [...formMarkup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(match => /查询/.test(match[2]));
    assert.ok(queryMarkup, 'query has a visible real button');
    assert.match(queryMarkup[1], /\btype="submit"/, 'Enter and pointer query must share the form submission route');
    assert.doesNotMatch(queryMarkup[1], /data-ws-action=/, 'submit query must not also execute a click action');
    const resetMarkup = [...formMarkup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(match => /重置筛选/.test(match[2]));
    assert.match(resetMarkup[1], /\btype="button"/, 'reset must not submit a second query by default');
    const form = { dataset: { wsBusinessForm: businessView } };
    const target = { closest: selector => selector === '[data-ws-business-form]' ? form : null };
    let prevented = false;
    const pointer = { target, preventDefault: () => { prevented = true; }, stopImmediatePropagation: () => {} };
    const before = actions.length;
    handlers.get('click')(pointer);
    assert.equal(prevented, false, 'delegated action handler must let the normal submit default occur');
    handlers.get('submit')({ target, preventDefault: () => {}, stopImmediatePropagation: () => {} });
    assert.equal(actions.length, before + 1, 'one pointer query results in exactly one business-search');
    assert.deepEqual(actions.at(-1), { action: 'business-search', view: businessView });
    handlers.get('submit')({ target, preventDefault: () => {}, stopImmediatePropagation: () => {} });
    assert.equal(actions.length, before + 2, 'one Enter submit results in exactly one additional business-search');
  }
}

(async () => {
  queryContract(); acceptanceAndRendering(); relationshipIdentity(); await loadingOwnership(); await accountSummaryReset(); await mainRefreshOwnership(); await nativeRestoreReset(); directoryFormSubmission();
  console.log('Stage 5.5B business UI runtime: real module queries, scope rejection, phone/source display, escaped contact/audit text, honest states, and stale request/loading ownership PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
