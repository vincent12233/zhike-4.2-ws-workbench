'use strict';

// Real migrations, SQLite and loopback HTTP against disposable synthetic roots.
// Fifty registered accounts exercise metadata isolation, not fifty live sessions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations, hashMigration } = require('../resources/app/migration-runner.cjs');
const { observeSidecarStartup, requestWithStartupDiagnostics } = require('./helpers/sidecar-startup-observer.cjs');

const app = path.resolve(__dirname, '../resources/app');
const migrations = path.join(app, 'migrations');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-workspace-mode-'));
const sourceRoot = path.join(root, 'source'), restoredRoot = path.join(root, 'restored');
const children = new Set();
let passed = 0;
async function check(name, run) { await run(); passed++; console.log('PASS ' + name); }

function openData(directory) { return new DatabaseSync(path.join(directory, 'workspace.sqlite')); }
function snapshotCustomers(directory) {
  const db = openData(directory);
  try { return JSON.stringify(db.prepare('SELECT * FROM customers ORDER BY id').all()); }
  finally { db.close(); }
}
async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}
async function start(directory) {
  const port = await freePort(), origin = 'http://127.0.0.1:' + port;
  const token = randomBytes(24).toString('hex');
  const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
    cwd: app, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, ZHIKE_DATA_DIR: directory, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token,
      ZHIKE_PARENT_PID: '', ZHIKE_GROUP_MANAGER_MODE: '', ZHIKE_STAGE3_MOCK: '', ZHIKE_AI_PIPELINE_MODE: '', ZHIKE_STAGE4_MOCK: '', ZHIKE_FENCING_MODE: '' },
  });
  children.add(child);
  const closed = new Promise(resolve => child.once('close', () => { children.delete(child); resolve(); }));
  const observation = observeSidecarStartup(child, { secrets: [token] });
  const request = async (route, method = 'GET', body) => {
    const response = await fetch(origin + route, { method, signal: AbortSignal.timeout(5000),
      headers: { origin, 'x-zhike-api-token': token, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, value: await response.json() };
  };
  await requestWithStartupDiagnostics(() => request('/api/health'), observation);
  return { request, async stop() { if (child.exitCode === null && child.signalCode === null) child.kill(); await closed; } };
}

(async () => {
  let source, restored;
  try {
    fs.mkdirSync(sourceRoot);
    const legacyMigrations = path.join(root, 'schema-27');
    fs.mkdirSync(legacyMigrations);
    const manifest = JSON.parse(fs.readFileSync(path.join(migrations, 'manifest.json'), 'utf8'));
    const oldManifest = { ...manifest, supportedSchemaVersion: 27, migrations: manifest.migrations.filter(entry => entry.version <= 27) };
    fs.writeFileSync(path.join(legacyMigrations, 'manifest.json'), JSON.stringify(oldManifest));
    for (const entry of oldManifest.migrations) fs.copyFileSync(path.join(migrations, entry.file), path.join(legacyMigrations, entry.file));

    await check('027 upgrade defaults old accounts to ordinary and preserves prior checksums and CRM', () => {
      const db = openData(sourceRoot);
      try {
        runMigrations({ db, dbPath: path.join(sourceRoot, 'workspace.sqlite'), migrationDir: legacyMigrations, backup: false });
        const now = new Date().toISOString();
        db.prepare('INSERT INTO ws_accounts(id,display_name,created_at,updated_at) VALUES(?,?,?,?)').run('legacy', 'Synthetic legacy account', now, now);
        db.prepare('INSERT INTO customers(id,phone_normalized,name,deleted,data_json) VALUES(?,?,?,?,?)').run('synthetic-crm', '9000000001', 'Synthetic CRM owner', 0, '{"id":"synthetic-crm","vip":true}');
        const before = db.prepare('SELECT version,checksum FROM schema_migrations ORDER BY version').all();
        const customers = db.prepare('SELECT * FROM customers').all();
        const upgraded = runMigrations({ db, dbPath: path.join(sourceRoot, 'workspace.sqlite'), migrationDir: migrations, backup: false });
        assert.equal(upgraded.version, manifest.supportedSchemaVersion);
        assert.deepEqual(db.prepare('SELECT version,checksum FROM schema_migrations WHERE version<=27 ORDER BY version').all(), before);
        assert.deepEqual(db.prepare('SELECT * FROM customers').all(), customers);
        assert.ok(db.prepare('SELECT workspace_mode FROM ws_accounts').all().every(row => row.workspace_mode === 'ordinary'));
        assert.throws(() => db.prepare('UPDATE ws_accounts SET workspace_mode=? WHERE id=?').run('vip', 'legacy'), /CHECK constraint/);
        assert.throws(() => db.prepare('UPDATE ws_accounts SET workspace_mode=? WHERE id=?').run(null, 'legacy'), /NOT NULL constraint/);
        assert.equal(manifest.migrations.find(entry => entry.version === 28).checksum, hashMigration(path.join(migrations, '028-ws-account-workspace-mode.sql')));
        assert.equal(runMigrations({ db, dbPath: path.join(sourceRoot, 'workspace.sqlite'), migrationDir: migrations, backup: false }).applied.length, 0);
      } finally { db.close(); }
    });

    source = await start(sourceRoot);
    const crmBefore = snapshotCustomers(sourceRoot);
    const expected = new Map([['default', 'ordinary'], ['legacy', 'ordinary']]);
    await check('50 registered synthetic accounts retain independent ordinary/dedicated roles', async () => {
      for (let i = 1; i <= 48; i++) {
        const id = 'role-' + i, workspaceMode = i % 2 ? 'dedicated' : 'ordinary';
        const body = { id, displayName: 'Synthetic ' + i, ...(i === 48 ? {} : { workspaceMode }) };
        const result = await source.request('/api/ws/accounts', 'POST', body);
        assert.equal(result.status, 201);
        assert.equal(result.value.account.workspaceMode, workspaceMode);
        expected.set(id, workspaceMode);
      }
      const listed = await source.request('/api/ws/accounts');
      assert.equal(listed.value.accounts.length, 50);
      for (const account of listed.value.accounts) {
        assert.equal(account.workspaceMode, expected.get(account.id));
        assert.equal(account.status, '未连接', 'registration is not an online session');
      }
    });

    await check('mode validation rejects VIP, coercions and conflicting same-ID registration', async () => {
      for (const workspaceMode of ['vip', 'Dedicated', ' ordinary', '', null, 1, true, {}, []]) {
        for (const [route, method, body] of [
          ['/api/ws/accounts', 'POST', { id: 'invalid-mode', workspaceMode }],
          ['/api/ws/accounts/role-1', 'PATCH', { workspaceMode }],
        ]) {
          const result = await source.request(route, method, body);
          assert.equal(result.status, 400);
          assert.equal(result.value.code, 'INVALID_WORKSPACE_MODE');
        }
      }
      const conflict = await source.request('/api/ws/accounts', 'POST', { id: 'role-1', workspaceMode: 'ordinary' });
      assert.equal(conflict.status, 409); assert.equal(conflict.value.code, 'WORKSPACE_MODE_CONFLICT');
      const legacyDuplicate = await source.request('/api/ws/accounts', 'POST', { id: 'role-1' });
      assert.equal(legacyDuplicate.status, 409);
      assert.equal((await source.request('/api/ws/accounts')).value.accounts.length, 50);
    });

    await check('status/name updates and native-compatible payloads cannot silently change purpose', async () => {
      let result = await source.request('/api/ws/accounts/role-1', 'PATCH', { status: '已连接', displayName: 'Renamed synthetic' });
      assert.equal(result.status, 200); assert.equal(result.value.account.workspaceMode, 'dedicated');
      result = await source.request('/api/ws/accounts/role-1', 'PATCH', { workspaceMode: 'dedicated' });
      assert.equal(result.status, 200);
      for (const id of ['role-1', 'role-2']) {
        const result = await source.request('/api/ws/accounts/' + id, 'PATCH', { status: '未连接', workspaceMode: expected.get(id) === 'ordinary' ? 'dedicated' : 'ordinary' });
        assert.equal(result.status, 409); assert.equal(result.value.code, 'WORKSPACE_MODE_IMMUTABLE');
        assert.equal((await source.request('/api/ws/accounts/' + id)).value.account.workspaceMode, expected.get(id));
      }
      assert.equal((await source.request('/api/ws/accounts/role-1')).value.account.status, '已连接', 'rejected mixed patches must not change status either');
    });

    await check('case-only account IDs cannot create a second role or collide with a Windows profile', async () => {
      for (const body of [
        { id: 'ROLE-1', workspaceMode: 'ordinary' },
        { id: 'ROLE-1', workspaceMode: 'dedicated' },
        { id: 'ROLE-1' },
        { id: 'DEFAULT', workspaceMode: 'dedicated' },
        { id: 'DEFAULT' },
      ]) {
        const existingMode = expected.get(body.id.toLowerCase());
        const result = await source.request('/api/ws/accounts', 'POST', body);
        assert.equal(result.status, 409, 'case variants must never create another SQLite account');
        assert.equal(result.value.code, Object.hasOwn(body, 'workspaceMode') && body.workspaceMode !== existingMode ? 'WORKSPACE_MODE_CONFLICT' : 'WS_ACCOUNT_ID_CASE_CONFLICT');
      }
      const accounts = (await source.request('/api/ws/accounts')).value.accounts;
      assert.equal(accounts.length, 50);
      assert.ok(accounts.every(account => expected.has(account.id)), 'original canonical spelling remains unchanged');
      for (const account of accounts) assert.equal(account.workspaceMode, expected.get(account.id));
    });

    await source.stop(); source = await start(sourceRoot);
    await check('process restart preserves all 50 roles while resetting stale runtime status', async () => {
      const listed = (await source.request('/api/ws/accounts')).value.accounts;
      assert.equal(listed.length, 50);
      for (const account of listed) { assert.equal(account.workspaceMode, expected.get(account.id)); assert.equal(account.status, '未连接'); }
      assert.equal(snapshotCustomers(sourceRoot), crmBefore);
    });

    const exports = new Map();
    await check('single and all-account exports preserve role metadata without rewriting CRM', async () => {
      const all = (await source.request('/api/ws/export?allAccounts=1')).value;
      assert.equal(all.accounts.length, 50);
      for (const account of all.accounts) assert.equal(account.workspaceMode, expected.get(account.id));
      for (const [id, workspaceMode] of expected) {
        const result = await source.request('/api/ws/export?accountId=' + encodeURIComponent(id));
        assert.equal(result.status, 200);
        assert.equal(result.value.accounts.length, 1);
        assert.equal(result.value.accounts[0].id, id);
        assert.equal(result.value.accounts[0].workspaceMode, workspaceMode);
        exports.set(id, result.value);
      }
      assert.equal(snapshotCustomers(sourceRoot), crmBefore);
    });

    restored = await start(restoredRoot);
    const restoredCrm = snapshotCustomers(restoredRoot);
    await check('clean workspace restore recreates all 50 roles using the exported per-account metadata', async () => {
      for (const [id, data] of exports) {
        if (id !== 'default') assert.equal((await restored.request('/api/ws/accounts', 'POST', { id, displayName: id, workspaceMode: data.accounts[0].workspaceMode })).status, 201);
        const imported = await restored.request('/api/ws/import', 'POST', { ...data, accountId: id });
        assert.equal(imported.status, 200, JSON.stringify(imported.value));
      }
      const accounts = (await restored.request('/api/ws/accounts')).value.accounts;
      assert.equal(accounts.length, 50);
      for (const account of accounts) assert.equal(account.workspaceMode, expected.get(account.id));
      assert.equal(snapshotCustomers(restoredRoot), restoredCrm, 'WS role restore does not import or reclassify CRM customers');
    });

    await check('restore rejects conflicting/invalid/mismatched metadata before data replacement; legacy backups preserve purpose', async () => {
      const data = exports.get('role-1');
      const seeded = { ...data, accountId: 'role-1', conversations: [{ id: 'retained-synthetic-conversation', externalId: '123456789@lid', title: 'Synthetic retained data', data: { conversationType: 'direct', isGroup: false } }] };
      assert.equal((await restored.request('/api/ws/import', 'POST', seeded)).status, 200);
      for (const [accounts, status, code] of [
        [[{ ...data.accounts[0], workspaceMode: 'ordinary' }], 409, 'WORKSPACE_MODE_CONFLICT'],
        [[{ ...data.accounts[0], workspaceMode: 'vip' }], 400, 'INVALID_WORKSPACE_MODE'],
        [[{ ...data.accounts[0], id: 'role-2' }], 400, 'WORKSPACE_MODE_ACCOUNT_MISMATCH'],
        [[], 400, 'WORKSPACE_MODE_ACCOUNT_MISMATCH'],
      ]) {
        const result = await restored.request('/api/ws/import', 'POST', { ...data, accountId: 'role-1', accounts });
        assert.equal(result.status, status); assert.equal(result.value.code, code);
        const retained = (await restored.request('/api/ws/export?accountId=role-1')).value;
        assert.equal(retained.conversations[0]?.id, 'retained-synthetic-conversation', 'rejected metadata must not erase existing conversations');
      }
      const legacy = { ...data }; delete legacy.accounts;
      assert.equal((await restored.request('/api/ws/import', 'POST', { ...legacy, accountId: 'role-1' })).status, 200);
      assert.equal((await restored.request('/api/ws/accounts/role-1')).value.account.workspaceMode, 'dedicated');
      assert.equal(snapshotCustomers(restoredRoot), restoredCrm);
    });

    console.log(JSON.stringify({ suite: 'ws-account-workspace-mode', passed, registeredAccounts: 50, realOnlineSessions: 0, syntheticRootsOnly: true, priorSchema: 27, schema: 28 }));
  } finally {
    if (source) await source.stop();
    if (restored) await restored.stop();
    for (const child of children) { const closed = new Promise(resolve => child.once('close', resolve)); child.kill(); await closed; }
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('zhike-workspace-mode-'));
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
