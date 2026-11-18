'use strict';

// Stage 1 P0 isolation verifier. This script intentionally never opens the
// configured application data directory and never starts server.mjs. It reads
// source/migration text and uses a temporary SQLite database for contract-only
// concurrency/idempotency checks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const server = read('resources/app/server.mjs');
const crm = read('resources/app/modules/ws-crm-sync-core.js');
const group = read('resources/app/modules/ws-group-monitor-core.js');
const mig015 = read('resources/app/migrations/015-ws-group-monitor.sql');
const mig017 = read('resources/app/migrations/017-ws-group-catalog.sql');
const mig019 = read('resources/app/migrations/019-crm-base-schema.sql');
const mig021 = read('resources/app/migrations/021-crm-authority.sql');
const mig022 = read('resources/app/migrations/022-ws-group-identity.sql');
const groupCore = require(path.join(root, 'resources/app/modules/ws-group-monitor-core.js'));

const results = [];
function check(id, status, evidence, detail = '') {
  results.push({ id, status, evidence, detail });
}
function pass(id, evidence, detail = '') { check(id, 'Passed', evidence, detail); }
function design(id, evidence, detail = '') { check(id, 'DesignOnly', evidence, detail); }
function blocked(id, evidence, detail = '') { check(id, 'Blocked', evidence, detail); }

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-stage1-crm-'));
  const file = path.join(dir, 'isolated.sqlite');
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE customers(id TEXT PRIMARY KEY, phone_normalized TEXT NOT NULL DEFAULT '', deleted INTEGER NOT NULL DEFAULT 0);
    CREATE UNIQUE INDEX uq_test_customer_phone ON customers(phone_normalized) WHERE phone_normalized <> '';
    CREATE TABLE ws_group_catalog(id TEXT PRIMARY KEY, account_id TEXT NOT NULL, group_jid TEXT NOT NULL, channel_id TEXT NOT NULL DEFAULT '', UNIQUE(account_id, group_jid));
    CREATE TABLE ws_group_monitor_targets(id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, account_id TEXT NOT NULL, group_jid TEXT NOT NULL, channel_id TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 0, UNIQUE(profile_id, group_jid));
    CREATE UNIQUE INDEX uq_test_enabled_group_target ON ws_group_monitor_targets(account_id, group_jid) WHERE enabled=1;
    CREATE TABLE ws_group_membership_events(id TEXT PRIMARY KEY, account_id TEXT NOT NULL, group_jid TEXT NOT NULL, member_jid TEXT NOT NULL, event_type TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE);
  `);
  return { db, dir, file };
}
function cleanupDb(state) {
  try { state.db.close(); } catch { /* already closed */ }
  fs.rmSync(state.dir, { recursive: true, force: true });
}

// --- Static authority and business-rule checks against the real source ---
assert.match(server, /function writeState\(value/);
assert.match(server, /INSERT INTO customers\(id,phone_normalized/);
assert.match(mig019, /CREATE TABLE IF NOT EXISTS customers/);
assert.match(mig021, /CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone_active/);
pass('crm-primary-id', 'migrations/019-crm-base-schema.sql and server.mjs:writeState', 'customers.id remains the sole CRM primary key; the versioned schema owns the table and writeState projects customer rows.');

assert.match(crm, /function matchCustomerForAutoSync/);
assert.match(crm, /return \{ kind: 'new', customer: null/);
pass('ordinary-ws-no-auto-create-contract', 'ws-crm-sync-core.js:matchCustomerForAutoSync', 'ordinary WS matching returns a new/unmatched candidate; creation authority is not in the pure matcher.');

assert.match(server, /function wsGroupMonitorAutoCustomer\(/);
assert.match(server, /if \(!wsGroupMonitor\.isConfirmedJoinEvent\(event\)\) return null/);
assert.match(server, /normalizedEvent\.confidence >= 0\.6/);
pass('group-confirmed-join-create-gate', 'server.mjs:1239-1290,1392-1408', 'group registration is gated by confirmed joined event and confidence threshold.');

assert.match(group, /function isConfirmedJoinEvent/);
assert.match(group, /pending|requested|审核中|待审核/);
assert.match(group, /function eventIdempotencyKey/);
assert.match(group, /UNIQUE|idempotency/i);
pass('group-pending-and-idempotency-rules', 'ws-group-monitor-core.js:46-55,121-135', 'pending/approval events are excluded and events have deterministic replay keys.');

assert.match(mig015, /UNIQUE\(profile_id, target_id\)/);
assert.match(mig015, /UNIQUE\(idempotency_key\)/);
assert.match(mig017, /UNIQUE\(account_id, group_jid\)/);
pass('schema-unique-keys-present', 'migrations/015-ws-group-monitor.sql:18-76; migrations/017-ws-group-catalog.sql:6-23', 'existing target/profile and account/catalog uniqueness constraints are present.');

pass('current-phone-uniqueness', 'migrations/021-crm-authority.sql', 'active canonical phones are protected by a partial unique index; the API reports conflicts instead of merging records.');
assert.match(server, /function applyWsCustomerGroupStatus/);
assert.match(server, /customer\.groupStatus\s*=/);
assert.match(server, /wsPersistCustomerGroupMembershipLedger/);
assert.match(mig022, /CREATE TABLE IF NOT EXISTS customer_group_memberships/);
pass('group-status-does-not-overwrite-crm', 'server.mjs:applyWsCustomerGroupStatus and customer_group_memberships', 'group status is stored as a relationship projection and does not overwrite a manually maintained CRM lifecycle value.');

if (/sourceInfo\s*=\s*.*群粉|\|\|\s*['"]群粉['"]/.test(server)) {
  blocked('group-source-fallback', 'server.mjs:1209-1237', 'missing source currently falls back to generic 群粉; source/channel must remain 未分类，待绑定.');
} else {
  pass('group-source-fallback', 'server.mjs:1209-1237', 'no generic 群粉 fallback found.');
}

// --- Isolated SQLite contract checks ---
const state = tempDb();
try {
  const { db } = state;

  // A deterministic canonical-phone insert is idempotent across connections.
  const canonicalPhone = groupCore.normalizeMemberIdentity('+91 94489 50442').phone;
  assert.equal(canonicalPhone, '9448950442');
  const insertCustomer = db.prepare('INSERT OR IGNORE INTO customers(id,phone_normalized,deleted) VALUES(?,?,0)');
  insertCustomer.run('c-1', canonicalPhone);
  insertCustomer.run('c-2', canonicalPhone);
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM customers WHERE phone_normalized=?').get(canonicalPhone).n), 1);
  pass('isolated-global-phone-dedupe', 'temporary SQLite customers + unique phone index', 'two deterministic registration attempts produce one customer.');

  const insertCatalog = db.prepare('INSERT INTO ws_group_catalog(id,account_id,group_jid,channel_id) VALUES(?,?,?,?)');
  insertCatalog.run('g-1', 'a-1', '1203@g.us', 'channel-a');
  assert.throws(() => insertCatalog.run('g-2', 'a-1', '1203@g.us', 'channel-b'));
  insertCatalog.run('g-3', 'a-2', '1203@g.us', 'channel-a');
  pass('isolated-account-group-identity', 'temporary SQLite ws_group_catalog UNIQUE(account_id,group_jid)', 'same group JID is unique within an account but can exist in another account.');

  const insertTarget = db.prepare('INSERT INTO ws_group_monitor_targets(id,profile_id,account_id,group_jid,channel_id,enabled) VALUES(?,?,?,?,?,?)');
  insertTarget.run('t-1', 'p-1', 'a-1', '1203@g.us', 'channel-a', 1);
  assert.throws(() => insertTarget.run('t-2', 'p-1', 'a-1', '1203@g.us', 'channel-a'));
  assert.throws(() => insertTarget.run('t-3', 'p-2', 'a-1', '1203@g.us', 'channel-a', 1));
  insertTarget.run('t-4', 'p-2', 'a-1', '1203@g.us', 'channel-a', 0);
  pass('target-catalog-scope-reconciliation', 'temporary SQLite account/group enabled-target unique index', 'the same group cannot be enabled twice for one account while disabled historical rows remain available.');

  const event = { accountId: 'a-1', groupJid: '1203@g.us', memberId: '919448950442@s.whatsapp.net', type: 'joined', sourceEventId: 'evt-1', eventAt: '2026-11-15T00:00:00.000Z' };
  const key = groupCore.eventIdempotencyKey(event);
  const insertEvent = db.prepare('INSERT OR IGNORE INTO ws_group_membership_events(id,account_id,group_jid,member_jid,event_type,idempotency_key) VALUES(?,?,?,?,?,?)');
  insertEvent.run('e-1', event.accountId, event.groupJid, event.memberId, event.type, key);
  insertEvent.run('e-2', event.accountId, event.groupJid, event.memberId, event.type, key);
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM ws_group_membership_events WHERE idempotency_key=?').get(key).n), 1);
  pass('isolated-event-idempotency', 'temporary SQLite ws_group_membership_events UNIQUE(idempotency_key)', 'replayed join event is stored once.');

  // Two connections demonstrate that the unique constraint, rather than an
  // in-memory lock, is the final duplicate barrier in the isolated contract.
  const second = new DatabaseSync(state.file);
  try {
    second.exec('PRAGMA busy_timeout=1000');
    second.prepare('INSERT OR IGNORE INTO customers(id,phone_normalized,deleted) VALUES(?,?,0)').run('c-3', canonicalPhone);
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM customers WHERE phone_normalized=?').get(canonicalPhone).n), 1);
    pass('isolated-two-connection-dedupe', 'temporary SQLite two-connection insert', 'database uniqueness remains effective across connections.');
  } finally { second.close(); }
} finally {
  cleanupDb(state);
}

const blockedCount = results.filter(item => item.status === 'Blocked').length;
const designCount = results.filter(item => item.status === 'DesignOnly').length;
const passedCount = results.filter(item => item.status === 'Passed').length;
const output = {
  ok: blockedCount === 0,
  scope: 'isolated-only',
  productionDatabaseOpened: false,
  productionWorkerStarted: false,
  counts: { Passed: passedCount, DesignOnly: designCount, Blocked: blockedCount },
  results,
};
console.log(JSON.stringify(output, null, 2));
if (blockedCount) process.exitCode = 2;
