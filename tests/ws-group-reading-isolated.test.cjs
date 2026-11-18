'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations } = require('../resources/app/migration-runner.cjs');
const test = require('node:test');
const vm = require('node:vm');
const { observeSidecarStartup, requestWithStartupDiagnostics } = require('./helpers/sidecar-startup-observer.cjs');
const app = path.join(__dirname, '../resources/app');
const route = '/api/ws/group-manager/';
const now = '2026-11-17T10:00:00.000Z';
const groupJid = 'local-fixture@g.us';
const otherGroup = 'other-fixture@g.us';
const messageId = 'local-msg';

function seed(root) {
  const db = new DatabaseSync(path.join(root, 'workspace.sqlite'));
  try {
    const migrationDir = path.join(app, 'migrations');
    runMigrations({ db, migrationDir, manifestPath: path.join(migrationDir, 'manifest.json'), lockPath: path.join(root, 'seed.lock'), backup: false });
    const account = db.prepare('INSERT OR IGNORE INTO ws_accounts(id, display_name, created_at, updated_at) VALUES (?,?,?,?)');
    for (const id of ['default', 'other-account']) account.run(id, id, now, now);
    const group = db.prepare(`INSERT INTO ws_group_catalog(id, account_id, group_jid, group_name, first_seen_at, last_seen_at, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?)`);
    const message = db.prepare(`INSERT INTO ws_group_messages(id, account_id, group_jid, message_id, sent_at, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?)`);
    for (const [accountId, jid, msg] of [['default', groupJid, messageId], ['other-account', groupJid, 'other-message'], ['default', otherGroup, messageId]]) {
      const id = accountId + ':' + jid;
      group.run(id, accountId, jid, '本地测试群', now, now, now, now);
      message.run(id, accountId, jid, msg, now, now, now);
    }
    const member = db.prepare(`INSERT INTO ws_group_members(id, account_id, group_jid, member_jid, status, created_at, updated_at)
      VALUES (?, 'default', ?, ?, 'active', ?, ?)`);
    member.run('local-a', groupJid, 'member-a@lid', now, now);
    member.run('local-b', groupJid, 'member-b@lid', now, now);
    member.run('foreign', otherGroup, 'foreign@lid', now, now);
    db.prepare(`INSERT INTO ws_group_read_evidence
      (id, account_id, group_jid, message_id, member_jid, status, evidence_source, evidence_ref, observed_at, created_at, updated_at)
      VALUES ('untrusted', 'default', ?, ?, 'member-a@lid', 'read', 'fixture-claim', 'fixture-reference', ?, ?, ?)`)
      .run(groupJid, messageId, now, now, now);
  } finally {
    db.close();
  }
}

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

async function withSidecar(flags, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-local-reading-'));
  let child;
  let closed;
  try {
    seed(root);
    const port = await freePort();
    const url = 'http://127.0.0.1:' + port;
    const token = randomBytes(32).toString('hex');
    child = spawn(process.execPath, ['server.mjs'], {
      cwd: app, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, ZHIKE_DATA_DIR: root, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token,
        ZHIKE_SHUTDOWN_TOKEN: token, ZHIKE_PARENT_PID: '', ZHIKE_FENCING_MODE: '', ZHIKE_AI_PIPELINE_MODE: '',
        ZHIKE_STAGE4_MOCK: '', ZHIKE_GROUP_MANAGER_MODE: flags.mode, ZHIKE_STAGE3_MOCK: flags.mock },
    });
    closed = new Promise(resolve => child.once('close', resolve));
    const observation = observeSidecarStartup(child, { secrets: [token] });
    const request = async (requestPath, init = {}) => {
      const response = await fetch(url + requestPath, {
        signal: AbortSignal.timeout(5000), ...init,
        headers: { 'x-zhike-api-token': token, origin: url, ...init.headers },
      });
      return { status: response.status, body: await response.json() };
    };
    const healthy = await requestWithStartupDiagnostics(() => request('/api/health'), observation);
    assert.equal(healthy.status, 200);
    await run(request);
  } finally {
    if (child && child.exitCode == null && child.signalCode == null) child.kill();
    if (closed) await closed;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function url(suffix, fields = {}) {
  return route + suffix + '?' + new URLSearchParams({ accountId: 'default', groupJid, messageId, ...fields });
}

test('actual loopback sidecar gates and serves local-only observation and CSV', { timeout: 60000 }, async () => {
  for (const flags of [{ mode: '', mock: '' }, { mode: 'isolated', mock: '' }, { mode: '', mock: '1' }]) {
    await withSidecar(flags, async request => {
      for (const suffix of ['customer-reading/capability', 'customer-reading', 'customer-reading/export']) {
        const disabled = await request(url(suffix));
        assert.equal(disabled.status, 404);
        assert.equal(disabled.body.code, 'GROUP_MANAGER_DISABLED');
      }
    });
  }
  await withSidecar({ mode: 'isolated', mock: '1' }, async request => {
    const cap = await request(url('customer-reading/capability'));
    assert.deepEqual(cap, { status: 200, body: { accountId: 'default', groupJid, localObservation: true } });
    assert.equal((await request(url('customer-reading'), { headers: { 'x-zhike-api-token': 'invalid' } })).status, 401);
    assert.equal((await request(url('customer-reading/export'), { headers: { origin: 'https://example.invalid' } })).status, 403);
    assert.equal((await request(url('customer-reading'), { method: 'POST' })).status, 405);
    assert.equal((await request(url('customer-reading', { messageId: '' }))).status, 400);
    assert.equal((await request(url('customer-reading') + '&accountId=other-account')).status, 400);
    assert.equal((await request(url('customer-reading', { limit: '300' }))).status, 400);
    assert.equal((await request(url('customer-reading', { accountId: 'other-account' }))).status, 404);
    assert.equal((await request(url('customer-reading', { groupJid: 'missing@g.us' }))).status, 404);

    const listed = await request(url('messages'));
    assert.deepEqual(listed.body.messages.map(row => row.messageId), [messageId]);
    const first = await request(url('customer-reading', { limit: '1' }));
    assert.equal(first.status, 200);
    assert.equal(first.body.total, 2);
    assert.equal(first.body.nextOffset, 1);
    assert.equal(first.body.rows[0].memberId, 'member-a@lid');
    assert.equal(first.body.rows[0].status, 'unknown');
    assert.equal(first.body.messages[0].confirmedUnreadMembers, null);
    assert.equal(first.body.messages[0].readRate.value, null);
    assert.equal(first.body.messages[0].readRate.denominator, null);
    assert.equal(JSON.stringify(first.body).includes('fixture-reference'), false);
    const second = await request(url('customer-reading', { limit: '1', offset: '1' }));
    assert.equal(second.body.nextOffset, null);
    assert.equal(second.body.rows[0].memberId, 'member-b@lid');
    const foreignGroup = await request(url('customer-reading', { groupJid: otherGroup }));
    assert.deepEqual(foreignGroup.body.rows.map(row => row.memberId), ['foreign@lid']);
    const csv = await request(url('customer-reading/export'));
    assert.equal(csv.status, 200);
    assert.equal(csv.body.messageId, messageId);
    assert.equal(csv.body.rowCount, 2);
    assert.ok(csv.body.csv.includes('"unknown"'));
    assert.equal(csv.body.csv.includes('foreign@lid'), false);
    assert.equal(csv.body.csv.includes('fixture-reference'), false);
  });
});

test('WS04 actual workbench DOM fixture handles selection, pages, download and stale account', async () => {
  const source = fs.readFileSync(path.join(app, 'modules/ws-workbench.js'), 'utf8');
  const html = fs.readFileSync(path.join(app, 'index.html'), 'utf8');
  assert.match(html, /ws-group-reading-ui\.js"><\/script>\s*<script src="\.\/modules\/ws-workbench\.js/);
  const target = { innerHTML: '', querySelector: () => null };
  const host = { state: { view: 'ws-workbench', settings: {}, customers: [], activities: [] } };
  const scope = { accountId: 'default', groupJid, messageId };
  const requests = [];
  let downloadCount = 0;
  let delayExport;
  let enabled = false;
  let failMessages = false;
  let empty = false;
  class DownloadUrl extends URL {
    static createObjectURL() { return 'blob:reading-test'; }
    static revokeObjectURL() {}
  }
  const fakeFetch = async pathname => {
    const request = new URL(pathname, 'https://zhike.local');
    requests.push(request);
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
    if (request.pathname.endsWith('/capability')) return enabled ? json({ ...scope, localObservation: true }) : json({ code: 'GROUP_MANAGER_DISABLED' }, 404);
    if (request.pathname.endsWith('/messages')) {
      if (failMessages) return json({ error: '<unsafe error>' }, 500);
      return json({ ...scope, messages: empty ? [] : [{ ...scope, messageId: '<unsafe message>', sentAt: now, type: 'text' },
        { ...scope, accountId: 'other-account', messageId: 'cross-account' }] });
    }
    if (request.pathname.endsWith('/export')) {
      if (delayExport) await delayExport;
      return json({ ...scope, messageId: '<unsafe message>', rowCount: 26, csv: '"unknown"\r\n' });
    }
    const offset = Number(request.searchParams.get('offset'));
    const message = { ...scope, messageId: '<unsafe message>' };
    return json({ messages: [{ ...message, observedMembers: 26, unknownMembers: 26, mappedObservedMembers: 1 }],
      rows: [{ ...message, memberId: offset ? 'second-page@lid' : 'first-page@lid', customer: { name: '<unsafe customer>' }, memberBasis: 'message-evidence-record' }],
      total: 26, nextOffset: offset ? null : 25 });
  };
  const document = {
    querySelector: selector => selector === '#viewContainer' ? target : null,
    querySelectorAll: () => [], getElementById: () => null, addEventListener() {},
    createElement: tag => {
      if (tag === 'template') return { content: { firstElementChild: null } };
      assert.equal(tag, 'a');
      return { click: () => downloadCount++ };
    },
  };
  const context = {
    window: {
      ZhikeWsCore: require('../resources/app/modules/ws-workbench-core.js'),
      ZhikeWsBusinessPages: require('../resources/app/modules/ws-business-pages.js'),
      ZhikeWsGroupReading: require('../resources/app/modules/ws-group-reading-ui.js'),
      __zhikeRegistryHost: host, innerWidth: 1440, innerHeight: 900, location: { origin: 'https://zhike.local' },
    },
    document, localStorage: { getItem: () => null, setItem() {} }, requestAnimationFrame: () => 0,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    fetch: fakeFetch, URL: DownloadUrl, URLSearchParams, AbortController, Blob,
  };
  const boot = /  boot\(\);\s*\}\)\(\);\s*$/;
  assert.match(source, boot);
  vm.runInNewContext(source.replace(boot, '  globalThis.fixture = { state, render, handleAction, applyControlChange };\n})();'), context);
  const { state, render, handleAction, applyControlChange } = context.fixture;
  Object.assign(state, { active: true, activeAccountId: 'default', wsWorkspaceView: 'groups',
    accounts: [{ id: 'default', displayName: '默认' }, { id: 'other-account', displayName: '其他' }],
    groupCatalog: [{ accountId: 'default', groupJid, groupName: '本地群' }] });
  const details = () => handleAction('group-directory-detail', { dataset: { groupId: groupJid } });
  render();
  assert.equal(requests.length, 0);
  assert.match(target.innerHTML, /群组目录/);
  await details();
  assert.doesNotMatch(target.innerHTML, /data-ws-group-reading/);
  assert.equal(requests.length, 1);

  enabled = true;
  await details();
  await details();
  assert.match(target.innerHTML, /请选择消息/);
  assert.match(target.innerHTML, /&lt;unsafe message&gt;/);
  assert.doesNotMatch(target.innerHTML, /cross-account/);
  assert.doesNotMatch(target.innerHTML, /first-page/);
  assert.equal(requests.at(-1).pathname, route + 'messages');
  await handleAction('group-reading-query');
  assert.equal(requests.at(-1).pathname, route + 'messages');

  applyControlChange({ matches: selector => selector === '[data-ws-group-reading-message]', value: '<unsafe message>' });
  await handleAction('group-reading-query');
  assert.match(target.innerHTML, /first-page@lid/);
  assert.match(target.innerHTML, /&lt;unsafe customer&gt;/);
  assert.match(target.innerHTML, /确认未读、历史有效人数和已读率不可用/);
  await handleAction('group-reading-next');
  assert.match(target.innerHTML, /second-page@lid/);
  assert.equal(requests.at(-1).searchParams.get('offset'), '25');
  await handleAction('group-reading-previous');
  assert.match(target.innerHTML, /first-page@lid/);
  await handleAction('group-reading-export');
  assert.equal(downloadCount, 1);

  let complete;
  delayExport = new Promise(resolve => { complete = resolve; });
  const pending = handleAction('group-reading-export');
  assert.equal(requests.at(-1).pathname, route + 'customer-reading/export');
  state.activeAccountId = 'other-account';
  state.accountLoadSequence++;
  render();
  complete();
  await pending;
  assert.equal(downloadCount, 1);
  assert.doesNotMatch(target.innerHTML, /data-ws-group-reading/);

  state.activeAccountId = 'default';
  state.accountLoadSequence++;
  await details();
  failMessages = true;
  await details();
  assert.match(target.innerHTML, /&lt;unsafe error&gt;/);
  assert.doesNotMatch(target.innerHTML, /first-page/);
  failMessages = false;
  empty = true;
  await details();
  await details();
  assert.match(target.innerHTML, /没有可选择的本地捕获消息/);
});
