'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const repo = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(repo, 'resources/app/modules/ws-workbench.js'), 'utf8');
const modeViews = {
  ordinary: ['overview', 'accounts', 'chat', 'collection', 'ai', 'crm', 'tasks', 'logs', 'settings'],
  dedicated: ['overview', 'accounts', 'chat', 'groups', 'members', 'collection', 'contacts', 'exclusions', 'crm', 'logs', 'group-broadcast', 'group-mentions', 'group-reading', 'group-permissions', 'settings'],
};
const metadataStart = source.indexOf('  function normalizeWorkspaceMode(');
const metadataEnd = source.indexOf('  function readWsWorkspaceView(', metadataStart);
const navStart = source.indexOf('  function renderWsWorkspaceNav(');
const navEnd = source.indexOf('  function workspacePageHeader(', navStart);
const pageStart = source.indexOf('  function renderWorkspaceOperationalOverview(');
const pageEnd = source.indexOf('  function renderCollectionCard(', pageStart);
const listStart = source.indexOf('  function workspaceListWindow(');
const listEnd = source.indexOf('  function workspacePageHeader(', listStart);
const capabilityStart = source.indexOf('  const COLLECTION_CAPABILITY_BLOCKED =');
const capabilityEnd = source.indexOf('  function createGroupMonitorState(', capabilityStart);
for (const position of [metadataStart, metadataEnd, navStart, navEnd, pageStart, pageEnd, capabilityStart, capabilityEnd]) assert.ok(position > 0);
assert.ok(capabilityEnd > capabilityStart, 'render fixtures load the actual bounded capability implementation and its dependencies');
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const state = { workspaceMode: 'ordinary', activeAccountId: 'a', accounts: [{ id: 'a', workspaceMode: 'ordinary' }], wsWorkspaceView: 'overview', wsWorkspaceNavCollapsed: true, groupCatalog: [{ accountId: 'a', groupJid: 'group-a@g.us', groupName: '<Group A>' }, { accountId: 'b', groupJid: 'group-b@g.us', groupName: 'B' }], groupMonitor: { events: [] }, aiQueueStats: {}, followupAlerts: [] };
const pages = new Map();
const sandbox = { state, esc, text: value => String(value ?? '').trim(), getHost: () => null, displayTime: value => value ? String(value) : '', activeAccount: () => state.accounts[0], accountDisplayName: account => account.id, wsWorkspacePageState: (view = state.wsWorkspaceView) => { const key = state.activeAccountId + ':' + view; if (!pages.has(key)) pages.set(key, { busy: false, error: '', status: '尚未刷新', filter: '', statusFilter: 'all', page: 1 }); return pages.get(key); }, workspacePageHeader: meta => `<h2>${esc(meta.label)}</h2>` };
sandbox.businessPages = require('../../resources/app/modules/ws-business-pages.js');
sandbox.window = { ZhikeWsGroupReading: require('../../resources/app/modules/ws-group-reading-ui.js') };
for (const name of ['renderAccountList', 'renderAccountForm', 'renderGroupMonitorCard', 'renderCollectionCard', 'renderWsFlowStrip', 'renderAnalysis', 'renderDataArchiveSummary', 'renderHotProfile', 'renderFollowupAlerts']) sandbox[name] = () => `<div data-service-projection="${name}"></div>`;
sandbox.activeConversation = () => null;
const aiPanel = source.slice(source.indexOf('  function renderAiAuthorization('), source.indexOf('  async function aiAuthorizationAction('));
const metricPanel = source.slice(source.indexOf('  function summarizeAccountMetrics('), source.indexOf('  function renderAccountList('));
vm.runInNewContext(aiPanel + metricPanel + source.slice(capabilityStart, capabilityEnd) + source.slice(metadataStart, metadataEnd) + source.slice(navStart, navEnd) + source.slice(listStart, listEnd) + source.slice(pageStart, pageEnd) + '\nglobalThis.nav=renderWsWorkspaceNav;globalThis.page=renderWsWorkspacePage;globalThis.listWindow=workspaceListWindow;globalThis.setFilter=applyWorkspaceListFilter;globalThis.groupWindow=groupDirectoryWindow;globalThis.groupControl=applyGroupDirectoryControl;globalThis.capability=collectionCapability;globalThis.blocked=collectionBlockedResult;', sandbox);
const beforeCapability = JSON.stringify(state);
assert.equal(sandbox.capability().backgroundCollection, false);
assert.equal(sandbox.capability().foregroundFallback, false);
assert.equal(sandbox.capability().manualVisibleImport, true);
assert.equal(sandbox.blocked().code, 'COLLECTION_CAPABILITY_BLOCKED');
assert.equal(JSON.stringify(state), beforeCapability, 'rendering the true capability disclosure must not alter account or queue state');
for (const [mode, ids] of Object.entries(modeViews)) {
  state.workspaceMode = mode;
  state.accounts[0].workspaceMode = mode;
  for (const id of ids) {
  state.wsWorkspaceView = id;
  const nav = sandbox.nav();
  assert.match(nav, /后台采集不可用/);
  assert.match(nav, /COLLECTION_CAPABILITY_BLOCKED/,
    'both purposes disclose the actual blocked collection capability');
  assert.deepEqual([...nav.matchAll(/data-ws-workspace-view="([^"]+)"/g)].map(match => match[1]), ids);
  assert.match(nav, new RegExp(`data-ws-workspace-mode="${mode}" aria-pressed="true"`));
  assert.match(nav, mode === 'ordinary' ? /前台聊天/ : /专用登录/);
  assert.match(nav, new RegExp(`data-ws-workspace-view="${id}" aria-current="page"`));
  const page = sandbox.page(id);
  if (id === 'chat') assert.equal(page, '', 'chat keeps the preserved native surface; the home page is independent');
  else {
    assert.match(page, new RegExp(`data-ws-workspace-page="${id}"`));
    if (id.startsWith('group-')) assert.match(page, /BLOCKED/, 'Unverified platform actions remain blocked');
    else { assert.match(page, /data-ws-account-id="a"/); assert.match(page, /aria-busy="false"/); }
  }
  }
  for (const disallowed of Object.values(modeViews).flat().filter(id => !ids.includes(id))) {
    assert.match(sandbox.page(disallowed), /data-ws-workspace-page="overview"/, mode + ' cannot render another purpose route');
  }
}
assert.match(sandbox.page('groups'), /&lt;Group A&gt;/); assert.doesNotMatch(sandbox.page('groups'), /group-b@g.us/);
assert.doesNotMatch(sandbox.page('groups'), /data-ws-group-reading/, 'The real reading module requires an enabled isolated scope.');
const groups = Array.from({ length: 85 }, (_, index) => ({ groupName: 'Group ' + index, groupJid: index + '@g.us', status: index % 2 ? 'active' : 'left' }));
const groupPage = sandbox.wsWorkspacePageState('groups');
assert.equal(sandbox.listWindow(groups, 'groups').rows.length, 40);
groupPage.page = 3; assert.equal(sandbox.listWindow(groups, 'groups').rows.length, 5);
groupPage.filter = 'Group 84'; const filtered = sandbox.listWindow(groups, 'groups'); assert.equal(filtered.matched, 1); assert.equal(filtered.page, 1); assert.equal(filtered.rows[0].groupName, 'Group 84');
groupPage.filter = ''; groupPage.statusFilter = 'active'; assert.equal(sandbox.listWindow(groups, 'groups').matched, 42);
assert.equal(groups.length, 85, 'search and pagination must leave the service snapshot unchanged');
const accountPage = sandbox.wsWorkspacePageState('accounts'); accountPage.filter = '工作号';
const accountRows = sandbox.listWindow([{ id: 'private', displayName: '私人号' }, { id: 'work', displayName: '工作号' }], 'accounts'); assert.equal(accountRows.matched, 1); assert.equal(accountRows.rows[0].id, 'work');
const taskPage = sandbox.wsWorkspacePageState('tasks'); taskPage.filter = '资料';
const taskRows = sandbox.listWindow([{ id: 't1', title: '客户 A', reason: '补齐资料', priority: 'today' }, { id: 't2', title: '客户 B', reason: '确认报名', priority: 'urgent' }], 'tasks'); assert.equal(taskRows.matched, 1); assert.equal(taskRows.rows[0].id, 't1');
state.activeAccountId = 'b'; assert.equal(sandbox.wsWorkspacePageState('groups').filter, '', 'account B must not inherit account A filters'); state.activeAccountId = 'a'; assert.equal(sandbox.wsWorkspacePageState('groups').statusFilter, 'active');
state.wsWorkspaceView = 'groups'; let focusCalls = 0, caret = null, renderCalls = 0;
sandbox.document = { getElementById: id => id === 'wsWorkspaceSearch-groups' ? { focus() { focusCalls++; }, setSelectionRange(start, end) { caret = [start, end]; } } : null };
sandbox.render = () => { renderCalls++; };
groupPage.page = 3;
assert.equal(sandbox.setFilter({ dataset: { wsWorkspaceSearch: 'groups' }, value: 'Group', selectionStart: 5 }), true);
assert.equal(groupPage.page, 1); assert.equal(groupPage.filter, 'Group'); assert.equal(focusCalls, 1); assert.deepEqual(caret, [5, 5]);
assert.equal(sandbox.setFilter({ dataset: { wsWorkspaceSearch: 'accounts' }, value: 'stale', selectionStart: 5 }), false, 'detached old-page search must be ignored');
assert.equal(renderCalls, 1);
assert.match(sandbox.page('invalid-view'), /data-ws-workspace-page="overview"/, 'invalid page falls back to the independent home page');
assert.match(sandbox.page('contacts'), /data-ws-business-form="contacts"/);
assert.match(sandbox.page('contacts'), /<button type="submit" class="btn small">查询<\/button>/, 'the contacts query uses the owned form submit path (click and Enter), not a duplicate click action');
assert.doesNotMatch(sandbox.page('contacts'), /正在开发，尚未接入/, 'the actual directory replaces the retired placeholder');
assert.match(sandbox.page('accounts'), /data-service-projection="renderAccountForm"/, 'adding an account must expose its real form on the accounts page');
assert.match(sandbox.nav(), /data-ws-action="return-zhike"/);
const chatNav = sandbox.nav().match(/<button\b[^>]*data-ws-workspace-view="chat"[^>]*>(.*?)<\/button>/)?.[1] || '';
assert.match(chatNav,
  /<span class="ws-workspace-nav-icon" aria-hidden="true"><svg class="zk-icon" viewBox="0 0 24 24" focusable="false"><use href="#i-chat-stack"\/><\/svg><\/span>/,
  'the front chat route uses the shared chat icon and keeps it hidden from assistive technology and out of the tab order');
state.wsWorkspaceView = 'groups'; groupPage.filter = ''; groupPage.statusFilter = 'all';
state.groupCatalog = [
  { accountId: 'a', groupJid: 'one@g.us', groupName: 'One', participantCount: 7, permissions: '所有成员', collectionStatus: 'completed' },
  { accountId: 'a', groupJid: 'two@g.us', groupName: 'Two', memberCount: 120, sendPermission: '仅管理员', collectionStatus: 'queued' },
  { accountId: 'a', groupJid: 'unknown@g.us', groupName: 'Unknown', participantCount: 0 },
  { accountId: 'b', groupJid: 'private@g.us', groupName: 'Other account', participantCount: 999 },
];
const snapshot = JSON.stringify(state.groupCatalog);
assert.equal(sandbox.groupWindow().allRows.length, 3, 'group filters must remain scoped to the active account');
assert.match(sandbox.page('groups'), /<table class="ws-group-table">/);
assert.match(sandbox.page('groups'), /未提供/);
assert.doesNotMatch(sandbox.page('groups'), /private@g.us/);
assert.equal(sandbox.groupControl({ dataset: { wsGroupFilter: 'memberCount' }, value: 'unknown' }), true);
assert.equal(sandbox.groupWindow().matched, 1); assert.equal(sandbox.groupWindow().rows[0].directoryId, 'unknown@g.us');
sandbox.groupControl({ dataset: { wsGroupFilter: 'memberCount' }, value: '50to199' });
assert.equal(sandbox.groupWindow().rows[0].directoryId, 'two@g.us');
sandbox.groupControl({ dataset: { wsGroupFilter: 'memberCount' }, value: 'all' });
sandbox.groupControl({ dataset: { wsGroupFilter: 'permission' }, value: '所有成员' });
assert.equal(sandbox.groupWindow().matched, 1);
sandbox.groupControl({ dataset: { wsGroupFilter: 'permission' }, value: 'all' });
sandbox.groupControl({ dataset: { wsGroupFilter: 'collection' }, value: 'queued' });
assert.equal(sandbox.groupWindow().rows[0].directoryId, 'two@g.us');
sandbox.groupControl({ dataset: { wsGroupSelectAll: '' }, checked: true });
assert.deepEqual(Array.from(groupPage.selectedGroupIds), ['two@g.us'], 'select-all must only select the current filtered page');
sandbox.groupControl({ dataset: { wsGroupSelect: 'private@g.us' }, checked: true });
assert.equal(groupPage.selectedGroupIds.length, 1, 'a stale other-account checkbox cannot enter the selection');
state.activeAccountId = 'b'; assert.equal(sandbox.groupWindow().selected.size, 0, 'selected groups must not leak between accounts'); state.activeAccountId = 'a';
assert.equal(JSON.stringify(state.groupCatalog), snapshot, 'table filtering and selection must not alter service data');
state.wsWorkspaceView = 'contacts'; assert.equal(sandbox.groupControl({ dataset: { wsGroupSelect: 'one@g.us' }, checked: true }), false);
assert.match(sandbox.nav(), /is-collapsed/); state.wsWorkspaceNavCollapsed = false; assert.doesNotMatch(sandbox.nav(), /class="ws-workspace-nav is-collapsed"/);
assert.match(source, /mountedWorkspacePage\.scrollTop = wsWorkspacePageState\(\)\.scrollTop/);
assert.match(source, /state\.wsWorkspaceView !== 'chat' \|\| style\.display/, 'only the chat page can expose native bounds');
assert.match(source, /const currentHost = currentCenter\?\.querySelector\('#wsBrowserHost'\)/, 'the incremental shell must retain the existing native anchor');
const actionStart = source.indexOf('  async function handleAction('), actionEnd = source.indexOf('  function applyTranslationMode(', actionStart);
assert.ok(actionStart > 0 && actionEnd > actionStart);
vm.runInNewContext(source.slice(actionStart, actionEnd) + '\nglobalThis.action=handleAction;', sandbox);
(async () => {
  state.wsWorkspaceView = 'groups';
  const copied = [], notices = [];
  sandbox.window.zhikeDesktop = { tools: async payload => { copied.push(payload); return { copied: true }; } };
  sandbox.captureContext = () => ({ accountId: state.activeAccountId });
  sandbox.assertContext = context => assert.equal(context.accountId, state.activeAccountId);
  sandbox.toast = message => notices.push(message);
  await sandbox.action('group-directory-copy');
  assert.equal(copied.length, 1); assert.equal(copied[0].action, 'copy'); assert.equal(copied[0].text, 'two@g.us');
  assert.match(notices[0], /1 个群组标识/, 'a native {copied:true} success must be acknowledged');
  sandbox.window.zhikeDesktop.tools = async () => ({ copied: false });
  await assert.rejects(sandbox.action('group-directory-copy'), /复制失败/);
  assert.equal(notices.length, 1, 'failed native copy must not emit a success toast');
  assert.deepEqual(Array.from(groupPage.selectedGroupIds), ['two@g.us'], 'clipboard failure must preserve the selection');
  console.log('stage5 purpose-scoped rendering: ordinary 9 / dedicated 15 routes, forbidden-route fallback, scoped directory, safe clipboard, filters and pagination PASS; native rendering NotTested');
})().catch(error => { console.error(error); process.exitCode = 1; });
