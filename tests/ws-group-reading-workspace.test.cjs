'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const reading = require('../resources/app/modules/ws-group-reading-ui.js');
const base = '/api/ws/group-manager/';
const sentAt = '2026-11-17T10:00:00.000Z';
const scope = { accountId: 'dedicated', groupJid: 'saved@g.us', sequence: 1, view: 'group-reading' };
const rows = [
  { ...scope, messageId: 'first', sentAt, type: 'text', senderJid: '123@lid', fromMe: true, verified: true },
  { ...scope, messageId: '<later>', sentAt: '2026-11-18T12:00:00.000Z', type: 'image', senderJid: '456@lid' },
  { ...scope, accountId: 'foreign', messageId: 'foreign-message', sentAt },
];
function fixture() {
  let currentScope = { ...scope };
  const calls = [], downloads = [];
  const f = { currentScope: value => { currentScope = value; }, report: null, failure: null, gate: null };
  f.ui = reading.create({ getScope: () => currentScope, redraw() {}, download: text => downloads.push(text),
    request: async route => {
      const url = new URL(route, 'https://zhike.local'); calls.push(url);
      if (f.failure) throw new Error(f.failure);
      if (url.pathname.endsWith('/capability')) return { ...scope, localObservation: true };
      if (url.pathname.endsWith('/messages')) return { ...scope, messages: rows };
      if (f.gate) await f.gate;
      const message = { ...scope, messageId: url.searchParams.get('messageId') };
      if (url.pathname.endsWith('/export')) return { ...message, csv: '"unknown"', rowCount: 1 };
      return f.report || { messages: [{ ...message, observedMembers: 1, unknownMembers: 1, mappedObservedMembers: 0 }],
        coverage: { receiptAuthority: 'unavailable' }, total: 1, nextOffset: null,
        rows: [{ ...message, memberId: 'saved-member@lid', status: 'read', source: 'caller-label', verifiedAt: sentAt }] };
    } });
  return Object.assign(f, { calls, downloads });
}

test('history selection is bounded and never labels arbitrary stored messages as verified outbound', async () => {
  const f = fixture(); await f.ui.open();
  assert.deepEqual(f.calls.map(url => url.pathname), [base + 'customer-reading/capability', base + 'messages']);
  assert.equal(f.calls[1].searchParams.get('limit'), '200');
  const html = f.ui.render();
  assert.match(html, /发送归属未核验/); assert.match(html, /可能包含隔离测试数据/);
  assert.match(html, /前 200 条/); assert.match(html, /不代表完整历史/);
  assert.doesNotMatch(html, /foreign-message|已验证己方消息|隔离环境/);
  assert.match(html, /&lt;later&gt;/);
  await f.ui.run('query'); assert.equal(f.calls.length, 2, 'No message means no receipt query');
  f.ui.select('foreign-message'); await f.ui.run('query'); assert.equal(f.calls.length, 2);
});

test('date and identifier/type/sender searches filter only loaded history and revoke stale selection', async () => {
  const f = fixture(); await f.ui.open(); f.ui.select('first'); await f.ui.run('query');
  assert.match(f.ui.render(), /saved-member@lid/);
  f.ui.filter('from', '2026-11-18');
  assert.doesNotMatch(f.ui.render(), /value="first"|saved-member@lid/);
  f.ui.select('first'); await f.ui.run('query'); assert.equal(f.calls.length, 3);
  f.ui.filter('search', '456@lid'); assert.match(f.ui.render(), /value="&lt;later&gt;"/);
  f.ui.filter('to', '2026-11-17'); assert.match(f.ui.render(), /起始日期不能晚于结束日期/);
  assert.doesNotMatch(f.ui.render(), /value="&lt;later&gt;"/);
  f.ui.filter('to', '2026-02-30'); assert.match(f.ui.render(), /value="2026-11-17"/, 'Invalid date is rejected');
  assert.equal(f.calls.length, 3, 'Filtering neither contacts a platform nor creates a reader');
});

test('stored read/delivered claims stay unknown without a per-member server attestation', async () => {
  const f = fixture(); await f.ui.open(); f.ui.select('first'); await f.ui.run('query');
  assert.match(f.ui.render(), /待核实 · unknown/); assert.doesNotMatch(f.ui.render(), /已读（逐人证据已核验）|caller-label/);
  const message = { ...scope, messageId: 'first' };
  f.report = { messages: [{ ...message, observedMembers: 1, unknownMembers: 1, mappedObservedMembers: 0 }],
    coverage: { receiptAuthority: 'external-attestation-required-per-row' }, total: 1, nextOffset: null,
    rows: [{ ...message, memberId: 'saved-member@lid', status: 'delivered', source: 'label', verifiedAt: sentAt, readAt: null }] };
  await f.ui.run('query'); assert.doesNotMatch(f.ui.render(), /已读（逐人证据已核验）/);
  f.report.rows[0].status = 'read'; f.report.rows[0].source = '';
  await f.ui.run('query'); assert.doesNotMatch(f.ui.render(), /已读（逐人证据已核验）/);
});

test('a test-only independent attestation displays its individual source and verification time', async () => {
  // This response exercises the query-module DTO contract. Production does
  // not currently install the independent verifier and cannot return it.
  const f = fixture(), message = { ...scope, messageId: 'first' };
  f.report = { messages: [{ ...message, observedMembers: 1, unknownMembers: 0, mappedObservedMembers: 1 }],
    coverage: { receiptAuthority: 'external-attestation-required-per-row' }, total: 1, nextOffset: null,
    rows: [{ ...message, memberId: '<verified-member>', status: 'read', source: '<test-verifier>', sentAt,
      readAt: '2026-11-17T10:01:00.000Z', verifiedAt: '2026-11-17T10:02:00.000Z' }] };
  await f.ui.open(); f.ui.select('first'); await f.ui.run('query');
  assert.match(f.ui.render(), /已读（逐人证据已核验）/); assert.match(f.ui.render(), /&lt;test-verifier&gt;/);
  assert.match(f.ui.render(), /核验时间 2026-11-17T10:02:00.000Z/);
  f.report.rows[0].readAt = '2026-11-17T10:03:00.000Z'; await f.ui.run('query');
  assert.doesNotMatch(f.ui.render(), /已读（逐人证据已核验）/, 'Inconsistent evidence timestamps cannot become read');
});

test('changing the account, group, page or generation drops a delayed export', async () => {
  for (const changed of [{ accountId: 'other' }, { groupJid: 'other@g.us' }, { view: 'groups' }, { sequence: 2 }]) {
    const f = fixture(); await f.ui.open(); f.ui.select('first'); await f.ui.run('query');
    let finish; f.gate = new Promise(resolve => { finish = resolve; });
    const pending = f.ui.run('export'); f.currentScope({ ...scope, ...changed }); f.ui.discardStale();
    finish(); await pending; assert.deepEqual(f.downloads, []); assert.equal(f.ui.render(), '');
  }
});

test('dedicated history failures are visible and foreign receipt rows are rejected', async () => {
  const f = fixture(); f.failure = '<unavailable>'; await f.ui.open(); assert.match(f.ui.render(), /&lt;unavailable&gt;/);
  f.failure = null; await f.ui.open(); f.ui.select('first');
  f.report = { messages: [{ ...scope, messageId: 'first' }], rows: [{ ...scope, accountId: 'foreign', messageId: 'first', memberId: 'private-member' }] };
  await f.ui.run('query'); assert.match(f.ui.render(), /不属于当前消息/); assert.doesNotMatch(f.ui.render(), /private-member/);
});

test('actual dedicated workbench reading route lists scoped groups and performs GET history queries only', async () => {
  const app = path.resolve(__dirname, '../resources/app'), requests = [];
  const target = { innerHTML: '', querySelector: () => null };
  const host = { state: { view: 'ws-workbench', settings: {}, customers: [], activities: [] } };
  const sandbox = { window: { ZhikeWsCore: require(path.join(app, 'modules/ws-workbench-core.js')),
      ZhikeWsBusinessPages: require(path.join(app, 'modules/ws-business-pages.js')), ZhikeWsGroupReading: reading,
      __zhikeRegistryHost: host, innerWidth: 1440, innerHeight: 900, location: { origin: 'https://zhike.local' } },
    document: { querySelector: selector => selector === '#viewContainer' ? target : null, querySelectorAll: () => [],
      getElementById: () => null, addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} }, requestAnimationFrame: () => 0,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, URL, URLSearchParams, AbortController,
    fetch: async (url, init) => {
      assert.equal(init.method || 'GET', 'GET'); const u = new URL(url, 'https://zhike.local'); requests.push(u);
      assert.equal(u.searchParams.get('accountId'), 'dedicated');
      let response;
      if (u.pathname.endsWith('/groups')) response = { accountId: 'dedicated', groups: [{ ...scope, name: 'Local group' }, { ...scope, accountId: 'foreign', groupJid: 'private@g.us' }] };
      else if (u.pathname.endsWith('/capability')) response = { ...scope, localObservation: true };
      else if (u.pathname.endsWith('/messages')) response = { ...scope, messages: rows };
      else response = { messages: [{ ...scope, messageId: 'first', observedMembers: 0, unknownMembers: 0, mappedObservedMembers: 0 }], rows: [], total: 0, nextOffset: null };
      return new Response(JSON.stringify(response));
    } };
  const source = fs.readFileSync(path.join(app, 'modules/ws-workbench.js'), 'utf8');
  const boot = /  boot\(\);\s*\}\)\(\);\s*$/; assert.match(source, boot);
  vm.runInNewContext(source.replace(boot, '  globalThis.fixture = {state,render,refreshWorkspacePage,applyControlChange,handleAction};\n})();'), sandbox);
  const f = sandbox.fixture;
  Object.assign(f.state, { active: true, activeAccountId: 'dedicated', workspaceMode: 'dedicated', wsWorkspaceView: 'group-reading',
    accounts: [{ id: 'dedicated', workspaceMode: 'dedicated' }, { id: 'ordinary', workspaceMode: 'ordinary' }] });
  f.render(); assert.match(target.innerHTML, /真实回执采集 BLOCKED/); assert.match(target.innerHTML, /没有可核验的本账号出站消息来源/);
  await f.refreshWorkspacePage(); assert.equal(requests.length, 1); assert.doesNotMatch(target.innerHTML, /private@g.us/);
  const control = (selector, value) => ({ matches: candidate => candidate === selector, value });
  await f.applyControlChange(control('[data-ws-reading-group]', 'saved@g.us'));
  assert.match(target.innerHTML, /发送归属未核验/); assert.equal(requests.length, 3);
  f.applyControlChange(control('[data-ws-group-reading-message]', 'first')); await f.handleAction('group-reading-query');
  assert.equal(requests.length, 4); assert.match(target.innerHTML, /没有可展示的成员记录/);
  await f.applyControlChange(control('[data-ws-reading-group]', 'private@g.us')); assert.equal(requests.length, 4);
  Object.assign(f.state, { workspaceMode: 'ordinary', activeAccountId: 'ordinary' });
  await f.refreshWorkspacePage(); await f.applyControlChange(control('[data-ws-reading-group]', 'saved@g.us')); await f.handleAction('group-reading-query');
  assert.equal(requests.length, 4, 'Ordinary purpose cannot execute a forged dedicated reading selection');
});
