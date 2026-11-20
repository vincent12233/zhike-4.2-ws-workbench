'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const repo = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(repo, 'resources/app/modules/ws-workbench.js'), 'utf8');
const core = require(path.join(repo, 'resources/app/modules/ws-workbench-core.js'));
const boot = /  boot\(\);\s*\}\)\(\);\s*$/;
assert.match(source, boot);
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function fixture(options = {}) {
  const calls = [], requests = [], storage = new Map(Object.entries(options.storage || {}));
  const events = {};
  const target = { innerHTML: '', addEventListener(type, handler) { events[type] = handler; } }, crumb = { textContent: '' };
  const browserHost = { getBoundingClientRect: () => ({ left: 270, top: 190, width: 780, height: 480 }) };
  const classList = { add() {}, remove() {}, toggle() {} };
  const host = { state: { view: 'home', settings: {}, customers: [], activities: [] }, toast() {} };
  const context = {
    document: { querySelector: selector => selector === '#viewContainer' ? target : selector === '#crumbCurrent' ? crumb
      : selector === '#wsBrowserHost' && target.innerHTML.includes('id="wsBrowserHost"') ? browserHost : null,
      querySelectorAll: () => [], getElementById: () => null, addEventListener() {}, activeElement: null,
      documentElement: { dataset: {} }, body: { classList } },
    window: { ZhikeWsCore: core, __zhikeRegistryHost: host, innerWidth: 1440, innerHeight: 900, location: { origin: 'http://localhost' }, addEventListener() {},
      zhikeDesktop: { wsAccounts: async payload => { calls.push(['accounts', payload]); return options.accounts ? options.accounts(payload) : { accounts: options.rows || [] }; },
        ws: async payload => { calls.push(['ws', payload]); return options.ws ? options.ws(payload) : { accountId: payload.accountId, status: '未连接' }; } } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }), MutationObserver: class { observe() {} },
    URL, URLSearchParams, AbortController, DOMException, console, confirm: () => true,
    fetch: async (url, init) => { requests.push([url, init]); const result = await options.request?.(url, init); return { ok: true, json: async () => result || {} }; },
  };
  vm.createContext(context);
  vm.runInContext(source.replace(boot, `  globalThis.ui = { boot, state, activate, deactivate, loadAccounts, switchAccount, createAccount, createWsAccountRecord, ensureWsBackupAccount, connectionAction, syncConversationListPreviews, rememberCollectionCapability, api, wsBridge, render, renderWsWorkspaceNav, renderWsWorkspacePage, refreshWorkspacePage, handleAction, readStoredAccountId, writeStoredAccountId, writeWsWorkspaceState, readWsWorkspaceView, normalizeWorkspaceMode, workspaceViews, resetAccountPresentation, getStartup: () => backgroundStartPromise };\n})();`), context);
  if (options.bindEvents) context.ui.boot();
  return { ...context.ui, context, host, calls, requests, storage, target, events };
}
test('main navigation exposes exactly two WS business entrances and retains CRM VIP', () => {
  const html = fs.readFileSync(path.join(repo, 'resources/app/index.html'), 'utf8');
  const entries = [...html.matchAll(/<button[^>]*data-view="ws-workbench"[^>]*>/g)].map(match => match[0]);
  assert.equal(entries.length, 2);
  assert.ok(entries.some(entry => entry.includes('data-ws-workspace-mode="ordinary"')));
  assert.ok(entries.some(entry => entry.includes('data-ws-workspace-mode="dedicated"')));
  assert.match(html, /data-view="vip"/);
});
test('legacy accounts are ordinary; explicit invalid modes belong to neither workspace', async () => {
  const f = fixture({ rows: [{ id: 'default' }, { id: 'd', workspaceMode: 'dedicated' }, { id: 'bad', workspaceMode: 'VIP' }, { id: 'null', workspaceMode: null }] });
  await f.loadAccounts(); assert.deepEqual(Array.from(f.state.accounts, row => row.id), ['default']);
  f.state.workspaceMode = 'dedicated'; f.resetAccountPresentation(''); await f.loadAccounts();
  assert.deepEqual(Array.from(f.state.accounts, row => row.id), ['d']);
  assert.equal(f.state.activeAccountId, 'd');
  assert.throws(() => f.activate('VIP'), /用途无效/);
});
test('empty dedicated activation neither opens nor probes default, nor loads account data', async () => {
  const f = fixture({ rows: [{ id: 'default' }], storage: { 'zhike.ws.activeAccountId': 'default' } });
  f.activate('dedicated'); await f.getStartup();
  assert.equal(f.state.activeAccountId, ''); assert.equal(f.state.accounts.length, 0);
  assert.equal(f.calls.filter(([kind]) => kind === 'ws').length, 0);
  assert.equal(f.requests.length, 0); assert.match(f.target.innerHTML, /当前用途暂无可用账号/);
  assert.doesNotMatch(f.target.innerHTML, /id="wsBrowserHost"/);
  await assert.rejects(f.wsBridge('open'), /请先添加/);
  await assert.rejects(f.api('/api/ws/conversations'), /请先添加/);
  assert.equal(f.calls.filter(([kind]) => kind === 'ws').length, 0);
});
test('account and view preferences are independent; legacy preference only migrates to ordinary', () => {
  const f = fixture({ storage: { 'zhike.ws.activeAccountId': 'old', 'zhike.ws.workspace-view': 'chat' } });
  assert.equal(f.readStoredAccountId('ordinary'), 'old'); assert.equal(f.readStoredAccountId('dedicated'), '');
  f.writeStoredAccountId('o2'); f.writeWsWorkspaceState('ai', false);
  f.state.workspaceMode = 'dedicated'; f.writeStoredAccountId('d2'); f.writeWsWorkspaceState('groups', false);
  assert.equal(f.readStoredAccountId('ordinary'), 'o2'); assert.equal(f.readStoredAccountId('dedicated'), 'd2');
  assert.equal(f.readWsWorkspaceView('ordinary'), 'ai'); assert.equal(f.readWsWorkspaceView('dedicated'), 'groups');
});
test('selection refuses accounts from the other mode, empty IDs, and an unknown mode', async () => {
  const f = fixture(); f.state.accounts = [{ id: 'default' }, { id: 'd', workspaceMode: 'dedicated' }, { id: 'bad', workspaceMode: 'future' }];
  f.state.workspaceMode = 'dedicated'; f.state.activeAccountId = '';
  assert.equal(await f.switchAccount('default'), false); assert.equal(await f.switchAccount('bad'), false); assert.equal(await f.switchAccount(''), false);
  assert.equal(f.calls.length, 0);
});
test('late account list from the old workspace cannot replace the current selection', async () => {
  const gate = deferred(); let count = 0;
  const f = fixture({ accounts: () => ++count === 1 ? gate.promise : { accounts: [{ id: 'd', workspaceMode: 'dedicated' }] } });
  const ordinary = f.loadAccounts(); f.state.workspaceMode = 'dedicated'; f.resetAccountPresentation(''); await f.loadAccounts();
  gate.resolve({ accounts: [{ id: 'default' }] }); await ordinary;
  assert.equal(f.state.activeAccountId, 'd'); assert.deepEqual(Array.from(f.state.accounts, row => row.id), ['d']);
  assert.ok(f.calls.filter(([kind]) => kind === 'ws').every(([, payload]) => payload.accountId === 'd'));
});
test('dedicated navigation exposes blocked group features and never ordinary direct broadcast', async () => {
  const f = fixture(); f.state.workspaceMode = 'dedicated';
  const nav = f.renderWsWorkspaceNav(); assert.match(nav, /专用登录/); assert.match(nav, /data-ws-workspace-view="exclusions"/);
  assert.doesNotMatch(nav, /data-ws-workspace-view="ai"|data-ws-workspace-view="tasks"/);
  for (const view of ['group-broadcast', 'group-mentions', 'group-reading', 'group-permissions']) {
    f.state.wsWorkspaceView = view; assert.match(f.renderWsWorkspacePage(view), /BLOCKED/); await f.refreshWorkspacePage();
  }
  assert.equal(f.calls.length, 0); assert.equal(f.requests.length, 0);
  for (const action of ['create-broadcast-plan', 'send-broadcast-item', 'broadcast-select-all']) await assert.rejects(f.handleAction(action, {}), /BLOCKED/);
  assert.doesNotMatch(f.renderWsWorkspacePage('settings'), /data-assist-target="broadcast"/);
  f.state.workspaceMode = 'ordinary'; const ordinary = f.renderWsWorkspaceNav();
  assert.match(ordinary, /data-ws-workspace-view="ai"/); assert.match(ordinary, /data-ws-workspace-view="tasks"/);
  assert.doesNotMatch(ordinary, /data-ws-workspace-view="groups"|data-ws-workspace-view="group-broadcast"/);
});
test('create propagates mode and rejects a bridge response belonging to another mode', async () => {
  const f = fixture({ accounts: payload => ({ account: { ...payload.account } }) });
  const created = await f.createWsAccountRecord({ id: 'd', workspaceMode: 'dedicated' }); assert.equal(created.workspaceMode, 'dedicated');
  assert.equal(f.calls[0][1].account.workspaceMode, 'dedicated');
  const conflict = fixture({ accounts: () => ({ account: { id: 'd', workspaceMode: 'ordinary' } }) });
  await assert.rejects(conflict.createWsAccountRecord({ id: 'd', workspaceMode: 'dedicated' }), /用途不匹配/);
  assert.equal(conflict.requests.length, 0);
});
test('fallback POST and GET readback both reject existing account mode conflicts', async () => {
  for (const failPost of [false, true]) {
    const f = fixture({ accounts: () => { throw new Error('bridge unavailable'); }, request: (url, init) => {
      if (init.method === 'POST') { if (failPost) throw new Error('conflict'); return { account: { id: 'd', workspaceMode: 'ordinary' } }; }
      return { accounts: [{ id: 'd', workspaceMode: 'ordinary' }] };
    } });
    await assert.rejects(f.createWsAccountRecord({ id: 'd', workspaceMode: 'dedicated' }), /用途不匹配/);
  }
});
test('account creation in a departed workspace cannot select its account after returning', async () => {
  const gate = deferred(); let createdPayload;
  const f = fixture({ accounts: payload => {
    if (payload.action === 'create') { createdPayload = payload.account; return gate.promise; }
    return { accounts: [{ id: 'default' }] };
  } });
  f.state.workspaceMode = 'dedicated'; f.state.accountFormName = 'Dedicated test';
  const creating = f.createAccount();
  await Promise.resolve();
  assert.equal(createdPayload.workspaceMode, 'dedicated');
  f.activate('ordinary'); f.activate('dedicated'); await f.getStartup();
  f.state.accountBusy = true; f.state.accountFormName = 'New form';
  gate.resolve({ account: createdPayload }); await creating;
  assert.equal(f.state.activeAccountId, ''); assert.equal(f.state.accountBusy, true); assert.equal(f.state.accountFormName, 'New form');
  assert.ok(f.calls.filter(([kind]) => kind === 'ws').every(([, payload]) => payload.action !== 'open'));
});
test('empty workspace refresh is wired to list accounts and does not call platform actions', async () => {
  const f = fixture({ rows: [{ id: 'default' }] }); f.state.workspaceMode = 'dedicated';
  await f.handleAction('refresh-accounts', {});
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], 'accounts'); assert.equal(f.state.activeAccountId, '');
});
test('dedicated first-run controls reach creation and open the new account with a visible QR host', async () => {
  const rows = [{ id: 'default' }];
  const f = fixture({ bindEvents: true, accounts: payload => {
    if (payload.action === 'create') { rows.push(payload.account); return { account: payload.account }; }
    return { accounts: rows };
  } });
  f.activate('dedicated'); await f.getStartup();
  const click = action => {
    assert.ok(f.target.innerHTML.includes('data-ws-action="' + action + '"'));
    const shell = { dataset: { wsWorkspaceMode: 'dedicated' } };
    const button = { dataset: { wsAction: action }, closest: selector =>
      selector === '[data-ws-action]' ? button : selector === '[data-ws-workspace-mode]' ? shell : null };
    f.events.click({ target: button, preventDefault() {}, stopImmediatePropagation() {} });
  };
  click('create-account');
  assert.ok(f.state.accountFormOpen);
  const input = { value: 'First dedicated', matches: selector => selector === '#wsAccountDisplayName', closest: () => true };
  f.events.input({ target: input });
  click('submit-account');
  await new Promise(resolve => setImmediate(resolve));
  const opens = f.calls.filter(([kind, payload]) => kind === 'ws' && payload.action === 'open').map(([, payload]) => payload);
  assert.equal(opens.length, 1); assert.equal(opens[0].accountId, rows[1].id);
  assert.equal(opens[0].bounds.hidden, false); assert.ok(opens[0].bounds.width > 0);
  assert.equal(f.state.wsWorkspaceView, 'chat'); assert.equal(f.readWsWorkspaceView('dedicated'), 'chat');
  assert.match(f.target.innerHTML, /First dedicated · 前台登录/);
});
test('dedicated navigation opens the selected foreground profile on entry and after hide', async () => {
  const f = fixture({ bindEvents: true, rows: [{ id: 'default' }, { id: 'd', workspaceMode: 'dedicated' }] });
  f.activate('dedicated'); await f.getStartup();
  const opens = () => f.calls.filter(([kind, p]) => kind === 'ws' && p.action === 'open').map(([, p]) => p);
  assert.equal(opens().length, 0);
  const enter = { dataset: { wsWorkspaceView: 'chat' }, closest: selector => selector === '[data-ws-workspace-view]' ? enter : null };
  f.events.click({ target: enter, preventDefault() {}, stopImmediatePropagation() {} });
  await new Promise(resolve => setImmediate(resolve));
  f.deactivate(); f.activate('dedicated'); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(opens().map(p => [p.accountId, p.bounds.hidden]), [['d', false], ['d', false]]);
});
test('opening failure preserves the newly registered dedicated account and its retry opens the same profile', async () => {
  let failed = true, created = 0;
  const f = fixture({ accounts: p => {
    if (p.action === 'create') { created++; return { account: p.account }; }
    return { accounts: [] };
  },
    ws: p => ({ accountId: p.accountId, status: failed ? '连接失败' : '等待登录', detail: failed ? 'WebView2 测试失败' : '请扫码' }) });
  f.activate('dedicated'); await f.getStartup();
  f.state.accountFormName = 'Retry';
  await f.createAccount();
  const id = f.state.accounts[0].id;
  assert.equal(f.state.activeAccountId, id); assert.equal(f.readStoredAccountId('dedicated'), id);
  assert.match(f.target.innerHTML, /WebView2 测试失败/); assert.match(f.target.innerHTML, /重试打开 WS/);
  await f.connectionAction('open'); assert.equal(f.state.wsStatus, '连接失败');
  failed = false; await f.connectionAction('open');
  assert.equal(f.state.wsStatus, '等待登录'); assert.equal(f.state.error, ''); assert.equal(created, 1);
  const opens = f.calls.filter(([kind, p]) => kind === 'ws' && p.action === 'open');
  assert.equal(opens.length, 3); assert.ok(opens.every(([, p]) => p.accountId === id && !p.bounds.hidden));
});
test('selecting a second dedicated account opens its own visible foreground and identifies the separate collector', async () => {
  const rows = ['first', 'second'].map(id => ({ id, displayName: id, workspaceMode: 'dedicated' }));
  const capability = { state: 'available', code: 'COLLECTION_INDEPENDENT_SESSION', provider: 'native-independent-session', protocolVersion: 1,
    backgroundCollection: true, automaticHistory: true, groupMonitoring: true, automaticAi: false, foregroundFallback: false, manualVisibleImport: true, collectorState: 'awaiting-login' };
  const f = fixture({ rows, ws: p => {
    if (p.action === 'configure-ws-groups') throw new Error('Synthetic collector unavailable');
    const reply = { accountId: p.accountId, status: '已连接', collectionCapability: capability };
    if (['open-collector', 'hide-collector'].includes(p.action)) reply.loginVisible = p.action === 'open-collector';
    return reply;
  } });
  f.activate('dedicated'); await f.getStartup(); f.state.wsWorkspaceView = 'accounts';
  await f.handleAction('switch-account', { dataset: { accountId: 'second' } });
  assert.equal(f.state.wsWorkspaceView, 'chat'); assert.equal(f.state.activeAccountId, 'second');
  const open = f.calls.find(([kind, p]) => kind === 'ws' && p.action === 'open')[1];
  assert.equal(open.accountId, 'second'); assert.equal(open.bounds.hidden, false);
  await f.handleAction('open-collector', {}); assert.match(f.target.innerHTML, /second · 独立采集会话/);
  await f.handleAction('hide-collector', {}); assert.match(f.target.innerHTML, /second · 前台登录/);
  await f.connectionAction('open'); assert.equal(f.state.wsStatus, '已连接'); assert.equal(f.state.error, '');
});
test('old backup without mode preserves existing dedicated role; explicit conflicts and unknown values fail', async () => {
  const f = fixture({ request: () => ({ accounts: [{ id: 'd', workspaceMode: 'dedicated' }] }) });
  const old = await f.ensureWsBackupAccount('d', 'old name'); assert.equal(old.workspaceMode, 'dedicated'); assert.equal(old.created, false);
  await assert.rejects(f.ensureWsBackupAccount('d', 'old name', 'ordinary'), /用途与本机账号不一致/);
  await assert.rejects(f.ensureWsBackupAccount('d', 'old name', 'future'), /用途无效/);
  assert.ok(f.requests.every(([, init]) => !init.method));
});
test('new legacy backup accounts default ordinary, dedicated backups retain mode on creation', async () => {
  for (const mode of [undefined, 'dedicated']) {
    const f = fixture({ request: (url, init) => init.method === 'POST' ? { account: JSON.parse(init.body) } : { accounts: [] } });
    const result = await f.ensureWsBackupAccount('restored', 'Restore', mode);
    assert.equal(result.created, true); assert.equal(result.workspaceMode, mode || 'ordinary');
    assert.equal(JSON.parse(f.requests.find(([, init]) => init.method === 'POST')[1].body).workspaceMode, mode || 'ordinary');
  }
});
test('backup restore rejects a case-only account ID conflict before writing', async () => {
  const f = fixture({ request: () => ({ accounts: [{ id: 'Original', workspaceMode: 'dedicated' }] }) });
  await assert.rejects(f.ensureWsBackupAccount('original', 'Restore', 'dedicated'), /大小写/);
  assert.ok(f.requests.every(([, init]) => !init.method));
});
test('app restore uses embedded account mode from native backups and rejects conflicting metadata', async () => {
  const app = fs.readFileSync(path.join(repo, 'resources/app/app.js'), 'utf8');
  const start = app.indexOf('  function prepareBackupWsAccounts('), end = app.indexOf('  async function restoreBackupFile(', start);
  const prepare = vm.runInNewContext(app.slice(start, end) + '\nprepareBackupWsAccounts;');
  const data = { accounts: [{ id: 'dedicated', workspaceMode: 'dedicated' }] };
  const backup = { wsAccounts: { dedicated: data }, wsAccountMetadata: [{ id: 'dedicated', displayName: 'Old native metadata' }] };
  const rows = prepare(backup);
  assert.deepEqual(Array.from(rows, row=>[row.accountId,row.accounts[0].workspaceMode,row.accounts[0].displayName]), [['dedicated','dedicated','Old native metadata']]);
  backup.wsAccountMetadata[0].workspaceMode = 'ordinary';
  assert.throws(() => prepare(backup), /两处账号用途不一致/);
  delete backup.wsAccountMetadata[0].workspaceMode; data.accounts[0].id = 'DEDICATED';
  assert.throws(() => prepare(backup), /元数据与账号编号不一致/);
});
test('all-account restore and export keep explicit account scope even in an empty dedicated workspace', async () => {
  const f = fixture(); f.state.workspaceMode = 'dedicated'; f.state.activeAccountId = '';
  await f.context.window.__zhikeWsBackup.importData({ schemaVersion: 6, accountId: 'ordinary-target' }, 'ordinary-target');
  assert.equal(JSON.parse(f.requests[0][1].body).accountId, 'ordinary-target');
  assert.match(f.requests[0][0], /accountId=ordinary-target/);
  await f.context.window.__zhikeWsBackup.exportData('ordinary-target'); assert.match(f.requests[1][0], /accountId=ordinary-target/);
});
test('late ordinary close or clear cannot stop the new dedicated runtime or release its connection lock', async () => {
  for (const action of ['close', 'clear-session']) {
    const gate = deferred();
    const f = fixture({ rows: [{ id: 'default' }], ws: payload => payload.action === action ? gate.promise : { accountId: payload.accountId, status: '未连接' } });
    await f.loadAccounts(); f.state.backgroundActive = true;
    const pending = f.connectionAction(action);
    assert.equal(f.state.backgroundActive, false, 'explicit close stops its current runtime before native resolves');
    f.activate('dedicated'); await f.getStartup();
    f.state.wsStatus = 'dedicated state'; f.state.busy.connection = true;
    const sequence = f.state.accountLoadSequence, requests = f.requests.length;
    gate.resolve({ accountId: 'default', status: 'closed old ordinary' }); await pending;
    assert.equal(f.state.backgroundActive, true); assert.equal(f.state.wsStatus, 'dedicated state');
    assert.equal(f.state.busy.connection, true); assert.equal(f.state.accountLoadSequence, sequence); assert.equal(f.requests.length, requests);
  }
});
test('late ordinary group configuration cannot overwrite dedicated status or load its conversations', async () => {
  const gate = deferred(), configured = deferred();
  const f = fixture({ rows: [{ id: 'default' }], ws: payload => {
    if (payload.action === 'configure-ws-groups') { configured.resolve(); return gate.promise; }
    return { accountId: payload.accountId, status: '已连接' };
  } });
  await f.loadAccounts();
  f.rememberCollectionCapability({ accountId: 'default', collectionCapability: { state: 'available', code: 'COLLECTION_INDEPENDENT_SESSION', provider: 'native-independent-session', protocolVersion: 1,
    backgroundCollection: true, automaticHistory: true, groupMonitoring: true, automaticAi: false, foregroundFallback: false, manualVisibleImport: true, collectorState: 'running' } }, 'default');
  const pending = f.connectionAction('login'); await configured.promise;
  f.activate('dedicated'); await f.getStartup();
  f.state.wsStatus = 'dedicated state'; f.state.busy.connection = true;
  const sequence = f.state.accountLoadSequence, requests = f.requests.length;
  gate.resolve({ accountId: 'default', status: '已连接' }); await pending;
  assert.equal(f.state.backgroundActive, true); assert.equal(f.state.wsStatus, 'dedicated state'); assert.equal(f.state.busy.connection, true);
  assert.equal(f.state.accountLoadSequence, sequence); assert.equal(f.requests.length, requests);
});
test('old list progress cannot PATCH a new mode run or overwrite its state and busy flag', async () => {
  for (const pause of ['items', 'run']) {
    const gate = deferred(), reached = deferred();
    const f = fixture({ rows: [{ id: 'default' }], request: (url, init) => {
      const endpoint = new URL(url, 'http://localhost').pathname;
      if ((pause === 'items' && endpoint === '/api/ws/collection-items' && !init.method)
          || (pause === 'run' && endpoint === '/api/ws/collection-runs' && init.method === 'PATCH')) { reached.resolve(); return gate.promise; }
      return { items: [] };
    } });
    await f.loadAccounts(); f.state.collectionRun = { id: 'ordinary-run' };
    f.state.conversations = [{ id: 'conversation', accountId: 'default', externalId: '919876543210@c.us', conversationType: 'direct', lastMessageText: 'hello' }];
    const pending = f.syncConversationListPreviews([{ accountId: 'default', externalId: '919876543210@c.us', conversationType: 'direct', preview: 'hello', lastMessageText: 'hello' }]);
    const rejected = assert.rejects(pending, /账号已切换/);
    await reached.promise; f.activate('dedicated'); await f.getStartup();
    f.state.collectionRun = { id: 'dedicated-run' }; f.state.listSyncBusy = true;
    gate.resolve(pause === 'items' ? { items: [] } : { run: { id: 'ordinary-run' } }); await rejected;
    assert.equal(f.state.collectionRun.id, 'dedicated-run'); assert.equal(f.state.listSyncBusy, true);
    const patches = f.requests.filter(([url, init]) => url.startsWith('/api/ws/collection-runs') && init.method === 'PATCH');
    assert.equal(patches.length, pause === 'items' ? 0 : 1);
    assert.ok(patches.every(([, init]) => JSON.parse(init.body).id === 'ordinary-run'));
  }
});
test('same-account list reload invalidates stale responses without stranding their owned busy locks', async () => {
  const nativeGate = deferred();
  const connected = fixture({ rows: [{ id: 'default' }], ws: payload => payload.action === 'login' ? nativeGate.promise : { accountId: payload.accountId, status: '未连接' } });
  await connected.loadAccounts(); const login = connected.connectionAction('login');
  await connected.loadAccounts(); connected.state.wsStatus = 'current status';
  nativeGate.resolve({ accountId: 'default', status: 'stale status' }); await login;
  assert.equal(connected.state.busy.connection, false); assert.equal(connected.state.wsStatus, 'current status');

  const runGate = deferred(), reached = deferred();
  const f = fixture({ rows: [{ id: 'default' }], request: (url, init) => {
    if (url.startsWith('/api/ws/collection-runs') && init.method === 'PATCH') { reached.resolve(); return runGate.promise; }
    return { items: [] };
  } });
  await f.loadAccounts(); f.state.collectionRun = { id: 'ordinary-run' };
  f.state.conversations = [{ id: 'conversation', accountId: 'default', externalId: '919876543210@c.us', conversationType: 'direct', lastMessageText: 'hello' }];
  const pending = f.syncConversationListPreviews([{ accountId: 'default', externalId: '919876543210@c.us', conversationType: 'direct', lastMessageText: 'hello' }]);
  const rejected = assert.rejects(pending, /账号已切换/); await reached.promise;
  await f.loadAccounts(); f.state.collectionRun = { id: 'current-run' };
  runGate.resolve({ run: { id: 'stale-run' } }); await rejected;
  assert.equal(f.state.collectionRun.id, 'current-run'); assert.equal(f.state.listSyncBusy, false);
});
