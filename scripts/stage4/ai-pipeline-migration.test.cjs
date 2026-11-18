'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations } = require('../../resources/app/migration-runner.cjs');
const root = path.resolve(__dirname, '..', '..');
const migrations = path.join(root, 'resources', 'app', 'migrations');
const manifest = JSON.parse(fs.readFileSync(path.join(migrations, 'manifest.json'), 'utf8'));
assert.ok(manifest.supportedSchemaVersion >= 24);
const entry = manifest.migrations.find(item => item.version === 24);
assert.ok(entry);
const sql = fs.readFileSync(path.join(migrations, entry.file), 'utf8');
for (const table of ['ai_crm_suggestions','ai_job_evidence','ai_task_audit']) assert.match(sql, new RegExp('CREATE TABLE IF NOT EXISTS\\s+' + table, 'i'));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-stage4-migration-'));
const db = new DatabaseSync(':memory:');
try {
  runMigrations({ db, migrationDir: migrations, manifestPath: path.join(migrations, 'manifest.json'), lockPath: path.join(tempRoot, 'migration.lock'), backupDir: path.join(tempRoot, 'backups') });
  const columns = db.prepare('PRAGMA table_info(ai_jobs)').all().map(row => row.name);
  for (const column of ['job_type','customer_id','source_event_id','priority','checkpoint_json','cancel_requested','fencing_token']) assert.ok(columns.includes(column), 'missing ' + column);
  for (const table of ['ai_crm_suggestions','ai_job_evidence','ai_task_audit']) assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?").get(table).n), 1);
  assert.equal(Number(db.prepare('PRAGMA user_version').get().user_version), manifest.supportedSchemaVersion);
} finally { db.close(); fs.rmSync(tempRoot, { recursive: true, force: true }); }
console.log('stage4 migration: PASS');
