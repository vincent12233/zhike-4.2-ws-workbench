'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const { runMigrations, hashMigration, readIntegrity } = require('../../resources/app/migration-runner.cjs');
const source = path.resolve(__dirname, '../../resources/app/migrations');
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
const latest = manifest.supportedSchemaVersion;
const next = latest + 1;
const current = manifest.migrations.find(row => row.version === 24);
const legacyHash = 'eeff6bc11ed4de1573199d1cb71897b7853b5f750c0b7cd353dfff4a1cbda4b6';
const canonicalHash = '9dc642557b9007b9de83c73aab035e017caa7d41a2ed58b1cb275e9fb9dd640f';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-stage51-checksum-'));
const evidence = [];
function fixture(name) {
  const dir = path.join(root, name), oldDir = path.join(dir, 'old-migrations'); fs.mkdirSync(oldDir, { recursive: true });
  const entries = manifest.migrations.filter(row => row.version <= 24).map(row => ({ ...row }));
  for (const entry of entries) {
    let sql = fs.readFileSync(path.join(source, entry.file), 'utf8');
    if (entry.version === 24) { sql += '\n'; assert.equal(hashMigration(sql), legacyHash); entry.checksum = legacyHash; }
    fs.writeFileSync(path.join(oldDir, entry.file), sql);
  }
  fs.writeFileSync(path.join(oldDir, 'manifest.json'), JSON.stringify({ ...manifest, supportedSchemaVersion: 24, migrations: entries }));
  return { dir, oldDir, dbPath: path.join(dir, 'workspace.sqlite'), backupDir: path.join(dir, 'backups'), lockPath: path.join(dir, 'migration.lock') };
}
function run(fx, db, migrationDir = source, extra = {}) { return runMigrations({ db, dbPath: fx.dbPath, migrationDir, manifestPath: path.join(migrationDir, 'manifest.json'), lockPath: fx.lockPath, backupDir: fx.backupDir, ...extra }); }
function old(fx) {
  const db = new DatabaseSync(fx.dbPath); run(fx, db, fx.oldDir);
  const customer = { id: 'c-legacy', name: 'Synthetic', phone: '919000000099', rawPhone: '919000000099', occupation: 'Manual field', manual: true };
  db.prepare('INSERT INTO customers(id,phone_normalized,name,data_json) VALUES(?,?,?,?)').run(customer.id, customer.phone, customer.name, JSON.stringify(customer));
  db.prepare('INSERT INTO app_state(id,json,updated_at,revision) VALUES(1,?,?,1)').run(JSON.stringify({ schemaVersion: 4, customers: [customer], settings: {}, activities: [], tickets: [], deposits: [], followups: [], registrations: [], phoneRegistry: [], batchOperations: [], importIssues: [], savedViews: [], channelAliases: {} }), '2026-11-16');
  db.prepare('INSERT INTO ai_jobs(id,conversation_id,idempotency_key,payload_json,status,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('ai-legacy', 'chat-legacy', 'old-key', '{"checkpoint":{"cursor":"message-19"}}', 'completed', '', '2026-11-16', '2026-11-16');
  return db;
}
function verify(db) { assert.equal(JSON.parse(db.prepare("SELECT data_json FROM customers WHERE id='c-legacy'").get().data_json).occupation, 'Manual field'); assert.equal(db.prepare("SELECT status FROM ai_jobs WHERE id='ai-legacy'").get().status, 'completed'); assert.equal(db.prepare('SELECT checksum FROM schema_migrations WHERE version=24').get().checksum, legacyHash); assert.equal(readIntegrity(db).ok, true); }
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function sidecarRestart(fx) {
  const probe = createServer(); await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); }); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const token = 'stage51-legacy-startup-only'; let stderr = '';
  const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], { cwd: path.resolve(__dirname, '../../resources/app'), windowsHide: true, env: { ...process.env, ZHIKE_DATA_DIR: fx.dir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token }, stdio: ['ignore', 'ignore', 'pipe'] }); child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    let response; for (let attempt = 0; attempt < 600; attempt++) { if (child.exitCode !== null) throw new Error('isolated legacy startup failed: ' + stderr); try { response = await fetch(`http://127.0.0.1:${port}/api/health`); if (response.ok) break; } catch {} await wait(25); }
    assert.ok(response?.ok, 'actual sidecar startup'); assert.equal((await response.json()).schemaVersion, latest);
    const state = await (await fetch(`http://127.0.0.1:${port}/api/state`, { headers: { 'x-zhike-api-token': token } })).json(); assert.equal(state.customers[0].occupation, 'Manual field');
    const shutdown = await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { 'x-zhike-api-token': token, 'x-zhike-shutdown-token': token } }); assert.equal(shutdown.status, 200);
  } finally { for (let attempt = 0; attempt < 100 && child.exitCode === null; attempt++) await wait(25); if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); } }
}
(async () => { try {
  assert.equal(current.checksum, canonicalHash); assert.equal(hashMigration(fs.readFileSync(path.join(source, current.file), 'utf8') + '\n'), legacyHash);
  const fx = fixture('legacy'); let db = old(fx);
  try {
    const upgraded = run(fx, db); assert.equal(upgraded.version, latest); assert.ok(upgraded.backupPath);
    assert.equal(upgraded.compatibility.length, 1); assert.equal(upgraded.compatibility[0].status, 'accepted-with-audit');
    assert.ok(fs.existsSync(upgraded.compatibilityAuditPath)); const audit = JSON.parse(fs.readFileSync(upgraded.compatibilityAuditPath, 'utf8')); assert.equal(audit.legacyChecksum, legacyHash); assert.equal(audit.canonicalChecksum, canonicalHash); assert.equal(audit.backupPath, upgraded.backupPath);
    verify(db); const before = fs.readFileSync(upgraded.compatibilityAuditPath, 'utf8'); const again = run(fx, db); assert.equal(again.applied.length, 0); assert.equal(again.backupPath, null); assert.equal(fs.readFileSync(again.compatibilityAuditPath, 'utf8'), before); verify(db);
    const restore = new DatabaseSync(upgraded.backupPath, { readOnly: true }); try { assert.equal(restore.prepare('PRAGMA user_version').get().user_version, 24); verify(restore); } finally { restore.close(); }
    evidence.push('exact legacy SQL applied, upgrade to current schema, historical records, original checksum preserved, immutable audit, repeat and backup restore');
  } finally { db.close(); }
  for (const kind of ['unknown-hash','schema-drift','backup-disabled']) {
    const caseFx = fixture(kind); db = old(caseFx);
    try {
      if (kind === 'unknown-hash') db.prepare('UPDATE schema_migrations SET checksum=? WHERE version=24').run('a'.repeat(64));
      if (kind === 'schema-drift') db.exec("ALTER TABLE ai_jobs ADD COLUMN unexpected_field TEXT");
      assert.throws(() => run(caseFx, db, source, kind === 'backup-disabled' ? { backup: false } : {}), error => kind === 'unknown-hash' ? error.code === 'MIGRATION_CHECKSUM_MISMATCH' : kind === 'schema-drift' ? error.code === 'MIGRATION_COMPATIBILITY_SCHEMA_MISMATCH' : error.code === 'MIGRATION_COMPATIBILITY_BACKUP_REQUIRED');
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, 24); assert.equal(db.prepare("SELECT status FROM ai_jobs WHERE id='ai-legacy'").get().status, 'completed');
      evidence.push(kind + ' rejected without upgrade or metadata override');
    } finally { db.close(); }
  }
  const freshFx = fixture('fresh'); db = new DatabaseSync(freshFx.dbPath);
  try { const fresh = run(freshFx, db); assert.equal(fresh.version, latest); assert.deepEqual(fresh.compatibility, []); assert.equal(db.prepare('SELECT checksum FROM schema_migrations WHERE version=24').get().checksum, canonicalHash); evidence.push('fresh canonical database remains canonical'); } finally { db.close(); }
  const failedFx = fixture('failure-restore'); db = old(failedFx);
  try {
    const brokenDir = path.join(failedFx.dir, 'broken-migrations'); fs.mkdirSync(brokenDir); for (const entry of manifest.migrations) fs.copyFileSync(path.join(source, entry.file), path.join(brokenDir, entry.file));
    const sql = 'CREATE TABLE stage51_fail_marker(id INTEGER); INSERT INTO stage51_missing VALUES(1);', file = String(next).padStart(3, "0") + "-stage51-fail-fixture.sql"; fs.writeFileSync(path.join(brokenDir, file), sql); fs.writeFileSync(path.join(brokenDir, 'manifest.json'), JSON.stringify({ ...manifest, supportedSchemaVersion: next, migrations: [...manifest.migrations, { version: next, file, description: 'isolated failure test', checksum: hashMigration(sql) }] }));
    assert.throws(() => run(failedFx, db, brokenDir), error => error.code === 'MIGRATION_FAILED'); assert.equal(db.prepare('PRAGMA user_version').get().user_version, latest); assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='stage51_fail_marker'").get().n, 0); verify(db);
    const audit = JSON.parse(fs.readFileSync(path.join(failedFx.backupDir, 'compatibility/migration-024-extra-terminal-lf.json'), 'utf8')); const backup = new DatabaseSync(audit.backupPath, { readOnly: true }); try { assert.equal(backup.prepare('PRAGMA user_version').get().user_version, 24); verify(backup); } finally { backup.close(); }
    evidence.push('failed subsequent DDL rolls back its transaction and pre-upgrade backup retains original24 registry/data');
  } finally { db.close(); }
  const auditFx = fixture('audit-failure'); db = old(auditFx);
  try { fs.writeFileSync(path.join(auditFx.backupDir, 'compatibility'), 'block-directory'); assert.throws(() => run(auditFx, db), error => error.code === 'MIGRATION_COMPATIBILITY_AUDIT_FAILED'); assert.equal(db.prepare('PRAGMA user_version').get().user_version, 24); verify(db); evidence.push('audit persistence failure stops before schema upgrade'); } finally { db.close(); }
  const corruptFx = fixture('corrupt-audit'); db = old(corruptFx);
  try { const accepted = run(corruptFx, db); fs.appendFileSync(accepted.compatibilityAuditPath, 'tamper'); assert.throws(() => run(corruptFx, db), error => error.code === 'MIGRATION_COMPATIBILITY_AUDIT_INVALID'); verify(db); evidence.push('tampered audit rejected without rewrite'); } finally { db.close(); }
  const contentFx = fixture('current-file-tamper'); db = new DatabaseSync(contentFx.dbPath);
  try { fs.writeFileSync(path.join(contentFx.oldDir, 'manifest.json'), JSON.stringify({ ...manifest, supportedSchemaVersion: 24, migrations: manifest.migrations.filter(entry => entry.version <= 24) })); assert.throws(() => run(contentFx, db, contentFx.oldDir), error => error.code === 'MIGRATION_CHECKSUM_MISMATCH'); assert.equal(db.prepare('PRAGMA user_version').get().user_version, 0); evidence.push('current migration file hash validation still rejects even known extra-LF bytes without matching manifest'); } finally { db.close(); }
  for (const damage of ['backup-missing', 'backup-tampered']) {
    const damagedFx = fixture(damage); db = old(damagedFx);
    try { const accepted = run(damagedFx, db), audit = JSON.parse(fs.readFileSync(accepted.compatibilityAuditPath, 'utf8')); if (damage === 'backup-missing') fs.unlinkSync(audit.backupPath); else fs.appendFileSync(audit.backupPath, 'tamper'); assert.throws(() => run(damagedFx, db), error => error.code === 'MIGRATION_COMPATIBILITY_BACKUP_INVALID'); verify(db); evidence.push(damage + ' rejected with history preserved'); } finally { db.close(); }
  }
  const bootFx = fixture('actual-sidecar'); db = old(bootFx); db.close(); await sidecarRestart(bootFx); await sidecarRestart(bootFx); db = new DatabaseSync(bootFx.dbPath, { readOnly: true }); try { verify(db); assert.equal(db.prepare('PRAGMA user_version').get().user_version, latest); } finally { db.close(); } evidence.push('actual current sidecar boots genuine legacy024 database twice with CRM and AI history retained');
  console.log(JSON.stringify({ stage: '5.1', checksum: 'Passed', evidence, productionDatabaseOpened: false }));
} finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } })().catch(error => { console.error(error); process.exitCode = 1; });
