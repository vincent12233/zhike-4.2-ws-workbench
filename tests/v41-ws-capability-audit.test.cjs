'use strict';
// Synthetic host authority for native-ingest positive fixtures; never a renderer fallback.
const nativeAuthorityToken = require('node:crypto').randomBytes(32).toString('hex');


const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createGroupManager } = require('../resources/app/modules/ws-group-manager-core.js');
const { normalizeMemberIdentity, resolveMembershipIdentity } = require('../resources/app/modules/ws-group-monitor-core.js');
const { runMigrations } = require('../resources/app/migration-runner.cjs');

const now = '2026-11-17T10:00:00.000Z';
const scope = { accountId: 'test-account-a', groupJid: 'test-group-a@g.us', messageId: 'test-message-1' };
const otherGroup = { ...scope, groupJid: 'test-group-b@g.us' };
const otherAccount = { ...scope, accountId: 'test-account-b' };
const memberJid = 'audit-member@lid';

test('isolated core keeps message and read state separate by account, group and message', () => {
  const manager = createGroupManager({
    now: () => now,
    flags: {
      IndependentWsGroupManagerEnabled: true,
      GroupMessageCollectionEnabled: true,
      GroupReadEvidenceEnabled: true,
    },
  });
  const otherMessage = { ...scope, messageId: 'test-message-2' };

  for (const item of [scope, otherGroup, otherAccount, otherMessage]) {
    assert.equal(manager.upsertMessage(item).status, 'created');
    assert.equal(manager.recordReadEvidence({ ...item, memberJid, status: 'unknown' }).status, 'created');
  }
  assert.equal(manager.upsertMessage(scope).status, 'duplicate');
  assert.throws(
    () => manager.recordReadEvidence({ ...scope, memberJid, status: 'read' }),
    /evidence is required/,
  );

  const read = { ...scope, memberJid, status: 'read', evidenceRef: 'fixture-evidence-only' };
  assert.equal(manager.recordReadEvidence(read).status, 'updated');
  assert.equal(manager.recordReadEvidence(read).status, 'duplicate');
  for (const status of ['delivered', 'unknown']) {
    assert.equal(manager.recordReadEvidence({ ...scope, memberJid, status }).reason, 'read-evidence-regression');
  }
  for (const item of [scope, otherGroup, otherAccount, otherMessage]) {
    const result = manager.listReadEvidence(item.accountId, item.groupJid)
      .find(row => row.messageId === item.messageId);
    assert.equal(result.status, item === scope ? 'read' : 'unknown');
  }
});

test('historical CRM matching isolates explicit mappings and leaves names and conflicts unresolved', () => {
  const customers = [{ id: 'crm-a', name: 'Same Name' }, { id: 'crm-b', name: 'Same Name' }];
  const event = { ...scope, memberId: memberJid, displayName: 'Same Name' };
  const mappings = [
    { ...scope, memberId: memberJid, customerId: 'crm-a' },
    { ...otherAccount, memberId: memberJid, customerId: 'crm-b' },
  ];

  assert.equal(resolveMembershipIdentity(event, customers, []).status, 'unmatched');
  assert.equal(resolveMembershipIdentity(event, customers, mappings).customer.id, 'crm-a');
  assert.equal(resolveMembershipIdentity({ ...event, ...otherAccount }, customers, mappings).customer.id, 'crm-b');
  assert.equal(resolveMembershipIdentity({ ...event, ...otherGroup }, customers, mappings).status, 'unmatched');
  assert.equal(resolveMembershipIdentity(event, customers, [
    ...mappings,
    { ...scope, memberId: memberJid, customerId: 'crm-b' },
  ]).status, 'ambiguous');
});

test('real migration chain keeps relation, message and evidence uniqueness scoped', () => {
  const db = new DatabaseSync(':memory:');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-v41-ws-audit-'));
  const migrationDir = path.join(__dirname, '..', 'resources', 'app', 'migrations');

  try {
    runMigrations({
      db,
      migrationDir,
      manifestPath: path.join(migrationDir, 'manifest.json'),
      lockPath: path.join(work, 'migration.lock'),
      backup: false,
    });
    const schemaVersion = db.prepare('PRAGMA user_version').get().user_version;
    assert.ok(schemaVersion >= 25);
    const eventColumns = db.prepare('PRAGMA table_info(ws_group_membership_events)').all();
    assert.ok(eventColumns.some(column => column.name === 'correlation_id'));

    const account = db.prepare('INSERT INTO ws_accounts(id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)');
    for (const id of [scope.accountId, otherAccount.accountId]) account.run(id, id, now, now);

    const relation = db.prepare(
      'INSERT INTO customer_group_memberships(id, account_id, group_jid, member_jid, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const message = db.prepare(
      'INSERT INTO ws_group_messages(id, account_id, group_jid, message_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const evidence = db.prepare(
      "INSERT INTO ws_group_read_evidence(id, account_id, group_jid, message_id, member_jid, status, observed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'unknown', ?, ?, ?)",
    );
    for (const [index, item] of [scope, otherGroup, otherAccount].entries()) {
      relation.run('relation-' + index, item.accountId, item.groupJid, memberJid, now, now);
      message.run('message-' + index, item.accountId, item.groupJid, item.messageId, now, now);
      evidence.run('evidence-' + index, item.accountId, item.groupJid, item.messageId, memberJid, now, now, now);
    }

    assert.throws(() => relation.run('duplicate', scope.accountId, scope.groupJid, memberJid, now, now), /UNIQUE constraint/);
    assert.throws(() => message.run('duplicate', scope.accountId, scope.groupJid, scope.messageId, now, now), /UNIQUE constraint/);
    assert.throws(() => evidence.run('duplicate', scope.accountId, scope.groupJid, scope.messageId, memberJid, now, now, now), /UNIQUE constraint/);
  } finally {
    db.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('opaque platform IDs preserve case and never match CRM by an unrelated numeric suffix', () => {
  const customer = { id: 'crm-fixture', phone: '1234567890123' };
  for (const memberId of ['US.1234567890123', 'US.ENT.1234567890123', 'US.Ab123Cd']) {
    const identity = normalizeMemberIdentity(memberId);
    assert.equal(identity.kind, 'opaque');
    assert.equal(identity.value, memberId);
    assert.equal(identity.phone, '');
    assert.equal(resolveMembershipIdentity({ memberId }, [customer]).status, 'unmatched');
    assert.equal(resolveMembershipIdentity({ memberId: 'unknown@lid', memberPhone: 'whatsapp:' + memberId }, [customer]).status, 'unmatched');
  }

  for (const memberId of ['+1 (234) 567-890123', '1234567890123@s.whatsapp.net', '1234567890123:2@c.us']) {
    assert.equal(resolveMembershipIdentity({ memberId }, [customer]).customer.id, customer.id);
  }
  assert.equal(normalizeMemberIdentity('Alias@lid').value, 'alias@lid');
});

test('opaque identity associations require an exact ID and explicit account and group scopes', () => {
  const memberId = 'US.Ab123Cd';
  const customer = { id: 'crm-fixture', wsExternalIds: [memberId], phone: '1234567890123' };
  const members = [customer];
  const event = { ...scope, memberId, memberPhone: customer.phone };
  const mapping = { ...scope, memberId, customerId: customer.id };

  assert.equal(resolveMembershipIdentity(event, members, []).status, 'unmatched');
  assert.equal(resolveMembershipIdentity(event, members, [mapping]).customer.id, customer.id);
  for (const invalidMapping of [
    { ...mapping, memberId: memberId.toLowerCase() },
    { ...mapping, accountId: otherAccount.accountId },
    { ...mapping, groupJid: otherGroup.groupJid },
    { ...mapping, accountId: '' },
    { ...mapping, groupJid: '' },
  ]) {
    assert.equal(resolveMembershipIdentity(event, members, [invalidMapping]).status, 'unmatched');
  }
  assert.equal(resolveMembershipIdentity({ memberId }, members, [mapping]).status, 'unmatched');
});

test('manual event resolution commits the authoritative relation and CRM projection together', async () => {
  const { spawn } = require('node:child_process');
  const { randomUUID } = require('node:crypto');
  const { once } = require('node:events');
  const { createServer } = require('node:net');
  const { observeSidecarStartup, requestWithStartupDiagnostics } = require('./helpers/sidecar-startup-observer.cjs');
  const portProbe = createServer();
  portProbe.listen(0, '127.0.0.1');
  await once(portProbe, 'listening');
  const port = portProbe.address().port;
  await new Promise((resolve, reject) => portProbe.close(error => error ? reject(error) : resolve()));

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-v41-ws-resolution-'));
  const app = path.join(__dirname, '..', 'resources', 'app');
  const token = randomUUID();
  const endpoint = 'http://127.0.0.1:' + port;
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^ZHIKE_/i.test(key)));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: app,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...environment, ZHIKE_DATA_DIR: work, ZHIKE_PORT: String(port), ZHIKE_NATIVE_WRITE_TOKEN: nativeAuthorityToken, ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token },
  });
  const observation = observeSidecarStartup(child, { secrets: [token, nativeAuthorityToken] });
  const closed = new Promise(resolve => child.once('close', resolve));
  const headers = { origin: endpoint, 'x-zhike-native-token': nativeAuthorityToken, 'x-zhike-api-token': token, 'content-type': 'application/json' };
  const request = (pathname, init = {}) => fetch(endpoint + pathname, {
    ...init,
    headers: { ...headers, ...init.headers },
    signal: AbortSignal.timeout(5000),
  });
  async function json(pathname, body, extraHeaders = {}) {
    const response = await request(pathname, body ? { method: 'POST', body: JSON.stringify(body), headers: extraHeaders } : {});
    const value = await response.json();
    assert.ok(response.ok, pathname + ': HTTP ' + response.status + ' ' + JSON.stringify(value));
    return value;
  }

  let db;
  try {
    const health = await requestWithStartupDiagnostics(() => request('/api/health'), observation);
    assert.equal(health.status, 200);
    const accountId = 'resolution-dedicated';
    await json('/api/ws/accounts', { id: accountId, workspaceMode: 'dedicated' });
    const groupJid = 'test-resolution@g.us';
    const unlinkedJid = 'unlinked-fixture@lid';
    const customerId = 'C-V41-AUDIT';
    const current = await json('/api/state');
    const version = await json('/api/state/version');
    await json('/api/state', { ...current, customers: [{ id: customerId, name: 'Fixture', rawPhone: '+12025550123', phone: '12025550123', source: 'Fixture', status: '未进群', deleted: false }] }, { 'x-state-version': version.version });
    const { profile } = await json('/api/ws/group-monitors/profiles', { accountId, slotKey: 'v41-audit-seat', enabled: true });
    const monitors = '/api/ws/group-monitors/' + profile.id;
    const { targets: [target] } = await json(monitors + '/targets/scan?accountId=resolution-dedicated', {
      accountId,
      targets: [{ groupJid, groupName: 'Fixture', sourceId: 'v41-fixture', enabled: true }],
    });
    const ingest = await json('/api/ws/ingest/batch', {
      accountId,
      groupEvents: [{
        profileId: profile.id, targetId: target.id, groupJid, memberId: unlinkedJid,
        type: 'left', sourceEventId: 'v41-fixture-left', eventAt: now, confidence: 1,
      }],
    });
    const [{ event }] = ingest.groupEvents.events;
    assert.equal(event.status, 'pending');

    const databaseFile = path.join(work, 'workspace.sqlite');
    db = new DatabaseSync(databaseFile, { readOnly: true });
    const relationship = db.prepare(
      'SELECT customer_id, status, manual_locked, updated_at FROM customer_group_memberships WHERE account_id=? AND group_jid=? AND member_jid=?',
    );
    const before = relationship.get(accountId, groupJid, unlinkedJid);
    assert.equal(before.status, '未关联客户');
    assert.equal(before.customer_id, '');

    const resolveUrl = monitors + '/events/' + event.id + '/resolve?accountId=resolution-dedicated';
    const resolveBody = { accountId, customerId, lock: true };
    const faultDb = new DatabaseSync(databaseFile);
    try {
      faultDb.exec("CREATE TRIGGER fixture_resolution_failure BEFORE UPDATE OF status ON ws_group_membership_events WHEN NEW.status='applied' BEGIN SELECT RAISE(ABORT, 'fixture resolution failure'); END");
      const failed = await request(resolveUrl, { method: 'POST', body: JSON.stringify(resolveBody) });
      assert.equal(failed.status, 400);
      assert.match((await failed.json()).error, /fixture resolution failure/);
      assert.deepEqual(relationship.get(accountId, groupJid, unlinkedJid), before);
      assert.equal(db.prepare('SELECT status FROM ws_group_membership_events WHERE id=?').get(event.id).status, 'pending');
      const failedState = await json('/api/state');
      const failedCustomer = failedState.customers.find(item => item.id === customerId);
      assert.equal(failedCustomer.groupMemberships?.length || 0, 0);
      assert.equal(failedCustomer.statusHistory?.length || 0, 0);
      faultDb.exec('DROP TRIGGER fixture_resolution_failure');
    } finally {
      faultDb.close();
    }

    const resolved = await json(resolveUrl, resolveBody);
    assert.equal(resolved.event.status, 'applied');
    const state = await json('/api/state');
    const linked = state.customers.find(item => item.id === customerId);
    assert.equal(linked.groupMemberships[0].status, '已退群');
    assert.equal(linked.groupMemberships[0].locked, true);
    assert.equal(linked.updatedAt, resolved.event.updatedAt);

    const after = relationship.get(accountId, groupJid, unlinkedJid);
    assert.deepEqual({ ...after }, {
      customer_id: customerId, status: '已退群', manual_locked: 1, updated_at: resolved.event.updatedAt,
    });
  } finally {
    db?.close();
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      try { await request('/api/shutdown', { method: 'POST', headers: { 'x-zhike-shutdown-token': token } }); }
      catch { child.kill(); }
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
    await closed;
    fs.rmSync(work, { recursive: true, force: true });
  }
});
