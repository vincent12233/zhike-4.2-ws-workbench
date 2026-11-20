'use strict';
// Exercise authenticated local draft routes using a disposable workspace.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');
const { runMigrations } = require('../resources/app/migration-runner.cjs');
const { observeSidecarStartup, requestWithStartupDiagnostics } = require('./helpers/sidecar-startup-observer.cjs');
const app = path.resolve(__dirname, '../resources/app');
function seed(root) {
  const db = new DatabaseSync(path.join(root, 'workspace.sqlite'));
  try {
    runMigrations({ db, migrationDir: path.join(app, 'migrations'), lockPath: path.join(root, 'test.lock'), backup: false });
    const now = new Date().toISOString();
    for (const account of ['desk', 'other']) db.prepare("INSERT INTO ws_accounts(id,display_name,workspace_mode,created_at,updated_at) VALUES(?,?,'dedicated',?,?)").run(account, account, now, now);
    const insert = db.prepare('INSERT INTO ws_group_catalog(id,account_id,group_jid,group_name,status,discovery_source,first_seen_at,last_seen_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
    for (let i = 0; i < 52; i++) insert.run('row' + i, 'desk', 'g' + i + '@g.us', 'Same', 'active', 'ws-collector', now, now, now, now);
    for (const [id, account, status, source] of [['other', 'other','active','ws-collector'], ['gone','desk','inactive','ws-collector'], ['mock','desk','active','stage3-mock']]) {
      insert.run(id, account, id + '@g.us', '<group>', status, source, now, now, now, now);
    }
  } finally { db.close(); }
}

async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

test('dedicated group drafts persist selected catalog identities without submitting a send', { timeout: 60000 }, async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-group-draft-'));
  seed(dataDir);
  const port = await freePort(), origin = 'http://127.0.0.1:' + port, token = randomBytes(24).toString('hex');
  const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
    cwd: app, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token,
      ZHIKE_PARENT_PID: '', ZHIKE_GROUP_MANAGER_MODE: '', ZHIKE_STAGE3_MOCK: '', ZHIKE_AI_PIPELINE_MODE: '', ZHIKE_STAGE4_MOCK: '', ZHIKE_FENCING_MODE: '' },
  });
  const closed = new Promise(resolve => child.once('close', resolve));
  const observation = observeSidecarStartup(child, { secrets: [token] });
  const request = async (route, body, expected = 200) => {
    const headers = { origin, 'x-zhike-api-token': token, 'content-type': 'application/json' };
    if (body !== undefined) headers['x-state-version'] = (await fetch(origin + '/api/state/version', { headers }).then(response => response.json())).version;
    const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(5000), headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json(); assert.equal(response.status, expected, `${route}: ${JSON.stringify(result)}`); return result;
  };
  const route = '/api/ws/group-drafts';
  const scoped = route + '?accountId=desk';
  const data = { accountId: 'desk', id: 'draft-1', action: 'create', message: 'Original\n正文', targets: ['g2@g.us', 'g1@g.us'] };
  try {
    await requestWithStartupDiagnostics(() => request('/api/health'), observation);
    await t.test('scope, catalog filtering, same-name identities and pagination', async () => {
      await request(route, undefined, 400);
      await request(route + '?accountId=default', undefined, 403);
      await request(scoped + '&accountId=other', undefined, 400);
      await request(scoped + '&offset=-1', undefined, 400);
      const first = await request(scoped + '&q=Same');
      assert.equal(first.sendAvailable, false);
      assert.equal(first.groups.length, 50);
      const last = await request(scoped + '&q=Same&offset=' + first.nextOffset);
      assert.equal(last.nextOffset, null);
      assert.equal(new Set(first.groups.concat(last.groups).map(row => row.groupJid)).size, 52);
      assert.equal((await request(scoped + '&q=missing')).groups.length, 0);
    });
    await t.test('foreign, stale, mock or duplicate targets roll back the entire draft', async () => {
      for (const group of ['other@g.us','gone@g.us','mock@g.us']) await request(scoped, { ...data, targets: ['g0@g.us',group] }, 409);
      await request(scoped, { ...data, targets: ['g1@g.us','g1@g.us'] }, 400);
      await request(scoped, { ...data, accountId: 'other' }, 400);
      await request(scoped, { ...data, action: 'send' }, 422);
      assert.deepEqual((await request(scoped)).drafts, []);
    });
    await t.test('concurrent retries have one immutable snapshot and no submission status', async () => {
      const results = await Promise.all([request(scoped, data), request(scoped, { ...data, targets: [...data.targets].reverse(), status: 'CONFIRMED' })]);
      assert.deepEqual(results[0], results[1]);
      const draft = results[0].draft;
      assert.equal(draft.message, data.message);
      assert.deepEqual(draft.targets.map(t => [t.groupJid,t.name,t.status]), [['g1@g.us','Same','DRAFT'],['g2@g.us','Same','DRAFT']]);
      await request(scoped, { ...data, message: 'another' }, 409);
      assert.deepEqual((await request(scoped)).drafts, [draft]);
      assert.deepEqual((await request(route + '?accountId=other')).drafts, []);
    });
    await t.test('cancellation is scoped, durable and cannot be undone by an old create retry', async () => {
      await request(route + '?accountId=other', { accountId: 'other', action: 'cancel', id: data.id }, 404);
      const cancel = { accountId: 'desk', action: 'cancel', id: data.id };
      const result = await request(scoped, cancel);
      assert.equal(result.draft.status, 'CANCELLED');
      assert.ok(result.draft.cancelledAt);
      assert.ok(result.draft.targets.every(group => group.status === 'CANCELLED'));
      assert.deepEqual(await request(scoped, cancel), result);
      assert.deepEqual(await request(scoped, data), result);
      const db = new DatabaseSync(path.join(dataDir,'workspace.sqlite'),{readOnly:true});
      try {
        for (const table of ['ws_conversations','ws_send_audit','ws_send_attachments']) assert.equal(db.prepare('SELECT count(*) AS n FROM ' + table).get().n, 0);
      } finally { db.close(); }
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
    fs.rmSync(dataDir, { recursive: true, maxRetries: 8, retryDelay: 100 });
  }
});
