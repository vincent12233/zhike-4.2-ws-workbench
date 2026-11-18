'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations } = require('../resources/app/migration-runner.cjs');
const { unpackDevicePackage } = require('../resources/app/device-migration-package.cjs');
const {
  exportDeviceMigrationSnapshot, validateDeviceMigrationSnapshot,
  projectDeviceMigrationPackageV1, writeDeviceMigrationPackageV1,
} = require('../resources/app/device-migration-snapshot.cjs');

const migrations = join(__dirname, '../resources/app/migrations');
const time = '2026-11-18T00:00:00.000Z';
const mediaId = 'wsm-fixture-123456789a';
const evidence = Buffer.from('synthetic attachment');
const digest = createHash('sha256').update(evidence).digest('hex');

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'zhike-device-snapshot-'));
  const databasePath = join(root, 'workspace.sqlite');
  const db = new DatabaseSync(databasePath);
  t.after(() => {
    db.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  });
  runMigrations({ db, dbPath: databasePath, migrationDir: migrations,
    manifestPath: join(migrations, 'manifest.json'), backupDir: join(root, 'backups'),
    lockPath: join(root, 'migration.lock') });
  return { root, databasePath, db };
}

function insert(db, table, fields) {
  const columns = Object.keys(fields);
  db.prepare('INSERT INTO ' + table + '(' + columns.join(',') + ') VALUES(' +
    columns.map(() => '?').join(',') + ')').run(...Object.values(fields));
}

function populate({ root, db }) {
  const dates = { created_at: time, updated_at: time };
  const customer = { id: 'customer-1', name: 'Fixture Customer', phone: '15550001001', phase: '跟进', deleted: false };
  const crm = {
    schemaVersion: 4, customers: [customer], tickets: [{ id: 'ticket-1', customerId: customer.id }],
    channelAliases: { old: 'new' }, qualityDecisions: { 'decision-1': 'approved' },
    settings: { workspaceName: 'Synthetic migration fixture', profileAvatar: 'excluded-avatar' },
  };
  insert(db, 'app_state', { id: 1, json: JSON.stringify(crm), updated_at: time, revision: 8 });
  insert(db, 'state_snapshots', { id: 1, created_at: time, reason: 'synthetic baseline', json: JSON.stringify(crm) });
  insert(db, 'customers', { id: customer.id, phone_normalized: customer.phone, name: customer.name,
    stage: customer.phase, data_json: JSON.stringify(customer) });
  insert(db, 'crm_identity_conflicts', { id: 'conflict-1', canonical_phone: customer.phone,
    customer_ids_json: JSON.stringify([customer.id]), ...dates });
  insert(db, 'ws_accounts', { id: 'native-b', display_name: 'Fixture B', origin: 'file:///C:/private',
    partition_key: 'private-partition', ...dates });
  insert(db, 'ws_account_settings', { account_id: 'native-b', settings_json: JSON.stringify({
    retention: 7, arbitrary: { 'aＰＩ-key': 'remove-key', cookie: 'remove-cookie', maxTokens: 300 },
    nested: JSON.stringify({ refreshToken: 'remove-token', setting: 'portable' }),
  }), ...dates });
  insert(db, 'ws_conversations', { id: 'conversation-1', account_id: 'native-b', external_id: 'fixture-chat',
    title: 'Fixture B chat', customer_id: customer.id, ...dates });
  insert(db, 'ws_conversations', { id: 'old-chat', account_id: 'default', external_id: 'fixture-chat',
    title: 'Fixture A chat', ...dates });
  insert(db, 'ws_messages', { id: 'message-1', account_id: 'native-b', conversation_id: 'conversation-1',
    external_id: 'fixture-message', direction: 'receive', original_text: 'synthetic business message', ...dates });
  insert(db, 'ws_media_assets', { id: mediaId, account_id: 'native-b', conversation_id: 'conversation-1',
    message_id: 'message-1', file_name: 'fixture.txt', size_bytes: evidence.length, sha256: digest,
    storage_path: 'ws-media\\native-b\\' + mediaId, ...dates });
  insert(db, 'ws_media_assets', { id: 'missing-media', account_id: 'native-b', conversation_id: 'conversation-1',
    status: 'unavailable', unavailable_reason: 'not captured', ...dates });
  mkdirSync(join(root, 'ws-media', 'native-b'), { recursive: true });
  writeFileSync(join(root, 'ws-media', 'native-b', mediaId), evidence);
  insert(db, 'ws_send_audit', { id: 'audit-1', account_id: 'native-b', conversation_id: 'conversation-1',
    idempotency_key: 'save-idempotency', status: 'sending', payload_kind: 'media', attachment_ids_json: JSON.stringify([mediaId]),
    native_result_json: JSON.stringify({ sendAttempt: { id: 'attempt-unknown', phase: 'prepared',
      deliveryState: 'unknown', safeToRetry: false, observedUnknown: false, createdAt: time, updatedAt: time } }), ...dates });
  insert(db, 'ws_send_attachments', { id: 'attachment-audit-1', account_id: 'native-b', send_audit_id: 'audit-1',
    media_id: mediaId, data_json: JSON.stringify({ sendAttempt: { id: 'attempt-unknown',
      deliveryState: 'unknown', phase: 'prepared' } }), ...dates });
  insert(db, 'hot_chat_profiles', { id: 'hot-1', customer_id: customer.id, account_id: 'native-b',
    conversation_id: 'conversation-1', manual_locked: 1, ...dates });
  insert(db, 'hot_chat_profile_fields', { id: 'field-1', profile_id: 'hot-1', field_key: 'topic',
    value_json: '"fixture topic"', manual_locked: 1, ...dates });
  insert(db, 'hot_chat_events', { id: 'hot-event-1', profile_id: 'hot-1', account_id: 'native-b',
    event_type: 'update', source: 'fixture', idempotency_key: 'event-key', created_at: time });
  insert(db, 'hot_chat_sync_outbox', { id: 'outbox-1', profile_id: 'hot-1', account_id: 'native-b',
    event_id: 'hot-event-1', operation: 'sync', ...dates });
  insert(db, 'ws_group_monitor_profiles', { id: 'monitor-1', account_id: 'native-b', slot_key: 'fixture', ...dates });
  insert(db, 'ws_group_monitor_targets', { id: 'target-1', profile_id: 'monitor-1', account_id: 'native-b',
    group_jid: 'fixture-group@g.us', ...dates });
  insert(db, 'ws_group_membership_events', { id: 'join-1', profile_id: 'monitor-1', account_id: 'native-b',
    target_id: 'target-1', group_jid: 'fixture-group@g.us', member_jid: '15550001001@s.whatsapp.net',
    customer_id: customer.id, event_type: 'joined', observed_at: time, idempotency_key: 'join-key',
    correlation_id: 'fixture-correlation', ...dates });
  insert(db, 'customer_group_memberships', { id: 'membership-1', account_id: 'native-b',
    group_jid: 'fixture-group@g.us', member_jid: '15550001001@s.whatsapp.net', customer_id: customer.id,
    last_event_id: 'join-1', manual_locked: 1, ...dates });
  insert(db, 'ws_group_members', { id: 'group-member-1', account_id: 'native-b', group_jid: 'fixture-group@g.us',
    member_jid: '15550001001@s.whatsapp.net', manual_locked: 1, ...dates });
  insert(db, 'ws_group_messages', { id: 'group-message-1', account_id: 'native-b', group_jid: 'fixture-group@g.us',
    message_id: 'group-platform-message', ...dates });
  insert(db, 'ws_group_read_evidence', { id: 'read-1', account_id: 'native-b', group_jid: 'fixture-group@g.us',
    message_id: 'group-platform-message', status: 'unknown', observed_at: time, ...dates });
  insert(db, 'ws_group_audit', { id: 'group-audit-1', account_id: 'native-b', group_jid: 'fixture-group@g.us',
    action: 'inspect', created_at: time });
  insert(db, 'ai_jobs', { id: 'job-1', account_id: 'native-b', conversation_id: 'conversation-1',
    idempotency_key: 'job-key', status: 'running', next_attempt_at: time, lease_token: 'lease-secret',
    fencing_token: 4, worker_owner_id: 'machine-worker', correlation_id: 'fixture-correlation', ...dates });
  insert(db, 'ai_job_evidence', { id: 'job-evidence-1', account_id: 'native-b', job_id: 'job-1',
    quote: 'portable fixture evidence', correlation_id: 'fixture-correlation', created_at: time });
  insert(db, 'ai_crm_suggestions', { id: 'suggestion-1', account_id: 'native-b', job_id: 'job-1',
    idempotency_key: 'suggestion-key', customer_id: customer.id, field_name: 'note',
    verification_status: 'rejected', correlation_id: 'fixture-correlation', ...dates });
  insert(db, 'ai_task_audit', { id: 'job-audit-1', account_id: 'native-b', job_id: 'job-1',
    action: 'claim', correlation_id: 'fixture-correlation', created_at: time });
}

test('projects all reviewed tables from the real 025 shape without machine columns or modifying the source', t => {
  const fx = fixture(t);
  populate(fx);
  const before = readFileSync(fx.databasePath);
  const snapshot = exportDeviceMigrationSnapshot(fx.databasePath);
  const originalTables = fx.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*'").all()
    .map(row => row.name).filter(name => name !== 'schema_migrations').sort();
  assert.deepEqual(Object.keys(snapshot.tables).sort(), originalTables);
  assert.equal(originalTables.length, 42);
  assert.equal(snapshot.coverage.status, 'partial');
  assert.equal(snapshot.coverage.nestedFieldsWithheld, 5);
  assert.equal(snapshot.coverage.mediaBytes, 'not-in-snapshot');
  const { tables } = snapshot;
  assert.equal(tables.app_state[0].revision, 8);
  assert.equal(tables.app_state[0].json.channelAliases.old, 'new');
  assert.equal(tables.app_state[0].json.qualityDecisions['decision-1'], 'approved');
  assert.equal(tables.crm_identity_conflicts[0].canonical_phone, '15550001001');
  assert.equal(tables.hot_chat_profile_fields[0].manual_locked, 1);
  assert.equal(tables.hot_chat_sync_outbox[0].event_id, 'hot-event-1');
  assert.equal(tables.customer_group_memberships[0].last_event_id, 'join-1');
  assert.equal(tables.ws_group_membership_events[0].correlation_id, 'fixture-correlation');
  assert.equal(tables.ws_group_members[0].manual_locked, 1);
  assert.equal(tables.ws_group_read_evidence[0].status, 'unknown');
  assert.equal(tables.ws_group_audit[0].action, 'inspect');
  assert.equal(tables.ai_jobs[0].status, 'running');
  for (const table of ['ai_job_evidence', 'ai_crm_suggestions', 'ai_task_audit']) {
    assert.equal(tables[table][0].correlation_id, 'fixture-correlation');
  }
  assert.equal(tables.ai_crm_suggestions[0].verification_status, 'rejected');
  assert.equal(tables.ws_send_audit[0].native_result_json.sendAttempt.safeToRetry, false);
  assert.equal(tables.ws_send_attachments[0].data_json.sendAttempt.deliveryState, 'unknown');
  const encoded = JSON.stringify(snapshot);
  assert.doesNotMatch(encoded, /private-partition|file:\/\/\/C:|lease-secret|machine-worker|excluded-avatar|remove-(?:key|cookie|token)|ws-media/);
  assert.equal(tables.ws_account_settings.find(row => row.account_id === 'native-b').settings_json.arbitrary.maxTokens, 300);
  assert.doesNotThrow(() => validateDeviceMigrationSnapshot(JSON.parse(encoded)));
  assert.deepEqual(readFileSync(fx.databasePath), before);
});

test('a concurrent WAL write cannot mix workspace and WS generations', t => {
  const fx = fixture(t);
  populate(fx);
  fx.db.exec('PRAGMA journal_mode=WAL');
  const original = DatabaseSync.prototype.prepare;
  let wrote = false;
  DatabaseSync.prototype.prepare = function (sql) {
    if (this !== fx.db && sql.includes(' FROM "ws_accounts" ') && !wrote) {
      wrote = true;
      fx.db.exec(`BEGIN IMMEDIATE;
        UPDATE app_state SET revision=9 WHERE id=1;
        UPDATE ws_accounts SET display_name='Fixture generation 9' WHERE id='native-b';
        COMMIT;`);
    }
    return original.call(this, sql);
  };
  let old;
  try {
    old = exportDeviceMigrationSnapshot(fx.databasePath);
  } finally {
    DatabaseSync.prototype.prepare = original;
  }
  assert.equal(wrote, true);
  assert.equal(old.tables.app_state[0].revision, 8);
  assert.equal(old.tables.ws_accounts.find(row => row.id === 'native-b').display_name, 'Fixture B');
  const next = exportDeviceMigrationSnapshot(fx.databasePath);
  assert.equal(next.tables.app_state[0].revision, 9);
  assert.equal(next.tables.ws_accounts.find(row => row.id === 'native-b').display_name, 'Fixture generation 9');
});

test('validator rejects forged coverage, unexpected fields, broken scope and unsafe send state', t => {
  const fx = fixture(t);
  populate(fx);
  const baseline = exportDeviceMigrationSnapshot(fx.databasePath);
  for (const [code, mutate] of [
    ['SNAPSHOT_COVERAGE', s => { s.coverage.status = 'complete'; }],
    ['SNAPSHOT_COVERAGE', s => { s.coverage.tableRows.ws_send_audit = 0; }],
    ['SNAPSHOT_FORMAT', s => { delete s.tables.ws_group_members; }],
    ['SNAPSHOT_FORMAT', s => { s.tables.ai_jobs[0].lease_token = 'injected'; }],
    ['SNAPSHOT_FORMAT', s => { s.tables.ws_group_members.push(s.tables.ws_group_members[0]); }],
    ['SNAPSHOT_SCOPE', s => { s.tables.ws_group_members[0].account_id = 'missing'; }],
    ['SNAPSHOT_RELATION', s => { s.tables.ws_send_attachments[0].account_id = 'default'; }],
    ['SNAPSHOT_RELATION', s => { s.tables.ws_send_attachments[0].media_id = 'missing-asset'; }],
    ['SNAPSHOT_RELATION', s => { s.tables.ws_messages[0].conversation_id = 'old-chat'; }],
    ['SNAPSHOT_RELATION', s => { s.tables.app_state[0].json.customers[0].name = 'mixed revision'; }],
    ['SNAPSHOT_SEND', s => { s.tables.ws_send_audit[0].native_result_json.sendAttempt.safeToRetry = true; }],
    ['SNAPSHOT_SEND', s => { delete s.tables.ws_send_audit[0].native_result_json.sendAttempt; }],
    ['SNAPSHOT_SEND', s => { s.tables.ws_send_audit[0].attachment_ids_json = ['attachment-audit-1']; }],
    ['SNAPSHOT_PRIVATE', s => { s.tables.ai_jobs[0].payload_json.cookie = 'opaque'; }],
    ['SNAPSHOT_PRIVATE', s => { s.tables.ws_messages[0].original_text = 'C:\\Users\\private\\fixture'; }],
    ['SNAPSHOT_PRIVATE', s => { s.tables.ws_messages[0].original_text = '/home/用户名/文件'; }],
    ['SNAPSHOT_PRIVATE', s => { s.tables.ws_messages[0].original_text = 'Authorization: Bearer opaque-key-string'; }],
    ['SNAPSHOT_PRIVATE', s => { s.tables.ws_messages[0].data_json.nested = '{"apiKey":"hidden"}'; }],
  ]) {
    const candidate = JSON.parse(JSON.stringify(baseline));
    mutate(candidate);
    assert.throws(() => validateDeviceMigrationSnapshot(candidate), { code });
  }
});

test('unknown schema, malformed JSON, real SQLite orphans and non-canonical media fail closed', t => {
  const fx = fixture(t);
  populate(fx);
  fx.db.exec('PRAGMA user_version=24');
  assert.throws(() => exportDeviceMigrationSnapshot(fx.databasePath), { code: 'SNAPSHOT_SCHEMA' });
  fx.db.exec('PRAGMA user_version=25; ALTER TABLE ws_accounts ADD COLUMN unknown_machine_field TEXT');
  assert.throws(() => exportDeviceMigrationSnapshot(fx.databasePath), { code: 'SNAPSHOT_SCHEMA' });
  fx.db.exec("ALTER TABLE ws_accounts DROP COLUMN unknown_machine_field; UPDATE ws_messages SET data_json='broken JSON'");
  assert.throws(() => exportDeviceMigrationSnapshot(fx.databasePath), { code: 'SNAPSHOT_FORMAT' });
  fx.db.exec("UPDATE ws_messages SET data_json='{}'");
  fx.db.prepare("UPDATE ws_media_assets SET storage_path=? WHERE status='ready'").run('C:\\private\\some-file');
  assert.throws(() => exportDeviceMigrationSnapshot(fx.databasePath), { code: 'SNAPSHOT_MEDIA' });
  fx.db.prepare("UPDATE ws_media_assets SET storage_path=? WHERE status='ready'").run('ws-media/native-b/' + mediaId);
  fx.db.exec("PRAGMA foreign_keys=OFF; UPDATE ws_messages SET conversation_id='missing'");
  assert.throws(() => exportDeviceMigrationSnapshot(fx.databasePath), { code: 'SNAPSHOT_RELATION' });
});

test('compatibility projection uses the authenticated v1 engine and preserves honest partial coverage', async t => {
  const fx = fixture(t);
  populate(fx);
  const snapshot = exportDeviceMigrationSnapshot(fx.databasePath);
  const projected = projectDeviceMigrationPackageV1(snapshot);
  assert.equal(projected.snapshot.crm.channelAliases, undefined);
  assert.equal(projected.snapshot.crm.qualityDecisions, undefined);
  assert.equal(projected.snapshot.wsAccounts.default.messages.length, 0);
  assert.equal(projected.snapshot.wsAccounts['native-b'].messages[0].originalText, 'synthetic business message');
  assert.equal(projected.snapshot.wsAccounts['native-b'].sendAudit[0].nativeResult.sendAttempt.deliveryState, 'unknown');
  const destination = join(fx.root, 'test.zkdevice');
  const password = 'temporary fixture package password';
  await writeDeviceMigrationPackageV1({ databasePath: fx.databasePath, destination, password });
  const unpacked = await unpackDevicePackage({ source: destination, password, stagingParent: fx.root });
  const decoded = JSON.parse(readFileSync(unpacked.snapshotPath, 'utf8'));
  assert.deepEqual(readFileSync(unpacked.media[0].path), evidence);
  assert.equal(unpacked.manifest.coverage.status, 'partial');
  assert.deepEqual(unpacked.manifest.coverage.media, { included: 1, missingReady: 0, otherIndexed: 1 });
  assert.equal(decoded.wsAccounts['native-b'].mediaAssets.some(row => row.status === 'unavailable'), true);
  assert.equal(decoded.wsAccounts['native-b'].sendAudit[0].nativeResult.sendAttempt.safeToRetry, false);

  writeFileSync(join(fx.root, 'ws-media', 'native-b', mediaId), Buffer.from('synthetic alter-file'));
  const failed = join(fx.root, 'invalid.zkdevice');
  await assert.rejects(() => writeDeviceMigrationPackageV1({ databasePath: fx.databasePath, destination: failed, password }),
    { code: 'DIGEST' });
  assert.throws(() => readFileSync(failed), { code: 'ENOENT' });
});

test('recognized legacy media-only audit references survive as scoped records', t => {
  const fx = fixture(t);
  populate(fx);
  insert(fx.db, 'ws_send_audit', { id: 'legacy-audit-1', account_id: 'native-b', conversation_id: 'conversation-1',
    status: 'sent', attachment_ids_json: JSON.stringify([mediaId]), created_at: time, updated_at: time });
  const snapshot = exportDeviceMigrationSnapshot(fx.databasePath);
  assert.deepEqual(snapshot.tables.ws_send_audit.find(row => row.id === 'legacy-audit-1').attachment_ids_json, [mediaId]);
  const candidate = structuredClone(snapshot);
  candidate.tables.ws_send_audit.find(row => row.id === 'legacy-audit-1').attachment_ids_json = ['absent-media'];
  assert.throws(() => validateDeviceMigrationSnapshot(candidate), { code: 'SNAPSHOT_SEND' });
});

test('disposable 025 constraint probe can stage the reviewed rows and rolls back on a late natural-key conflict', t => {
  const source = fixture(t);
  populate(source);
  const snapshot = exportDeviceMigrationSnapshot(source.databasePath);
  const target = fixture(t);

  function probe(candidate) {
    validateDeviceMigrationSnapshot(candidate);
    target.db.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON; DELETE FROM ws_accounts');
    try {
      for (const [table, rows] of Object.entries(candidate.tables)) {
        for (const row of rows) {
          const fields = Object.fromEntries(Object.entries(row).map(([key, value]) =>
            [key, key === 'json' || key.endsWith('_json') ? JSON.stringify(value) : value]));
          // This probe uses the target's own layout. It does not copy native
          // credentials, activate a queue or publish any staged files.
          if (table === 'ws_media_assets' && row.status === 'ready') fields.storage_path = 'ws-media/native-b/' + row.id;
          insert(target.db, table, fields);
        }
      }
      assert.deepEqual(target.db.prepare('PRAGMA foreign_key_check').all(), []);
      target.db.exec('COMMIT');
    } catch (error) {
      target.db.exec('ROLLBACK');
      throw error;
    }
  }

  const tampered = structuredClone(snapshot);
  tampered.tables.ws_send_audit.push({ ...tampered.tables.ws_send_audit[0], id: 'collision', attachment_ids_json: [] });
  tampered.coverage.tableRows.ws_send_audit++;
  assert.throws(() => probe(tampered), /UNIQUE constraint failed: ws_send_audit.account_id, ws_send_audit.idempotency_key/);
  assert.equal(target.db.prepare('SELECT COUNT(*) AS count FROM app_state').get().count, 0);
  assert.equal(target.db.prepare('SELECT COUNT(*) AS count FROM ws_accounts').get().count, 1);
  assert.equal(target.db.prepare('SELECT COUNT(*) AS count FROM ws_send_audit').get().count, 0);

  probe(snapshot);
  assert.deepEqual(target.db.prepare('PRAGMA integrity_check').all().map(row => row.integrity_check), ['ok']);
  const restored = exportDeviceMigrationSnapshot(target.databasePath);
  assert.deepEqual(restored.tables, snapshot.tables);
  assert.equal(target.db.prepare('SELECT lease_token,worker_owner_id,fencing_token FROM ai_jobs').get().lease_token, '');
  assert.equal(target.db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 22);
});
