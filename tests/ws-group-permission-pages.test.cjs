'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const moduleUi = require('../resources/app/modules/ws-group-permissions-ui.js');
const scope = { accountId: 'dedicated account', workspaceMode: 'dedicated', view: 'group-permissions', sequence: 1 };
const group = (jid, extra = {}) => ({ accountId: scope.accountId, groupJid: jid, groupName: '同名群', lastSeenAt: '2026-11-20T01:00:00Z', ...extra });
function fixture(groups = [group('one@g.us'), group('two@g.us')]) {
  const f = { scope: { ...scope }, response: { accountId: scope.accountId, groups }, calls: [], logs: [], gate: null, failure: '' };
  f.ui = moduleUi.create({ getScope: () => f.scope, redraw() {}, openLogs: current => f.logs.push(current.accountId),
    request: async (url, current) => { f.calls.push({ url: new URL(url, 'https://zhike.local'), scope: current });
      if (f.gate) await f.gate; if (f.failure) throw Error(f.failure); return f.response; } });
  return f;
}

test('directory GET is explicit, bounded and account-scoped; metadata never proves permission', async () => {
  const f = fixture([group('one@g.us', { isAdmin: true, role: 'admin', permissions: 'everyone', permissionVerifiedAt: '2026-11-20T12:00:00Z',
    status: 'active', monitorTarget: { enabled: true }, data: { admin: true, crmCategory: 'admin-label' } }),
    group('two@g.us', { lastSeenAt: '2026-11-20T03:00:00Z', groupName: '<script>name</script>' })]);
  f.ui.render(); assert.equal(f.calls.length, 0); assert.equal(await f.ui.load(), true);
  const { url } = f.calls[0]; assert.equal(url.pathname, '/api/ws/accounts/dedicated%20account/groups');
  assert.equal(url.searchParams.get('accountId'), scope.accountId); assert.equal(url.searchParams.get('limit'), '1000');
  const html = f.ui.render(); assert.match(html, /最近目录时间：2026-11-20T03:00:00.000Z/);
  assert.match(html, /目录时间不是权限核验时间/); assert.match(html, /真实权限核验时间/);
  assert.doesNotMatch(html, /admin-label|everyone|2026-11-20T12:00:00Z|<script>/);
  assert.match(html, /&lt;script&gt;name&lt;\/script&gt;/);
  assert.match(html, /<td>UNKNOWN<\/td><td>UNKNOWN<\/td><td>UNKNOWN · 尚无可信核验记录<\/td>/);
  for (const label of ['开群不可用', '关群不可用']) assert.match(html, new RegExp('<button[^>]+disabled[^>]+aria-label="' + label + '"'));
  assert.doesNotMatch(html, /data-ws-action="(?:open|close|group-permission-open|group-permission-close)/);
});

test('search, pagination and multiple selection preserve exact identities even for same-name groups', async () => {
  const groups = Array.from({ length: 45 }, (_, i) => group(i + '@g.us'));
  const f = fixture(groups); await f.ui.load();
  assert.equal(f.ui.select('0@g.us', true), true); assert.equal(f.ui.select('同名群', true), false);
  assert.equal(f.ui.select('44@g.us', true), false, 'A stale hidden checkbox cannot select outside the rendered page');
  await f.ui.run('next'); assert.equal(f.ui.select('44@g.us', true), true);
  f.ui.search('44@g.us'); await f.ui.run('preview');
  const preview = f.ui.render().split('data-ws-permission-preview')[1];
  assert.match(preview, /0@g.us/); assert.match(preview, /44@g.us/);
  assert.match(preview, /不会提交权限变更/); assert.equal(f.calls.length, 1);
  await f.ui.run('clear'); await f.ui.run('preview'); assert.doesNotMatch(f.ui.render(), /data-ws-permission-preview/);
});

test('selection remains bounded and refresh removes vanished target IDs', async () => {
  const f = fixture(Array.from({ length: 101 }, (_, i) => group(i + '@g.us'))); await f.ui.load();
  for (let i = 0; i < 101; i++) {
    if (i && i % 40 === 0) await f.ui.run('next');
    assert.equal(f.ui.select(i + '@g.us', true), i < 100);
  }
  assert.match(f.ui.render(), /最多选择 100 个/);
  f.response.groups = [group('1@g.us')]; await f.ui.load(); await f.ui.run('preview');
  const preview = f.ui.render().split('data-ws-permission-preview')[1];
  assert.match(preview, /1@g.us/); assert.doesNotMatch(preview, /99@g.us/);
});

test('foreign accounts, invalid identifiers, duplicate JIDs and oversized responses fail closed', async () => {
  for (const groups of [[group('one@g.us', { accountId: 'foreign' })], [group('not-a-group')],
    [group('one@g.us'), group('one@g.us')], Array.from({ length: 1001 }, (_, i) => group(i + '@g.us'))]) {
    const f = fixture(); await f.ui.load(); f.ui.select('one@g.us', true);
    f.response.groups = groups; assert.equal(await f.ui.load(), false);
    assert.match(f.ui.render(), /role="alert"/); assert.doesNotMatch(f.ui.render(), /data-ws-permission-select=/);
    await f.ui.run('preview'); assert.doesNotMatch(f.ui.render(), /data-ws-permission-preview/);
  }
});

test('account, purpose, page and generation changes discard late directory results', async () => {
  for (const change of [{ accountId: 'other' }, { workspaceMode: 'ordinary' }, { view: 'logs' }, { sequence: 2 }]) {
    const f = fixture(); let finish; f.gate = new Promise(resolve => { finish = resolve; });
    const pending = f.ui.load(); f.scope = { ...scope, ...change }; f.ui.discardStale(); finish();
    assert.equal(await pending, false); assert.doesNotMatch(f.ui.render(), /one@g.us/);
  }
});

test('errors are escaped, logs retain the active account and unknown mutations perform no request', async () => {
  const f = fixture(); f.failure = '<read failed>'; await f.ui.load();
  assert.match(f.ui.render(), /&lt;read failed&gt;/); await f.ui.run('logs'); assert.deepEqual(f.logs, [scope.accountId]);
  const count = f.calls.length;
  for (const action of ['open', 'close', 'set-admin', 'send', 'execute']) assert.equal(await f.ui.run(action), false);
  assert.equal(f.calls.length, count);
  f.scope = { ...scope, workspaceMode: 'ordinary' }; await f.ui.run('logs'); await f.ui.load();
  assert.deepEqual(f.logs, [scope.accountId]); assert.equal(f.calls.length, count);
});

test('mention boundaries describe this adapter and untested devices without asserting universal platform impossibility', () => {
  const html = moduleUi.renderMentions();
  assert.match(html, /B_MODE_BLOCKED_UNSUPPORTED/); assert.match(html, /仅表示本版本适配器/);
  assert.match(html, /不代表所有 WhatsApp 平台绝对不支持/); assert.match(html, /Windows 未测 · Android 未测 · iOS 未测/);
  assert.match(html, /OBA/); assert.match(html, /GROUP_ID、BUSINESS_PHONE_NUMBER_ID/);
  assert.match(html, /正文里的 @ 文本不等于原生提及/); assert.match(html, /不能用普通文本或状态动态的私密提及冒充群提及/);
  assert.equal((html.match(/<button[^>]+disabled/g) || []).length, 2); assert.doesNotMatch(html, /data-ws-action|onclick=/);
});

test('actual workbench wires dedicated local selection, account logs and inert mention page without platform mutations', async () => {
  const app = path.resolve(__dirname, '../resources/app'), requests = [];
  const target = { innerHTML: '', querySelector: () => null }, host = { state: { view: 'ws-workbench', settings: {}, customers: [], activities: [] } };
  const sandbox = { window: { ZhikeWsCore: require(path.join(app, 'modules/ws-workbench-core.js')),
    ZhikeWsBusinessPages: require(path.join(app, 'modules/ws-business-pages.js')), ZhikeWsGroupPermissions: moduleUi,
    __zhikeRegistryHost: host, innerWidth: 1440, innerHeight: 900, location: { origin: 'https://zhike.local' } },
    document: { querySelector: selector => selector === '#viewContainer' ? target : null, querySelectorAll: () => [], getElementById: () => null, addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} }, requestAnimationFrame: () => 0,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, URL, URLSearchParams, AbortController,
    fetch: async (url, init) => {
      assert.equal(init.method || 'GET', 'GET'); const parsed = new URL(url, 'https://zhike.local'); requests.push(parsed);
      assert.equal(parsed.searchParams.get('accountId'), scope.accountId);
      return new Response(JSON.stringify(parsed.pathname.endsWith('/groups') ? { accountId: scope.accountId, groups: [group('one@g.us'), group('two@g.us')] }
        : { accountId: scope.accountId, rows: [], total: 0, page: 1, pageCount: 1 }));
    } };
  const source = fs.readFileSync(path.join(app, 'modules/ws-workbench.js'), 'utf8'), boot = /  boot\(\);\s*\}\)\(\);\s*$/; assert.match(source, boot);
  vm.runInNewContext(source.replace(boot, '  globalThis.fixture={state,render,refreshWorkspacePage,applyControlChange,handleAction};\n})();'), sandbox);
  const f = sandbox.fixture; Object.assign(f.state, { active: true, workspaceMode: 'dedicated', activeAccountId: scope.accountId,
    wsWorkspaceView: 'group-permissions', accounts: [{ id: scope.accountId, workspaceMode: 'dedicated' }, { id: 'ordinary', workspaceMode: 'ordinary' }] });
  f.render(); await f.refreshWorkspacePage(); assert.equal(requests.length, 1); assert.match(target.innerHTML, /实际权限变更 BLOCKED/);
  f.applyControlChange({ matches: selector => selector === '[data-ws-permission-select]', dataset: { wsPermissionSelect: 'one@g.us' }, checked: true });
  await f.handleAction('group-permission-preview'); assert.match(target.innerHTML, /data-ws-permission-preview/); assert.equal(requests.length, 1);
  await f.handleAction('group-permission-open'); assert.equal(requests.length, 1);
  await f.handleAction('group-permission-logs'); assert.equal(f.state.wsWorkspaceView, 'logs');
  assert.equal(requests[1].pathname, '/api/ws/workspace/audit');
  f.state.wsWorkspaceView = 'group-mentions'; f.render(); assert.match(target.innerHTML, /B_MODE_BLOCKED_UNSUPPORTED/);
  Object.assign(f.state, { workspaceMode: 'ordinary', activeAccountId: 'ordinary', wsWorkspaceView: 'group-permissions' });
  await f.handleAction('group-permission-refresh'); assert.equal(requests.length, 2);
  const index = fs.readFileSync(path.join(app, 'index.html'), 'utf8'), server = fs.readFileSync(path.join(app, 'server.mjs'), 'utf8');
  assert.match(index, /ws-group-permissions-ui\.js"><\/script>[\s\S]*ws-workbench\.js/);
  assert.match(server, /'\/modules\/ws-group-permissions-ui\.js'/);
});
