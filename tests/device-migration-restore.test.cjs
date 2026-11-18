'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const { join, basename, dirname } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { before, after, test } = require('node:test');
const { createDeviceMigrationIsolationRoot } = require('../resources/app/device-migration-isolation.cjs');
const { writeDevicePackageV2 } = require('../resources/app/device-migration-package-v2.cjs');
const { exportDeviceMigrationSnapshot } = require('../resources/app/device-migration-snapshot.cjs');
const { runMigrations } = require('../resources/app/migration-runner.cjs');
const restoreModule = require.resolve('../resources/app/device-migration-restore.cjs');
const { initializeDeviceMigrationRestoreTarget, restoreDeviceMigrationV2,
  resumeDeviceMigrationRestore, inspectDeviceMigrationRestore } = require(restoreModule);

const password = 'Synthetic RD09 fixture only';
const time = '2026-11-18T00:00:00.000Z';
const mediaId = 'wsm-fixture-123456789a';
const content = Buffer.from('synthetic attachment');
const hash = value => createHash('sha256').update(value).digest('hex');
let isolationRoot;
let source;
let sourceTables;

function insert(db, table, row) {
  const columns = Object.keys(row);
  db.prepare('INSERT INTO ' + table + '(' + columns.join(',') + ') VALUES (' + columns.map(() => '?').join(',') + ')')
    .run(...Object.values(row));
}

before(async () => {
  isolationRoot = await createDeviceMigrationIsolationRoot();
  const sourceRoot = join(isolationRoot, 'source');
  fs.mkdirSync(sourceRoot);
  const databasePath = join(sourceRoot, 'workspace.sqlite');
  const db = new DatabaseSync(databasePath);
  try {
    runMigrations({ db, dbPath: databasePath, migrationDir: join(__dirname, '../resources/app/migrations'), backup: false });
    const dates = { created_at: time, updated_at: time };
    const customer = { id: 'customer-1', name: 'Fixture Customer', phone: '+91 95550 00101', phase: '跟进', deleted: false };
    const crm = JSON.stringify({ schemaVersion: 4, customers: [customer], tickets: [{ id: 'ticket-1', customerId: customer.id }] });
    insert(db, 'app_state', { id: 1, json: crm, updated_at: time, revision: 8 });
    insert(db, 'state_snapshots', { id: 1, created_at: time, reason: 'synthetic baseline', json: crm });
    insert(db, 'customers', { id: customer.id, phone_normalized: '9555000101', name: customer.name,
      stage: customer.phase, data_json: JSON.stringify(customer) });
    insert(db, 'ws_accounts', { id: 'native-b', display_name: 'Fixture B', origin: 'https://synthetic.invalid',
      partition_key: 'private-partition', status: '已连接', last_status: '已连接', ...dates });
    insert(db, 'ws_conversations', { id: 'conversation-1', account_id: 'native-b', external_id: 'fixture-chat', customer_id: customer.id, ...dates });
    insert(db, 'ws_conversations', { id: 'old-chat', account_id: 'default', external_id: 'fixture-chat', ...dates });
    insert(db, 'ws_messages', { id: 'message-1', account_id: 'native-b', conversation_id: 'conversation-1',
      external_id: 'fixture-message', direction: 'receive', original_text: 'synthetic business message', ...dates });
    insert(db, 'ws_media_assets', { id: mediaId, account_id: 'native-b', conversation_id: 'conversation-1',
      message_id: 'message-1', file_name: 'fixture.txt', size_bytes: content.length, sha256: hash(content),
      storage_path: 'ws-media\\native-b\\' + mediaId, ...dates });
    insert(db, 'ws_media_assets', { id: 'missing-media', account_id: 'native-b', conversation_id: 'conversation-1',
      status: 'unavailable', unavailable_reason: 'not captured', ...dates });
    const assetRoot = join(sourceRoot, 'ws-media', 'native-b');
    fs.mkdirSync(assetRoot, { recursive: true });
    fs.writeFileSync(join(assetRoot, mediaId), content);
    insert(db, 'ws_send_audit', { id: 'audit-1', account_id: 'native-b', conversation_id: 'conversation-1',
      idempotency_key: 'save-idempotency', status: 'sending', payload_kind: 'media', attachment_ids_json: JSON.stringify([mediaId]),
      native_result_json: JSON.stringify({ sendAttempt: { id: 'attempt-unknown', phase: 'prepared',
        deliveryState: 'unknown', safeToRetry: false, observedUnknown: false, createdAt: time, updatedAt: time } }), ...dates });
    insert(db, 'ws_send_attachments', { id: 'attachment-audit-1', account_id: 'native-b', send_audit_id: 'audit-1',
      media_id: mediaId, data_json: JSON.stringify({ sendAttempt: { id: 'attempt-unknown', deliveryState: 'unknown', phase: 'prepared' } }), ...dates });
    insert(db, 'ws_group_monitor_profiles', { id: 'monitor-1', account_id: 'native-b', slot_key: 'fixture', ...dates });
    insert(db, 'ws_group_monitor_targets', { id: 'target-1', profile_id: 'monitor-1', account_id: 'native-b', group_jid: 'fixture@g.us', ...dates });
    insert(db, 'ws_group_membership_events', { id: 'join-1', profile_id: 'monitor-1', account_id: 'native-b', target_id: 'target-1',
      group_jid: 'fixture@g.us', member_jid: '9555000101@s.whatsapp.net', customer_id: customer.id, event_type: 'joined',
      observed_at: time, idempotency_key: 'join-key', correlation_id: 'fixture-correlation', ...dates });
    insert(db, 'customer_group_memberships', { id: 'membership-1', account_id: 'native-b', group_jid: 'fixture@g.us',
      member_jid: '9555000101@s.whatsapp.net', customer_id: customer.id, last_event_id: 'join-1', manual_locked: 1, ...dates });
    insert(db, 'ai_jobs', { id: 'job-1', account_id: 'native-b', conversation_id: 'conversation-1', idempotency_key: 'job-key',
      status: 'running', next_attempt_at: time, lease_token: 'test-lease', fencing_token: 4, worker_owner_id: 'test-worker',
      correlation_id: 'fixture-correlation', ...dates });
    insert(db, 'ai_crm_suggestions', { id: 'suggestion-1', account_id: 'native-b', job_id: 'job-1', idempotency_key: 'suggestion-key',
      customer_id: customer.id, field_name: 'note', verification_status: 'rejected', correlation_id: 'fixture-correlation', ...dates });
    assert.equal(db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get().busy, 0);
    assert.equal(db.prepare('PRAGMA journal_mode=DELETE').get().journal_mode, 'delete');
  } finally {
    db.close();
  }
  sourceTables = exportDeviceMigrationSnapshot(databasePath).tables;
  source = join(isolationRoot, 'fixture.zkdevice');
  await writeDevicePackageV2({ isolationRoot, databasePath, destination: source, password });
});

after(() => {
  if (!isolationRoot) return;
  assert.equal(dirname(isolationRoot), fs.realpathSync.native(tmpdir()));
  assert.match(basename(isolationRoot), /^zhike-rd09-isolated-[A-Za-z0-9]{6}$/);
  assert.equal(fs.realpathSync.native(isolationRoot), isolationRoot);
  fs.rmSync(isolationRoot, { recursive: true, force: true, maxRetries: 3 });
});

async function target(name) {
  const controlRoot = join(isolationRoot, name);
  fs.mkdirSync(controlRoot);
  const options = { isolationRoot, controlRoot, source, password };
  const blank = await initializeDeviceMigrationRestoreTarget(options);
  const baseline = generationPath(options, blank.generationId);
  return { options, blank, baseline, baselineDigest: hash(fs.readFileSync(join(baseline, 'workspace.sqlite'))) };
}

const inspect = options => inspectDeviceMigrationRestore({ ...options, operation: 'inspect' });
const generationPath = (options, id) => join(options.controlRoot, 'generations', id);
const readJson = path => JSON.parse(fs.readFileSync(path, 'utf8'));

function assertBaseline(fixture) {
  assert.equal(hash(fs.readFileSync(join(fixture.baseline, 'workspace.sqlite'))), fixture.baselineDigest);
  assert.equal(exportDeviceMigrationSnapshot(join(fixture.baseline, 'workspace.sqlite')).tables.app_state.length, 0);
  assert.deepEqual(fs.readdirSync(join(fixture.baseline, 'ws-media')), []);
}

test('restores all 42 reviewed tables and derived owners from a real v2 package while keeping execution frozen', async () => {
  const fx = await target('successful');
  const result = await restoreDeviceMigrationV2(fx.options);
  assert.equal(result.phase, 'ACCEPTED');
  assert.equal(result.coverage, 'partial');
  assert.equal(result.tableCount, 42);
  assert.equal(result.mediaCount, 1);
  assert.notEqual(result.generationId, fx.blank.generationId);
  assert.deepEqual(await inspect(fx.options), result);
  const candidate = generationPath(fx.options, result.generationId);
  const databasePath = join(candidate, 'workspace.sqlite');
  assert.deepEqual(exportDeviceMigrationSnapshot(databasePath).tables, sourceTables);
  assert.deepEqual(fs.readFileSync(join(candidate, 'ws-media', 'native-b', mediaId)), content);
  assert.deepEqual(readJson(join(candidate, 'ws-accounts', 'accounts.json')).find(row => row.id === 'native-b'),
    { id: 'native-b', displayName: 'Fixture B', status: '未连接', lastSeen: null, lastKnownStatus: '已连接' });
  assert.equal(readJson(join(candidate, 'freeze.json')).gate, 'frozen');
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const send = db.prepare('SELECT idempotency_key,status,native_result_json FROM ws_send_audit').get();
    assert.equal(send.idempotency_key, 'save-idempotency');
    assert.equal(send.status, 'sending');
    assert.equal(JSON.parse(send.native_result_json).sendAttempt.deliveryState, 'unknown');
    assert.equal(JSON.parse(send.native_result_json).sendAttempt.safeToRetry, false);
    const job = db.prepare('SELECT status,lease_token,fencing_token,worker_owner_id FROM ai_jobs').get();
    assert.deepEqual({ ...job }, { status: 'running', lease_token: '', fencing_token: 0, worker_owner_id: '' });
    const account = db.prepare("SELECT origin,partition_key FROM ws_accounts WHERE id='native-b'").get();
    assert.deepEqual({ ...account }, { origin: '', partition_key: '' });
  } finally {
    db.close();
  }
  assertBaseline(fx);
  assert.deepEqual(fs.readdirSync(join(fx.options.controlRoot, 'staging')), []);
  for (const operation of ['native-queue', 'renderer-open', 'worker', 'ai-claim', 'send-retry', 'outbox', 'group-poll', 'export-resume', 'thaw']) {
    await assert.rejects(inspectDeviceMigrationRestore({ ...fx.options, operation }), { code: 'RESTORE_FROZEN' });
  }
  await assert.rejects(restoreDeviceMigrationV2(fx.options), { code: 'RESTORE_STATE' });
  assert.deepEqual(await resumeDeviceMigrationRestore({ ...fx.options, operationId: result.operationId, decision: 'activate' }), result);
});

test('does not edit an existing workspace or initialize a target with a pending queue', async () => {
  const controlRoot = join(isolationRoot, 'dirty');
  fs.mkdirSync(controlRoot);
  const queue = join(controlRoot, 'pending.json');
  fs.writeFileSync(queue, 'synthetic queue');
  await assert.rejects(initializeDeviceMigrationRestoreTarget({ isolationRoot, controlRoot }), { code: 'RESTORE_LAYOUT' });
  assert.deepEqual(fs.readdirSync(controlRoot), ['pending.json']);
  assert.equal(fs.readFileSync(queue, 'utf8'), 'synthetic queue');
});

test('a late real SQLite unique-index failure rolls back every candidate transaction write', async () => {
  const fx = await target('sqlite-conflict');
  const remaining = [];
  await assert.rejects(restoreDeviceMigrationV2({ ...fx.options, faultInjector(point, { db } = {}) {
    if (point === 'before-sqlite-commit') {
      db.exec("INSERT INTO customers(id,phone_normalized,data_json) VALUES('conflict','9555000101','{}')");
    }
    if (point === 'after-sqlite-rollback') {
      for (const name of ['customers', 'ws_send_audit', 'ws_accounts']) remaining.push(db.prepare('SELECT count(*) AS total FROM ' + name).get().total);
    }
  } }), error => error.errcode === 2067 && error.cleanupPending === undefined);
  assert.deepEqual(remaining, [0, 0, 1]);
  assert.deepEqual(await inspect(fx.options), fx.blank);
  assertBaseline(fx);
  assert.deepEqual(fs.readdirSync(join(fx.options.controlRoot, 'generations')), [fx.blank.generationId]);
  assert.deepEqual(fs.readdirSync(join(fx.options.controlRoot, 'staging')), []);
});

test('media changes before publication leave the blank pointer and authenticated stage cleanup independent', async () => {
  const fx = await target('media-mismatch');
  await assert.rejects(restoreDeviceMigrationV2({ ...fx.options, faultInjector(point, details) {
    if (point === 'after-media-write') fs.writeFileSync(details.mediaPath, Buffer.alloc(content.length));
  } }), error => error.code === 'RESTORE_MEDIA' && error.cleanupPending === undefined);
  assert.deepEqual(await inspect(fx.options), fx.blank);
  assertBaseline(fx);
  assert.deepEqual(fs.readdirSync(join(fx.options.controlRoot, 'generations')), [fx.blank.generationId]);
  assert.deepEqual(fs.readdirSync(join(fx.options.controlRoot, 'staging')), []);
});

test('an unowned candidate file is preserved and its incomplete cleanup blocks a blind restart', async () => {
  const fx = await target('unowned-file');
  let otherFile;
  await assert.rejects(restoreDeviceMigrationV2({ ...fx.options, faultInjector(point, details) {
    if (point !== 'after-media-write') return;
    otherFile = details.mediaPath + '.other';
    fs.renameSync(details.mediaPath, otherFile);
    fs.writeFileSync(details.mediaPath, 'new file', { flag: 'wx' });
  } }), error => error.code === 'RESTORE_MEDIA' && error.cleanupPending === true);
  assert.equal(fs.readFileSync(otherFile, 'utf8'), content.toString('utf8'));
  assert.equal(fs.readFileSync(otherFile.slice(0, -'.other'.length), 'utf8'), 'new file');
  assert.deepEqual(await inspect(fx.options), fx.blank);
  await assert.rejects(restoreDeviceMigrationV2(fx.options), { code: 'RESTORE_LAYOUT' });
  assertBaseline(fx);
});

test('failed read-back after switch rolls the entire generation back before exposing any work', async () => {
  const fx = await target('rollback');
  await assert.rejects(restoreDeviceMigrationV2({ ...fx.options, faultInjector(point) {
    if (point !== 'before-accept') return;
    const active = readJson(join(fx.options.controlRoot, 'active.json'));
    fs.writeFileSync(join(generationPath(fx.options, active.generationId), 'ws-media', 'native-b', mediaId), Buffer.alloc(content.length));
  } }), { code: 'RESTORE_MEDIA', rollback: 'ROLLED_BACK' });
  const result = await inspect(fx.options);
  assert.equal(result.phase, 'ROLLED_BACK');
  assert.equal(result.generationId, fx.blank.generationId);
  assert.equal(result.gate, 'frozen');
  assertBaseline(fx);
  assert.deepEqual(await resumeDeviceMigrationRestore({ ...fx.options, operationId: result.operationId, decision: 'rollback' }), result);
});

function child(fx, point, exitCode) {
  const command = `const { restoreDeviceMigrationV2 } = require(${JSON.stringify(restoreModule)});
    restoreDeviceMigrationV2({ ...JSON.parse(process.env.RD09_TEST_OPTIONS), faultInjector(point) {
      if (point === ${JSON.stringify(point)}) process.exit(${exitCode});
    } }).catch(error => { console.error(error); process.exitCode = 1; });`;
  return new Promise((resolve, reject) => {
    const processHandle = spawn(process.execPath, ['-e', command], { windowsHide: true, timeout: 30000,
      env: { ...process.env, RD09_TEST_OPTIONS: JSON.stringify(fx.options) }, stdio: ['ignore', 'ignore', 'pipe'] });
    let errorText = '';
    processHandle.stderr.setEncoding('utf8').on('data', data => { errorText += data; });
    processHandle.once('error', reject);
    processHandle.once('close', (code, signal) => {
      if (code === exitCode && signal === null) resolve();
      else reject(new Error(`Isolated child stopped unexpectedly (${code}/${signal}). ${errorText}`));
    });
  });
}

test('actual process exit on either side of the active rename requires explicit, verified recovery', async () => {
  for (const point of ['before-active', 'after-active']) {
    const fx = await target(point);
    await child(fx, point, 73);
    const state = await inspect(fx.options);
    assert.equal(state.phase, 'ACTIVATING');
    assert.equal(state.generationId === fx.blank.generationId, point === 'before-active');
    assert.equal(state.gate, 'frozen');
    await assert.rejects(restoreDeviceMigrationV2(fx.options), { code: 'RESTORE_STATE' });
    await assert.rejects(resumeDeviceMigrationRestore({ ...fx.options, operationId: state.operationId }), { code: 'RESTORE_STATE' });
    const direction = point === 'before-active' ? 'activate' : 'rollback';
    const resumed = await resumeDeviceMigrationRestore({ ...fx.options, operationId: state.operationId, decision: direction });
    assert.equal(resumed.phase, direction === 'activate' ? 'ACCEPTED' : 'ROLLED_BACK');
    assert.equal(resumed.generationId === fx.blank.generationId, direction === 'rollback');
    assertBaseline(fx);
  }
});

test('a malformed journal slot fails closed without replacing the pointer', async () => {
  const fx = await target('corrupt-switch');
  await child(fx, 'after-prepared', 74);
  const pointer = join(fx.options.controlRoot, 'active.json');
  const oldBytes = fs.readFileSync(pointer);
  fs.writeFileSync(join(fx.options.controlRoot, 'switch-1.json'), '{"truncated":');
  await assert.rejects(inspect(fx.options), { code: 'RESTORE_RECORD' });
  await assert.rejects(restoreDeviceMigrationV2(fx.options), { code: 'RESTORE_RECORD' });
  assert.deepEqual(fs.readFileSync(pointer), oldBytes);
  assertBaseline(fx);
});

for (const field of ['destination', 'temporary']) {
  test('active pointer replacement preserves a substituted ' + field, async () => {
    const fx = await target('record-' + field);
    const stashed = join(isolationRoot, 'moved-' + field + '.json');
    const pointer = join(fx.options.controlRoot, 'active.json');
    const prior = fs.readFileSync(pointer);
    let substituted;
    await assert.rejects(restoreDeviceMigrationV2({ ...fx.options, faultInjector(point, details) {
      if (point !== 'before-record-rename' || details.name !== 'active.json') return;
      substituted = details[field];
      fs.renameSync(substituted, stashed);
      fs.writeFileSync(substituted, 'unowned replacement', { flag: 'wx' });
    } }), error => error.code === 'RESTORE_IDENTITY' && error.recoveryPending === true &&
      Boolean(error.cleanupPending) === (field === 'temporary'));
    assert.equal(fs.readFileSync(substituted, 'utf8'), 'unowned replacement');
    assert.deepEqual(fs.readFileSync(field === 'destination' ? stashed : pointer), prior);
    await assert.rejects(inspect(fx.options), { code: field === 'destination' ? 'RESTORE_RECORD' : 'RESTORE_LAYOUT' });
    assertBaseline(fx);
  });
}

test('an initialized target without its lock refuses to acquire a replacement', async () => {
  const fx = await target('missing-lock');
  const lockPath = join(fx.options.controlRoot, '.restore-lock.sqlite');
  const original = join(isolationRoot, 'original-lock.sqlite');
  fs.renameSync(lockPath, original);
  await assert.rejects(inspect(fx.options), { code: 'RESTORE_LOCK' });
  assert.equal(fs.existsSync(lockPath), false);
  assert.equal(fs.statSync(original).size, 0);
  assertBaseline(fx);
});

test('an independently connected process serializes access to a restore target', async () => {
  const fx = await target('competing');
  const lockPath = join(fx.options.controlRoot, '.restore-lock.sqlite');
  const command = `const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(${JSON.stringify(lockPath)});
    db.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=MEMORY; BEGIN EXCLUSIVE');
    console.log('locked');
    process.stdin.resume();
    process.stdin.on('end', () => db.close());`;
  const contender = spawn(process.execPath, ['-e', command], { windowsHide: true, timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = new Promise(resolve => contender.once('close', (code, signal) => resolve({ code, signal })));
  try {
    const ready = await new Promise((resolve, reject) => {
      contender.once('error', reject);
      contender.stdout.setEncoding('utf8').once('data', resolve);
      contender.once('close', () => reject(new Error('Isolated lock child exited before acquiring the lock.')));
    });
    assert.equal(ready.trim(), 'locked');
    await assert.rejects(inspect(fx.options), { code: 'RESTORE_BUSY' });
  } finally {
    contender.stdin.end();
    assert.deepEqual(await closed, { code: 0, signal: null });
  }
  assert.deepEqual(await inspect(fx.options), fx.blank);
  assertBaseline(fx);
});
