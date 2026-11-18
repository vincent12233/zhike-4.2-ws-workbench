'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations } = require('../../resources/app/migration-runner.cjs');
const os = require('node:os');

const root = path.resolve(__dirname, '..', '..');
const migrations = path.join(root, 'resources', 'app', 'migrations');
const manifest = JSON.parse(fs.readFileSync(path.join(migrations, 'manifest.json'), 'utf8'));
assert.ok(manifest.supportedSchemaVersion >= 23, 'the migration chain must retain stage3 version 23 or newer');
const entry = manifest.migrations.find(item => item.version === 23);
assert.ok(entry, 'migration 023 must be registered');
const sql = fs.readFileSync(path.join(migrations, entry.file), 'utf8');
for (const table of ['ws_group_messages', 'ws_group_read_evidence', 'ws_group_sync_errors', 'ws_group_audit']) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${table}`, 'i'));
assert.match(sql, /UNIQUE\s*\(\s*account_id\s*,\s*group_jid\s*,\s*message_id\s*\)/i);
assert.match(sql, /unknown|delivered|read/i);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-stage3-migration-'));
const db = new DatabaseSync(':memory:');
try {
  runMigrations({ db, migrationDir: migrations, manifestPath: path.join(migrations, 'manifest.json'), lockPath: path.join(tempRoot, 'migration.lock'), backupDir: path.join(tempRoot, 'backups') });
  for (const table of ['ws_group_members', 'ws_group_sync_runs', 'ws_group_messages', 'ws_group_read_evidence', 'ws_group_sync_errors', 'ws_group_audit']) assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?").get(table).n), 1, `missing ${table}`);
} finally {
  db.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
console.log('stage3 group manager migration contract: pass');
