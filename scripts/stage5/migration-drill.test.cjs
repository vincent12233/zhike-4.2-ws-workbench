'use strict';

// Exercise the shipped runner and SQL exclusively in synthetic temporary workspaces.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations, readIntegrity, hashMigration } = require('../../resources/app/migration-runner.cjs');
const source = path.resolve(__dirname, '../../resources/app/migrations');
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-stage5-migration-'));
const now = '2026-11-16T00:00:00.000Z';
const results = [];

function fixture(name, maxVersion = manifest.supportedSchemaVersion) {
  const dir = path.join(root, name); const migrationDir = path.join(dir, 'migrations');
  fs.mkdirSync(migrationDir, { recursive: true });
  const selected = manifest.migrations.filter(entry => entry.version <= maxVersion);
  for (const entry of selected) fs.copyFileSync(path.join(source, entry.file), path.join(migrationDir, entry.file));
  fs.writeFileSync(path.join(migrationDir, 'manifest.json'), JSON.stringify({ ...manifest, supportedSchemaVersion: maxVersion, migrations: selected }));
  return { dir, migrationDir, dbPath: path.join(dir, 'workspace.sqlite') };
}
function run(fx, db, useSource = false) {
  const migrationDir = useSource ? source : fx.migrationDir;
  return runMigrations({ db, dbPath: fx.dbPath, migrationDir, manifestPath: path.join(migrationDir, 'manifest.json'), lockPath: path.join(fx.dir, 'migration.lock'), backupDir: path.join(fx.dir, 'backups') });
}
function seed(db, version) {
  if (!version) return;
  db.prepare('INSERT INTO customers(id,phone_normalized,name,data_json) VALUES(?,?,?,?)').run('historic-c', '919000000001', '合成客户', JSON.stringify({ occupation: '人工维护职业', manual: true }));
  db.prepare('INSERT INTO ws_group_catalog(id,account_id,group_jid,group_name,first_seen_at,last_seen_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('historic-group', 'default', '1203-synthetic@g.us', '历史合成群', now, now, now, now);
  // Some pre-020 sidecars owned this table inline. Create the authentic legacy schema.
  if (version < 20) db.exec(fs.readFileSync(path.join(source, '020-ai-schema-authority.sql'), 'utf8'));
  db.prepare('INSERT INTO ai_jobs(id,conversation_id,idempotency_key,payload_json,status,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('historic-ai', 'historic-conversation', 'historic-key', JSON.stringify({ checkpoint: { completedChunks: 3, cursor: 'message-91' } }), 'completed', now, now, now);
  if (version >= 22) db.prepare('INSERT INTO customer_group_memberships(id,account_id,group_jid,customer_id,member_jid,status,manual_locked,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('historic-relation', 'default', '1203-synthetic@g.us', 'historic-c', '919000000001@s.whatsapp.net', '在群', 1, now, now);
}
function verifyHistory(db, version) {
  if (!version) return;
  assert.equal(JSON.parse(db.prepare('SELECT data_json FROM customers WHERE id=?').get('historic-c').data_json).occupation, '人工维护职业');
  assert.equal(db.prepare('SELECT group_name FROM ws_group_catalog WHERE id=?').get('historic-group').group_name, '历史合成群');
  const job = db.prepare('SELECT * FROM ai_jobs WHERE id=?').get('historic-ai');
  assert.equal(job.status, 'completed'); assert.equal(JSON.parse(job.payload_json).checkpoint.cursor, 'message-91'); assert.equal(job.correlation_id, '');
  if (version >= 22) assert.equal(db.prepare('SELECT manual_locked FROM customer_group_memberships WHERE id=?').get('historic-relation').manual_locked, 1);
}

try {
  for (const version of [0, 19, 22, 23, 24]) {
    const fx = fixture(`upgrade-${version}`, version || manifest.supportedSchemaVersion); let db = new DatabaseSync(fx.dbPath);
    try {
      if (version) { run(fx, db); seed(db, version); }
      const result = run(fx, db, true); assert.equal(result.version, manifest.supportedSchemaVersion); assert.equal(result.integrity.ok, true); verifyHistory(db, version);
      const repeated = run(fx, db, true); assert.equal(repeated.applied.length, 0); assert.equal(repeated.backupPath, null);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, manifest.migrations.length);
      assert.equal(readIntegrity(db).ok, true);
      if (version === 24) {
        // Restore only the exact runner-created pre-upgrade backup to a distinct path.
        assert.ok(result.backupPath); const restoredPath = path.join(fx.dir, 'restored.sqlite'); fs.copyFileSync(result.backupPath, restoredPath);
        const restored = new DatabaseSync(restoredPath);
        try { assert.equal(restored.prepare('PRAGMA user_version').get().user_version, 24); assert.equal(readIntegrity(restored).ok, true); assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM customers').get().n, 1); assert.equal(restored.prepare('SELECT status FROM ai_jobs').get().status, 'completed'); } finally { restored.close(); }
        const legacyChecksum = 'eeff6bc11ed4de1573199d1cb71897b7853b5f750c0b7cd353dfff4a1cbda4b6';
        db.prepare('UPDATE schema_migrations SET checksum=? WHERE version=24').run(legacyChecksum);
        const compatible = run(fx, db, true);
        assert.equal(compatible.compatibility[0].status, 'accepted-with-audit'); assert.ok(compatible.compatibilityAuditPath);
        assert.equal(db.prepare('SELECT checksum FROM schema_migrations WHERE version=24').get().checksum, legacyChecksum);
        results.push('byte-exact extra-LF legacy 024 accepted with immutable audit; original registry retained');
      }
      results.push(`upgrade ${version}->${manifest.supportedSchemaVersion}, history, repeat, integrity`);
    } finally { db.close(); }
  }

  const fx = fixture('interrupted'); let db = new DatabaseSync(fx.dbPath); run(fx, db); seed(db, 24); db.close();
  const child = spawnSync(process.execPath, ['-e', "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN IMMEDIATE; CREATE TABLE interrupted_marker(id INTEGER); PRAGMA user_version=26;');process.exit(7)", fx.dbPath], { windowsHide: true, encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 7, child.stderr); db = new DatabaseSync(fx.dbPath);
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 25); assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='interrupted_marker'").get().n, 0); assert.equal(run(fx, db).applied.length, 0); verifyHistory(db, 24);
    const sql = 'CREATE TABLE failed_marker(id INTEGER); INSERT INTO missing_stage5_table VALUES(1);'; const file = '026-stage5-failure-fixture.sql';
    fs.writeFileSync(path.join(fx.migrationDir, file), sql); const entries = [...manifest.migrations, { version: 26, file, description: 'isolated transaction failure', checksum: hashMigration(sql) }];
    fs.writeFileSync(path.join(fx.migrationDir, 'manifest.json'), JSON.stringify({ ...manifest, supportedSchemaVersion: 26, migrations: entries }));
    assert.throws(() => run(fx, db), error => error.code === 'MIGRATION_FAILED'); assert.equal(db.prepare('PRAGMA user_version').get().user_version, 25); assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='failed_marker'").get().n, 0); verifyHistory(db, 24);
    fs.appendFileSync(path.join(fx.migrationDir, file), '\n-- checksum tamper'); assert.throws(() => run(fx, db), error => error.code === 'MIGRATION_CHECKSUM_MISMATCH'); assert.equal(readIntegrity(db).ok, true);
    results.push('process interruption rollback, failed DDL rollback, tamper rejection');
  } finally { db.close(); }

  const conflict = fixture('conflicts', 20); db = new DatabaseSync(conflict.dbPath);
  try { run(conflict, db); db.exec("INSERT INTO customers(id,phone_normalized,data_json) VALUES('duplicate-a','919000000009','{}'),('duplicate-b','919000000009','{}')"); assert.throws(() => run(conflict, db, true), error => error.code === 'CRM_PHONE_CONFLICT' && error.conflicts[0].count === 2); assert.equal(db.prepare('PRAGMA user_version').get().user_version, 20); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM customers').get().n, 2); results.push('duplicate identity upgrade fails closed and preserves both records'); } finally { db.close(); }
  console.log(JSON.stringify({ stage: 5, migration: 'Passed', scenarios: results, productionDatabaseOpened: false, tempRootRemoved: true }));
} finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
