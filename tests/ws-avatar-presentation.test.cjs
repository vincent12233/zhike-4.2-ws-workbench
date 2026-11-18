'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const core = require('../resources/app/modules/ws-workbench-core.js');

const modules = path.join(__dirname, '../resources/app/modules');
const readModule = name => fs.readFileSync(path.join(modules, name), 'utf8');
const workbenchSource = readModule('ws-workbench.js');
const businessSource = readModule('ws-business-pages.js');
const boot = /  boot\(\);\s*\}\)\(\);\s*$/;
const imageUrl = 'https://untrusted.invalid/avatar?id=private';
const unexpectedMedia = {
  avatar: imageUrl,
  avatarUrl: imageUrl,
  profileAvatar: 'data:image/png;base64,ignored',
  image: 'data:image/svg+xml,<svg onload="alert(1)"/>',
};

function fixture() {
  const calls = [];
  const host = { state: { customers: [] } };
  const window = {
    ZhikeWsCore: core,
    __zhikeRegistryHost: host,
    ZhikeAvatar: {
      render(options) {
        calls.push({ ...options });
        return `<span data-test-avatar="${options.name ? 'initial' : 'default'}"></span>`;
      },
    },
  };
  const sandbox = vm.createContext({
    window, URL, URLSearchParams, clearTimeout,
    document: { addEventListener() {} },
    fetch() { assert.fail('Avatar rendering must not request any data'); },
    localStorage: { getItem: () => null, setItem: () => {} },
  });
  vm.runInContext(businessSource, sandbox);
  assert.match(workbenchSource, boot);
  vm.runInContext(workbenchSource.replace(boot, `
    globalThis.fixture = { state, resetAccountPresentation, wsWorkspacePageState,
      renderConversationList, renderDataArchiveSummary, renderWorkspaceMembers,
      renderWorkspaceCustomers, renderWorkspaceReadDirectory };
  })();`), sandbox);
  sandbox.fixture.resetAccountPresentation('a');
  return { ...sandbox.fixture, business: window.ZhikeWsBusinessPages, calls, host };
}

function assertFallbackOnly(html, calls) {
  assert.doesNotMatch(html, /<img\b|https?:\/\/untrusted\.invalid|data:image|refresh-avatar/);
  assert.ok(calls.length > 0);
  for (const options of calls) {
    assert.deepEqual(Object.keys(options).sort(), ['name', 'selected', 'size', 'vip']);
  }
}

test('contact details keep only scoped names and reject mixed-account directory responses', () => {
  const f = fixture();
  const page = f.wsWorkspacePageState('contacts');
  const directory = f.business.directoryState(page);
  const contact = { accountId: 'a', id: 'c', externalId: 'opaque@lid', name: 'தமிழ்', ...unexpectedMedia };
  const unnamed = { ...contact, id: 'empty', name: '未提供' };
  const result = { accountId: 'a', rows: [contact, unnamed], total: 2 };
  assert.throws(() => f.business.acceptDirectoryResult(directory, { ...result, rows: [contact, { ...contact, accountId: 'b' }] }, 'a'), /账号作用域不符/);
  assert.throws(() => f.business.acceptDirectoryResult(directory, { rows: [], total: 0 }, ''), /账号作用域不符/);
  f.business.acceptDirectoryResult(directory, result, 'a');
  page.detailId = contact.id;
  const html = f.renderWorkspaceReadDirectory('contacts');
  assert.match(html, /data-ws-avatar-capability="blocked"/);
  assert.deepEqual(f.calls.map(({ name, size, selected }) => [name, size, selected]), [
    ['தமிழ்', 'table', true], ['', 'table', false], ['தமிழ்', 'detail', true],
  ]);
  assertFallbackOnly(html, f.calls);
  f.resetAccountPresentation('b');
  assert.doesNotMatch(f.renderWorkspaceReadDirectory('contacts'), /தமிழ்|data-test-avatar/);
});

test('a late contact response cannot populate the newly active account', async () => {
  const f = fixture();
  const page = f.wsWorkspacePageState('contacts');
  let resolve;
  const response = new Promise(fulfill => { resolve = fulfill; });
  const loading = f.business.loadDirectory({
    view: 'contacts', page, accountId: 'a',
    request(query) {
      assert.match(query, /accountId=a/);
      return response;
    },
    isCurrent: () => f.state.activeAccountId === 'a',
  });
  f.resetAccountPresentation('b');
  resolve({ accountId: 'a', rows: [{ accountId: 'a', id: 'old', name: 'Old contact' }], total: 1 });
  assert.equal(await loading, false);
  assert.doesNotMatch(f.renderWorkspaceReadDirectory('contacts'), /Old contact|data-test-avatar/);
});

test('member portraits use current account roster names and neutral historical fallbacks', () => {
  const f = fixture();
  const member = { accountId: 'a', groupJid: 'room@g.us', memberJid: 'opaque@lid', displayName: 'किरण', ...unexpectedMedia };
  f.state.groupMembers = { accountId: 'a', rows: [member, { ...member, accountId: 'b', displayName: 'Other account' }] };
  f.state.groupMonitor.events = [
    { ...member, memberJid: 'saved@lid' },
    { ...member, accountId: 'b', memberJid: 'foreign@lid' },
  ];
  f.wsWorkspacePageState('members').detailId = `${member.groupJid}|${member.memberJid}`;
  const html = f.renderWorkspaceMembers();
  assert.match(html, /किरण/);
  assert.match(html, /saved@lid/);
  assert.doesNotMatch(html, /Other account|foreign@lid/);
  assert.deepEqual(f.calls.map(({ name, size }) => [name, size]), [
    ['किरण', 'table'], ['किरण', 'detail'], ['', 'xs'],
  ]);
  assertFallbackOnly(html, f.calls);
});

test('direct sessions get person fallbacks, groups get a group glyph, and ambiguous sessions stay neutral', () => {
  const f = fixture();
  f.state.currentConversationId = 'known';
  f.state.conversations = [
    { id: 'known', accountId: 'a', externalId: 'known@lid', title: 'Renée', ...unexpectedMedia, data: unexpectedMedia },
    { id: 'unnamed', accountId: 'a', externalId: 'opaque@lid', title: 'opaque@lid' },
    { id: 'group', accountId: 'a', externalId: 'group@g.us', title: 'Renée', data: { vipGroup: true, ...unexpectedMedia } },
    { id: 'unknown', accountId: 'a', externalId: 'opaque', title: 'Renée' },
    { id: 'other', accountId: 'b', externalId: 'known@lid', title: 'Renée', ...unexpectedMedia },
  ];
  const html = f.renderConversationList();
  assert.match(html, /data-id="known"><span data-test-avatar="initial"/);
  assert.match(html, /data-id="unnamed"><span data-test-avatar="default"/);
  assert.match(html, /data-id="group"><span class="ws-session-glyph" role="img" aria-label="群聊"[^]*?#i-users-group/);
  assert.match(html, /data-id="unknown"><span class="ws-session-glyph" aria-hidden="true"/);
  assert.match(html, /data-id="other"><span class="ws-session-glyph" aria-hidden="true"/);
  assert.deepEqual(f.calls.map(({ name, size, selected }) => [name, size, selected]), [
    ['Renée', 'list', true], ['', 'list', false],
  ]);
  assertFallbackOnly(html, f.calls);
});

test('WS CRM uses persisted account links and ignores guessed image fields in the archive', () => {
  const f = fixture();
  const customer = { id: 'crm-a', name: '同名客户', vipNumber: 'VIP-1', ...unexpectedMedia };
  const active = { id: 'current', accountId: 'a', externalId: 'person@lid', title: '同名客户', customerId: customer.id };
  f.host.state.customers = [
    customer, { ...customer, id: 'crm-b' }, { ...customer, id: 'deleted', deleted: true },
  ];
  f.state.conversations = [
    active, { ...active, accountId: 'b', customerId: 'crm-b' }, { ...active, customerId: 'deleted' },
  ];
  f.wsWorkspacePageState('crm').detailId = customer.id;
  const crm = f.renderWorkspaceCustomers();
  assert.match(crm, /crm-a/);
  assert.match(crm, /data-ws-avatar-capability="blocked"/);
  assert.doesNotMatch(crm, /crm-b|deleted/);
  assert.deepEqual(f.calls.map(({ size, vip }) => [size, vip]), [['table', true], ['detail', true]]);
  assertFallbackOnly(crm, f.calls);

  f.calls.length = 0;
  f.state.currentConversationId = active.id;
  const archive = { accountId: 'a', matched: true, customer, conversation: active };
  for (const unverified of [
    { ...archive, accountId: 'b' },
    { ...archive, conversation: { ...active, id: 'old' } },
    { ...archive, conversation: { ...active, accountId: 'b' } },
    { ...archive, conversation: { ...active, externalId: 'group@g.us' } },
  ]) {
    f.state.archive = unverified;
    assert.doesNotMatch(f.renderDataArchiveSummary(), /data-test-avatar|data-ws-avatar-capability/);
  }
  assert.equal(f.calls.length, 0);
  f.state.archive = archive;
  const summary = f.renderDataArchiveSummary();
  assert.match(summary, /data-ws-avatar-capability="blocked"/);
  assert.deepEqual(f.calls.map(({ name, size, vip }) => [name, size, vip]), [['同名客户', 'detail', true]]);
  assertFallbackOnly(summary, f.calls);
  f.resetAccountPresentation('b');
  assert.doesNotMatch(f.renderDataArchiveSummary(), /同名客户|data-test-avatar/);
});
