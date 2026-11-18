'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const { performance } = require('node:perf_hooks');
const { runMigrations } = require('../../resources/app/migration-runner.cjs');
const queries = require('../../resources/app/modules/ws-workspace-query.cjs');
const repo = path.resolve(__dirname, '../..');
const app = path.join(repo, 'resources/app');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-stage55b-queries-'));
const dbPath = path.join(root, 'workspace.sqlite');
const now = '2026-11-16T08:00:00.000Z';
const params = values => new URLSearchParams(values);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
for (const dangerous of [
  'apiKey="HIDDEN-KEY"', 'password=HIDDEN-PASS', 'Bearer HIDDEN-AUTH',
  'https://fixture.invalid/?api%5Fkey=HIDDEN-URLKEY&token=HIDDEN-URLTOKEN&pass=HIDDEN-URLPASS',
  'https://username:HIDDEN-USERPASS@fixture.invalid/', 'fixture.personal@example.invalid',
]) {
  const safe = queries.redactAudit(dangerous);
  assert.equal(/HIDDEN-|fixture\.personal/.test(safe), false, 'redact credential/email in arbitrary audit fields');
}
const seed = new DatabaseSync(dbPath);
runMigrations({ db: seed, dbPath, migrationDir: path.join(app, 'migrations'), manifestPath: path.join(app, 'migrations/manifest.json'), backupDir: path.join(root, 'backups'), lockPath: path.join(root, 'migration.lock') });
seed.prepare('INSERT INTO ws_accounts(id,display_name,created_at,updated_at) VALUES(?,?,?,?)').run('other', '另一合成账号', now, now);
const conversation = seed.prepare('INSERT INTO ws_conversations(id,account_id,external_id,title,customer_id,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
function add(id, accountId, externalId, phone, customerId = '', extra = {}) {
  conversation.run(id, accountId, externalId, id, customerId, JSON.stringify({ conversationType: 'direct', phone, ...extra }), now, now);
}
seed.prepare('INSERT INTO customers(id,phone_normalized,name,data_json) VALUES(?,?,?,?)').run('known', '9876543210', '人工客户', JSON.stringify({ name: '人工客户', occupation: '人工维护', apiKey: 'CRM-SECRET-DO-NOT-EXPOSE' }));
seed.prepare('INSERT INTO customers(id,phone_normalized,name,deleted,data_json) VALUES(?,?,?,?,?)').run('deleted', '8888888888', '回收客户', 1, '{}');
add('contact-01', 'default', '919876543210@c.us', '+91 98765 43210', 'known');
add('contact-02', 'default', 'duplicate-metadata', '0091 98765 43210');
add('contact-03', 'default', 'number-from-jid@s.whatsapp.net', '');
add('contact-04', 'default', '123456789012@lid', '');
add('contact-05', 'default', 'invalid-phone', 'ABC');
add('contact-06', 'default', 'orphaned', '+91 9000000001', 'missing');
add('contact-07', 'default', 'deleted-contact', '+91 8888888888', 'deleted');
add('contact-08', 'default', 'wrong-phone', '+91 9000000002', 'known');
add('not-contact-group', 'default', '120300000000@g.us', '+91 98765 43210', '', { conversationType: 'group', isGroup: true });
add('other-private', 'other', '919876543210@c.us', '+91 98765 43210', 'known');
for (let index = 0; index < 47; index++) add('page-' + String(index).padStart(2, '0'), 'default', 'page-' + index, '+91 9700000' + String(index).padStart(3, '0'));
const groupAudit = seed.prepare('INSERT INTO ws_group_audit(id,account_id,group_jid,actor,action,entity_type,entity_id,outcome,reason,data_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
groupAudit.run('shared-id', 'default', '12030001@g.us', 'tester', 'members.sync', 'group', '12030001@g.us', 'error', 'Bearer VERY-PRIVATE-SECRET\napiKey="HIDDEN-KEY"\nC:\\private\\profile\\Cookie\nphone +91 9000000001', JSON.stringify({ runId: 'run-a', retryCount: 2, password: 'RAW-PASSWORD', body: 'PRIVATE-CHAT-BODY', nested: { token: 'RAW-TOKEN' } }), now);
groupAudit.run('private-other', 'other', 'other@g.us', 'tester', 'other-account-action', 'group', 'other@g.us', 'accepted', 'OTHER-PRIVATE-REASON', '{}', now);
groupAudit.run('clock-older', 'default', '', 'tester', 'mixed.clock', 'group', '', 'accepted', '', '{}', '2026-11-16T08:00:00.000Z');
groupAudit.run('clock-newer', 'default', '', 'tester', 'mixed.clock', 'group', '', 'accepted', '', '{}', '2026-11-16 09:00:00');
seed.prepare('INSERT INTO ai_task_audit(id,account_id,job_id,action,from_status,to_status,actor,reason,data_json,correlation_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
  .run('shared-id', 'default', 'job-a', 'crm.review.approve', 'pending', 'completed', 'human', 'approved', JSON.stringify({ fieldName: 'occupation', candidateValue: 'PRIVATE-CANDIDATE', customerId: 'known' }), 'correlation-a', '2026-11-17T08:00:00.000Z');
seed.prepare('INSERT INTO ws_send_audit(id,account_id,conversation_id,operation,status,original_text,translated_text,error_message,native_result_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
  .run('send-a', 'default', 'contact-01', 'single', 'failed', 'PRIVATE-ORIGINAL', 'PRIVATE-TRANSLATION', 'Cookie: SESSION=SECRET; SECOND=SECRET', JSON.stringify({ token: 'NATIVE-TOKEN' }), now, now);
seed.prepare('INSERT INTO ws_collection_runs(id,account_id,status,total,completed,last_error,checkpoint,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('run-a', 'default', 'failed', 5, 3, 'token=COLLECTION-SECRET', 'PRIVATE-CHECKPOINT', now, now);
seed.prepare('INSERT INTO ws_group_sync_runs(id,account_id,group_jid,kind,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('sync-a', 'default', '12030001@g.us', 'members', 'completed', now, now);
seed.prepare('INSERT INTO ai_jobs(id,account_id,conversation_id,idempotency_key,next_attempt_at,created_at,updated_at,lease_token,payload_json) VALUES(?,?,?,?,?,?,?,?,?)').run('job-a', 'default', 'contact-01', 'job-a', now, now, now, 'PRIVATE-LEASE', JSON.stringify({ transcript: 'PRIVATE-TRANSCRIPT' }));
seed.prepare('INSERT INTO customer_governance_actions(id,customer_id,action,reason,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)').run('global-audit', 'known', 'update', 'GLOBAL-NO-ACCOUNT', '{}', '{}', now);
seed.close();

function businessDigest() {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const names = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const data = names.map(({ name }) => [name, db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid').all()]);
    return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  } finally { db.close(); }
}

let child;
(async () => {
  const before = businessDigest();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const result = queries.contacts(db, 'default', params({ pageSize: '4' }));
    assert.equal(result.total, 55); assert.equal(result.rows.length, 4); assert.equal(result.pageCount, 14);
    assert.equal(result.rows.find(row => row.id === 'contact-01').normalizedPhone, '9876543210');
    assert.equal(result.rows.find(row => row.id === 'contact-01').crmLinkStatus, 'linked');
    assert.equal(result.rows.find(row => row.id === 'contact-01').duplicateCount, 2, 'count includes off-page duplicate');
    assert.equal(queries.contacts(db, 'default', params({ id: 'other-private' })).total, 0, 'detail lookup stays inside account scope');
    const duplicate = queries.contacts(db, 'default', params({ duplicate: 'duplicate', pageSize: '1', page: '2' }));
    assert.equal(duplicate.total, 2); assert.equal(duplicate.rows.length, 1); assert.equal(duplicate.page, 2);
    assert.equal(queries.contacts(db, 'default', params({ id: 'other-private' })).rows.some(row => row.accountId === 'other'), false);
    const all = queries.contacts(db, 'default', params({ pageSize: '100' }));
    assert.equal(all.rows.find(row => row.id === 'contact-04').phoneStatus, 'unprovided', 'opaque LID must not become a phone');
    assert.equal(all.rows.find(row => row.id === 'contact-05').phoneStatus, 'invalid');
    for (const id of ['contact-06', 'contact-07', 'contact-08']) assert.equal(all.rows.find(row => row.id === id).crmLinkStatus, 'conflict');
    assert.equal(all.rows.some(row => row.id === 'not-contact-group'), false);
    assert.equal(queries.contacts(db, 'other', params({})).rows[0].duplicateCount, 1, 'duplicates never cross accounts');
    assert.equal(queries.contacts(db, 'default', params({ q: 'NO-MATCH' })).total, 0);
    assert.equal(queries.contacts(db, 'default', params({ q: "%' OR 1=1--" })).total, 0);
    assert.throws(() => queries.contacts(db, 'default', params({ page: '-1' })), /正整数/);
    assert.throws(() => queries.contacts(db, 'default', params({ duplicate: 'guessed' })), /不支持/);

    const audit = queries.audit(db, 'default', params({ pageSize: '2' }));
    assert.equal(audit.total, 5); assert.equal(audit.rows.length, 2);
    assert.equal(new Set(queries.audit(db, 'default', params({})).rows.map(row => row.id)).size, 5, 'same source-record id in two authorities must not collide');
    const auditAll = queries.audit(db, 'default', params({}));
    assert.equal(auditAll.rows[0].action, 'crm.review.approve');
    assert.equal(auditAll.rows[0].at, '2026-11-17T08:00:00.000Z', 'valid audit timestamps remain canonical ISO');
    assert.equal(auditAll.coverage.unavailable.some(item => item.source.includes('customer_governance')), true);
    const exposed = JSON.stringify(auditAll);
    for (const sensitive of ['VERY-PRIVATE-SECRET', 'HIDDEN-KEY', 'RAW-PASSWORD', 'PRIVATE-CHAT-BODY', 'RAW-TOKEN', 'PRIVATE-CANDIDATE', 'PRIVATE-ORIGINAL', 'PRIVATE-TRANSLATION', 'NATIVE-TOKEN', 'SESSION=SECRET', 'OTHER-PRIVATE-REASON', 'GLOBAL-NO-ACCOUNT', 'C:\\private']) assert.equal(exposed.includes(sensitive), false, sensitive);
    assert.equal(queries.audit(db, 'default', params({ q: 'VERY-PRIVATE-SECRET' })).total, 0, 'search must use the redacted projection');
    assert.equal(queries.audit(db, 'default', params({ type: 'crm.review.approve' })).total, 1);
    assert.equal(queries.audit(db, 'default', params({ outcome: 'error' })).total, 1);
    assert.equal(queries.audit(db, 'default', params({ jobId: 'job-a' })).total, 1);
    assert.equal(queries.audit(db, 'default', params({ objectId: '12030001@g.us' })).total, 1);
    assert.equal(queries.audit(db, 'default', params({ from: '2026-11-17', to: '2026-11-17' })).total, 1);
    assert.deepEqual(queries.audit(db, 'default', params({ type: 'mixed.clock' })).rows.map(row => row.recordId), ['clock-newer', 'clock-older'], 'legacy SQLite timestamps and ISO timestamps sort chronologically');
    assert.equal(queries.audit(db, 'other', params({ id: auditAll.rows[0].id })).total, 0);
    assert.throws(() => queries.audit(db, 'default', params({ from: 'not-date' })), /时间格式/);
    assert.throws(() => queries.audit(db, 'default', params({ from: '2026-11-18', to: '2026-11-16' })), /晚于/);
    const snapshot = queries.audit(db, 'default', params({ category: 'snapshot' }));
    assert.equal(snapshot.total, 3); assert.equal(snapshot.rows.every(row => row.category === 'snapshot'), true);
    for (const value of ['PRIVATE-LEASE', 'PRIVATE-TRANSCRIPT', 'PRIVATE-CHECKPOINT', 'COLLECTION-SECRET']) assert.equal(JSON.stringify(snapshot).includes(value), false);
    const diagnostic = queries.audit(db, 'default', params({ category: 'diagnostic' }));
    assert.equal(diagnostic.available, false); assert.equal(diagnostic.total, 0); assert.match(diagnostic.unavailableReason, /未接入/);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 25);
  } finally { db.close(); }
  assert.equal(businessDigest(), before, 'all projections run on a read-only connection and preserve all source records');

  const stress = new DatabaseSync(dbPath);
  stress.exec('BEGIN IMMEDIATE');
  try {
    const insertStress = stress.prepare('INSERT INTO ws_group_audit(id,account_id,group_jid,actor,action,entity_type,entity_id,outcome,reason,data_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    for (let i = 0; i < 3000; i++) insertStress.run('stress-' + i, 'default', '12030001@g.us', 'tester', 'stress.query', 'group', '12030001@g.us', 'accepted', 'normal operation', '{}', now);
    insertStress.run('apiKey=HIDDEN-ID', 'default', '', 'secret=HIDDEN-ACTOR', 'password=HIDDEN-ACTION', 'group', 'token=HIDDEN-OBJECT', 'error', 'fixture.personal@example.invalid', JSON.stringify({ runId: 'token=HIDDEN-RUN', errorCode: 'apiKey=HIDDEN-DETAIL', nested: { Cookie: 'HIDDEN-RAW-JSON' } }), 'Bearer HIDDEN-TIMESTAMP');
    stress.exec('COMMIT');
  } catch (error) { stress.exec('ROLLBACK'); throw error; }
  stress.close();
  const measured = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const maliciousId = 'ws_group_audit:' + crypto.createHash('sha256').update('apiKey=HIDDEN-ID').digest('hex');
    const safeDetail = queries.audit(measured, 'default', params({ id: maliciousId }));
    assert.equal(safeDetail.total, 1); assert.equal(JSON.stringify(safeDetail).includes('HIDDEN-'), false, 'all user-controlled audit columns and detail values are redacted');
    assert.equal(safeDetail.rows[0].at, '时间未识别', 'invalid legacy timestamps must never be returned as raw text');
    assert.equal(queries.audit(measured, 'default', params({ q: 'HIDDEN-TIMESTAMP' })).total, 0, 'malformed timestamp secrets cannot be discovered by search');
    assert.equal(queries.audit(measured, 'default', params({ id: maliciousId, from: '2026-11-16', to: '2026-11-17' })).total, 0, 'invalid timestamps remain excluded by ordinary time filters');
    for (let round = 1; round <= 3; round++) {
      const started = performance.now();
      for (let i = 0; i < 10; i++) {
        const page = queries.audit(measured, 'default', params({ type: 'stress.query', page: String(i + 1), pageSize: '40' }));
        assert.equal(page.total, 3000); assert.equal(page.rows.length, 40);
      }
      console.log(JSON.stringify({ kind: 'read-only-audit-query-observation', round, scopedRecords: 3006, queries: 10, pageSize: 40, elapsedMs: +(performance.now() - started).toFixed(2), threshold: 'NotDefined', onlyTemporarySqlite: true }));
    }
  } finally { measured.close(); }

  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const token = crypto.randomBytes(32).toString('hex');
  child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], { cwd: app, windowsHide: true, env: { ...process.env, ZHIKE_DATA_DIR: root, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token, ZHIKE_FENCING_MODE: '', ZHIKE_AI_PIPELINE_MODE: '', ZHIKE_GROUP_MANAGER_MODE: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverError = '';
  let exitObserved = false; let closeObserved = false;
  child.once('exit', () => { exitObserved = true; });
  child.once('close', () => { closeObserved = true; });
  child.stderr.on('data', bytes => { serverError = (serverError + bytes.toString()).slice(-2000); });
  child.stdout.on('data', () => {});
  const headers = { origin: 'http://127.0.0.1:' + port, 'x-zhike-api-token': token };
  const get = (route, options = {}) => fetch('http://127.0.0.1:' + port + route, { headers, signal: AbortSignal.timeout(5000), ...options });
  let ready = false;
  for (let attempt = 0; attempt < 160; attempt++) {
    if (child.exitCode !== null) throw new Error('isolated sidecar exited: ' + serverError);
    try { const res = await get('/api/health'); if (res.ok) { ready = true; break; } } catch {}
    await wait(50);
  }
  assert.equal(ready, true, 'temporary sidecar must become ready');
  const apiBefore = businessDigest();
  for (const route of ['contacts', 'audit']) {
    assert.equal((await get('/api/ws/workspace/' + route)).status, 400);
    assert.equal((await get('/api/ws/workspace/' + route + '?accountId=missing')).status, 404);
    assert.equal((await get('/api/ws/workspace/' + route + '?accountId=default', { method: 'POST' })).status, 405);
    assert.equal((await get('/api/ws/workspace/' + route + '?accountId=default', { headers: { ...headers, 'x-zhike-api-token': 'invalid' } })).status, 401);
  }
  const apiContacts = await get('/api/ws/workspace/contacts?accountId=default&page=2&pageSize=4');
  assert.equal(apiContacts.status, 200); const actualContacts = await apiContacts.json(); assert.equal(actualContacts.total, 55); assert.equal(actualContacts.page, 2);
  const apiAudit = await get('/api/ws/workspace/audit?accountId=default&category=audit&type=crm.review.approve');
  assert.equal(apiAudit.status, 200); assert.equal((await apiAudit.json()).total, 1);
  assert.equal((await get('/api/ws/workspace/audit?accountId=default&category=unrecognized')).status, 400);
  assert.equal((await get('/api/ws/ai-pipeline/jobs?accountId=default')).status, 404, 'new reads must not enable an AI consumer');
  assert.equal(businessDigest(), apiBefore, 'real sidecar GET queries must not mutate source/CRM/audit/schema state');
  const shutdownStarted = performance.now();
  const shutdown = await get('/api/shutdown', { method: 'POST', headers: { ...headers, 'x-zhike-shutdown-token': token } });
  assert.equal(shutdown.status, 200);
  for (let i = 0; i < 120 && child.exitCode === null; i++) await wait(25);
  console.log(JSON.stringify({ kind: 'isolated-sidecar-shutdown-observation', elapsedMs: +(performance.now() - shutdownStarted).toFixed(2), exitCode: child.exitCode, signalCode: child.signalCode, exitObserved, closeObserved, shutdownBodyConsumed: shutdown.bodyUsed }));
  assert.equal(child.exitCode, 0, 'sidecar normal shutdown');
  const contactsSeed = new DatabaseSync(dbPath);
  contactsSeed.exec('BEGIN IMMEDIATE');
  try {
    const insert = contactsSeed.prepare('INSERT INTO ws_conversations(id,account_id,external_id,title,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
    for (let i = 0; i < 3000; i++) insert.run('stress-contact-' + i, 'default', 'stress-contact-' + i, '合成目录 ' + i, JSON.stringify({ conversationType: 'direct', phone: '+91 96' + String(i).padStart(8, '0') }), now, now);
    contactsSeed.exec('COMMIT');
  } catch (error) { contactsSeed.exec('ROLLBACK'); throw error; } finally { contactsSeed.close(); }
  const contactsBefore = businessDigest();
  const contactsRead = new DatabaseSync(dbPath, { readOnly: true });
  try {
    for (let round = 1; round <= 3; round++) {
      const started = performance.now();
      for (let i = 0; i < 10; i++) {
        const page = queries.contacts(contactsRead, 'default', params({ q: '合成目录', page: String(i + 1), pageSize: '40' }));
        assert.equal(page.total, 3000); assert.equal(page.rows.length, 40);
      }
      console.log(JSON.stringify({ kind: 'read-only-contact-query-observation', round, scopedContacts: 3055, queries: 10, pageSize: 40, elapsedMs: +(performance.now() - started).toFixed(2), threshold: 'NotDefined', onlyTemporarySqlite: true }));
    }
  } finally { contactsRead.close(); }
  assert.equal(businessDigest(), contactsBefore, 'contact counts/search/window duplicate projection preserves source authorities');
  console.log('Stage 5.5B workspace query: real schema25 read-only contacts, canonical phones/account duplicates, paged filtered union audit, redaction/search, CRM protection, scoped IDs, authenticated sidecar and flags OFF PASS');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (child && child.exitCode === null) { child.kill(); for (let i = 0; i < 160 && child.exitCode === null; i++) await wait(25); }
  assert.equal(path.dirname(path.resolve(root)).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
  assert.match(path.basename(root), /^zhike-stage55b-queries-/);
  if (!child || child.exitCode !== null) fs.rmSync(root, { recursive: true, force: true });
});
