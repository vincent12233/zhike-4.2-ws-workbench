'use strict';

// Exercise the real HTTP service with production flags, synthetic saved native
// records and a temporary database. No real WS account or profile is opened.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations } = require('../resources/app/migration-runner.cjs');
const { observeSidecarStartup, requestWithStartupDiagnostics } = require('./helpers/sidecar-startup-observer.cjs');

const app = path.resolve(__dirname, '../resources/app');
const groupJid = 'saved-native@g.us', otherGroup = 'other-native@g.us';
const now = '2026-11-19T10:00:00.000Z';
const tables = ['ws_group_members', 'customer_group_memberships', 'ws_group_messages', 'ws_group_read_evidence', 'ws_group_audit', 'ws_group_sync_runs', 'ws_group_sync_errors', 'customers', 'ai_jobs'];

function seed(root) {
  const dbPath = path.join(root, 'workspace.sqlite');
  const db = new DatabaseSync(dbPath);
  try {
    runMigrations({ db, dbPath, migrationDir: path.join(app, 'migrations'), backup: false });
    db.prepare('INSERT INTO ws_accounts(id,display_name,created_at,updated_at) VALUES(?,?,?,?)').run('account-b', 'Synthetic B', now, now);
    const group = db.prepare('INSERT INTO ws_group_catalog(id,account_id,group_jid,group_name,discovery_source,first_seen_at,last_seen_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
    for (const [account, jid] of [['default', groupJid], ['default', otherGroup], ['account-b', groupJid]]) group.run(account + jid, account, jid, account + ' native group', 'ws-native-group-monitor', now, now, now, now);
    const customer = db.prepare('INSERT INTO customers(id,phone_normalized,name,deleted,data_json) VALUES(?,?,?,?,?)');
    customer.run('trusted', '919000000001', 'Synthetic CRM owner', 0, '{"id":"trusted","phone":"919000000001"}');
    customer.run('deleted', '919000000002', 'Deleted synthetic', 1, '{"id":"deleted","phone":"919000000002","deleted":true}');
    customer.run('conflicting', '919000000003', 'Conflicted synthetic', 0, '{"id":"conflicting","phone":"919000000003"}');
    db.prepare('INSERT INTO crm_identity_conflicts(id,canonical_phone,created_at,updated_at) VALUES(?,?,?,?)').run('conflict', '9000000003', now, now);
    const relation = db.prepare(`INSERT INTO customer_group_memberships(id,account_id,group_jid,member_jid,member_phone,customer_id,status,manual_locked,confidence,review_reason,first_joined_at,last_event_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const rows = [
      ['default', groupJid, 'locked@lid', 'trusted', '被移除', 1, 0.1, 'manual-lock'],
      ['default', groupJid, 'native-only@lid', 'trusted', '在群', 0, 1, ''],
      ['default', groupJid, 'unverified@lid', 'trusted', '在群', 0, 0.2, ''],
      ['default', groupJid, 'deleted@lid', 'deleted', '在群', 0, 1, ''],
      ['default', groupJid, 'conflicting@lid', 'conflicting', '在群', 0, 1, ''],
      ['default', otherGroup, 'other-group@lid', 'trusted', '在群', 0, 1, ''],
      ['account-b', groupJid, 'foreign-account@lid', 'trusted', '在群', 0, 1, ''],
    ];
    for (const [account, jid, member, customerId, status, locked, confidence, reason] of rows) relation.run(account + member, account, jid, member, '', customerId, status, locked, confidence, reason, now, now, now, now);
    const member = db.prepare(`INSERT INTO ws_group_members(id,account_id,group_jid,member_jid,display_name,role,status,source,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
    member.run('stale-detail', 'default', groupJid, 'locked@lid', 'Observed name', 'admin', 'active', 'ws-native-group-monitor', '{"customerId":"deleted"}', now, '2026-11-19T11:00:00.000Z');
    member.run('detail-only', 'default', groupJid, 'detail-only@lid', 'Unlinked observed member', 'member', 'unknown', 'ws-native-group-monitor', '{"customerId":"trusted"}', now, now);
    for (const accountId of ['default', 'account-b']) db.prepare(`INSERT INTO ws_group_messages(id,account_id,group_jid,message_id,sent_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`).run(accountId + '-message', accountId, groupJid, accountId + '-message', now, now, now);
    db.prepare(`INSERT INTO ws_group_read_evidence(id,account_id,group_jid,message_id,member_jid,status,evidence_source,evidence_ref,observed_at,created_at,updated_at)
      VALUES('claimed-read','default',?,'default-message','native-only@lid','read','caller-claim','not-a-verified-receipt',?,?,?)`).run(groupJid, now, now, now);
    for (const [accountId, jid] of [['default', groupJid], ['default', otherGroup], ['account-b', groupJid]]) {
      db.prepare('INSERT INTO ws_group_sync_errors(id,account_id,group_jid,run_id,operation,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
        .run(accountId + jid, accountId, jid, accountId + jid, 'saved-native-observation', now, now);
    }
  } finally { db.close(); }
}

function snapshot(root) {
  const db = new DatabaseSync(path.join(root, 'workspace.sqlite'), { readOnly: true });
  try { return tables.map(table => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY id').all()]); }
  finally { db.close(); }
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-production-group-read-'));
  let child, closed;
  try {
    seed(root);
    const port = await freePort(), origin = 'http://127.0.0.1:' + port, token = randomBytes(24).toString('hex');
    child = spawn(process.execPath, ['server.mjs'], { cwd: app, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: {
      ...process.env, ZHIKE_DATA_DIR: root, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token,
      ZHIKE_PARENT_PID: '', ZHIKE_GROUP_MANAGER_MODE: '', ZHIKE_STAGE3_MOCK: '', ZHIKE_AI_PIPELINE_MODE: '', ZHIKE_STAGE4_MOCK: '', ZHIKE_FENCING_MODE: '',
    } });
    closed = new Promise(resolve => child.once('close', resolve));
    const observation = observeSidecarStartup(child, { secrets: [token] });
    const request = async (route, init = {}) => {
      const response = await fetch(origin + route, { signal: AbortSignal.timeout(5000), ...init, headers: { origin, 'x-zhike-api-token': token, 'content-type': 'application/json', ...init.headers } });
      return { status: response.status, body: await response.json() };
    };
    const url = (suffix, query = {}) => '/api/ws/group-manager/' + suffix + '?' + new URLSearchParams({ accountId: 'default', ...query });
    assert.equal((await requestWithStartupDiagnostics(() => request('/api/health'), observation)).status, 200);
    const before = snapshot(root);
    const groups = await request(url('groups'));
    assert.equal(groups.status, 200, 'production must serve the saved native group catalog');
    assert.equal(groups.body.groups.length, 2);
    const all = await request(url('members'));
    assert.equal(all.status, 200);
    assert.equal(all.body.readOnly, true);
    assert.equal(all.body.coverage, 'observed-local-memberships');
    assert.equal(all.body.members.length, 7);
    assert.equal(new Set(all.body.members.map(row => row.groupJid + row.memberJid)).size, 7);
    const members = new Map(all.body.members.map(row => [row.memberJid, row]));
    assert.equal(members.get('locked@lid').status, 'removed', 'newer optional details cannot override a manual ledger decision');
    assert.equal(members.get('locked@lid').manualLocked, true);
    assert.equal(members.get('locked@lid').customerId, 'trusted');
    assert.equal(members.get('locked@lid').data.customerId, 'trusted');
    assert.equal(members.get('locked@lid').displayName, 'Observed name');
    assert.equal(members.get('native-only@lid').source, 'membership-ledger');
    assert.equal(members.get('native-only@lid').customerId, 'trusted');
    for (const key of ['unverified@lid', 'deleted@lid', 'conflicting@lid', 'detail-only@lid']) assert.equal(members.get(key).customerId, '', key + ' must not gain a CRM identity from untrusted data');
    const scoped = await request(url('members', { groupJid }));
    assert.equal(scoped.body.members.length, 6);
    assert.ok(scoped.body.members.every(row => row.accountId === 'default' && row.groupJid === groupJid));
    const foreign = await request(url('members', { accountId: 'account-b', groupJid }));
    assert.deepEqual(foreign.body.members.map(row => row.memberJid), ['foreign-account@lid']);
    assert.equal((await request(url('members', { limit: '1' }))).body.members.length, 1);
    const state = await request(url('state', { groupJid }));
    assert.deepEqual(state.body.members, scoped.body.members);
    assert.equal(state.body.readEvidence[0].status, 'unknown');
    assert.equal(state.body.readEvidence[0].claimedStatus, 'read');
    assert.equal(state.body.readEvidence[0].verified, false);
    for (const suffix of ['sync', 'audit', 'errors', 'messages', 'read-evidence', 'customer-reading/capability']) assert.equal((await request(url(suffix, { groupJid }))).status, 200, suffix);
    assert.equal((await request(url('errors'))).body.errors.length, 2);
    assert.deepEqual((await request(url('errors', { groupJid }))).body.errors.map(row => row.groupJid), [groupJid]);
    const reading = await request(url('customer-reading', { groupJid, messageId: 'default-message' }));
    assert.equal(reading.status, 200);
    assert.ok(reading.body.rows.some(row => row.memberId === 'native-only@lid' && row.customer.id === 'trusted'));
    assert.ok(reading.body.rows.every(row => row.status === 'unknown'));
    assert.equal(reading.body.messages[0].confirmedReadMembers, 0);
    assert.equal(reading.body.messages[0].confirmedUnreadMembers, null);
    assert.equal(reading.body.messages[0].readRate.value, null);
    assert.equal((await request(url('customer-reading/export', { groupJid, messageId: 'default-message' }))).status, 200);
    assert.equal((await request(url('customer-reading', { accountId: 'account-b', groupJid, messageId: 'default-message' }))).status, 404);
    for (const query of [{ accountId: '' }, { accountId: ' default' }, { groupJid: '../bad' }, { limit: '1.5' }]) assert.equal((await request(url('members', query))).status, 400);
    assert.equal((await request('/api/ws/group-manager/members')).status, 400);
    assert.equal((await request(url('members') + '&accountId=account-b')).status, 400);
    assert.equal((await request(url('members', { accountId: 'missing' }))).status, 404);
    assert.equal((await request(url('members', { groupJid: 'missing@g.us' }))).status, 404);
    assert.equal((await request(url('not-a-read-route'))).status, 404);
    assert.equal((await request(url('members'), { headers: { 'x-zhike-api-token': 'invalid' } })).status, 401);
    assert.equal((await request(url('members'), { headers: { origin: 'https://invalid.example' } })).status, 403);
    for (const suffix of ['groups', 'members', 'messages', 'sync', 'sync/saved-run', 'read-evidence', 'errors']) {
      const denied = await request(url(suffix), { method: 'POST', body: JSON.stringify({ groupJid }) });
      assert.equal(denied.status, 405, suffix);
      assert.equal(denied.body.code, 'GROUP_MANAGER_WRITE_DISABLED');
    }
    assert.deepEqual(snapshot(root), before, 'reads and rejected mock writes must leave durable business/queue data unchanged');
    console.log('production group manager: native ledger visibility, authority/locks, account/group scope, truthful reading, mock write denial and zero read mutations PASS');
  } finally {
    if (child && child.exitCode == null && child.signalCode == null) child.kill();
    if (closed) await closed;
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
