#!/usr/bin/env node
'use strict';

/*
 * P0-03/P0-06 migration diagnostics.  The fixtures are copies of the
 * versioned SQL under a temporary directory; no production database is
 * opened and no sidecar/worker is started.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations } = require('../../resources/app/migration-runner.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const sourceDir = path.join(repoRoot, 'resources', 'app', 'migrations');
const sourceManifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8'));

function fixture(maxVersion) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-migration-conflict-'));
  const migrationDir = path.join(root, 'migrations');
  fs.mkdirSync(migrationDir);
  const migrations = sourceManifest.migrations.filter(item => item.version <= maxVersion);
  for (const item of migrations) fs.copyFileSync(path.join(sourceDir, item.file), path.join(migrationDir, item.file));
  fs.writeFileSync(path.join(migrationDir, 'manifest.json'), `${JSON.stringify({ format: 1, supportedSchemaVersion: maxVersion, migrations }, null, 2)}\n`);
  return {
    root,
    migrationDir,
    manifestPath: path.join(migrationDir, 'manifest.json'),
    dbPath: path.join(root, 'workspace.sqlite'),
    backupDir: path.join(root, 'backups'),
    lockPath: path.join(root, 'migration.lock'),
  };
}

function run(fx, db) {
  return runMigrations({ ...fx, db, lockTimeoutMs: 3000 });
}

function migrationIndex(db, name) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(name);
}

function main() {
  const phone = fixture(20);
  const phoneDb = new DatabaseSync(phone.dbPath);
  try {
    run(phone, phoneDb);
    const now = new Date().toISOString();
    const customer = phoneDb.prepare('INSERT INTO customers(id,phone_normalized,name,source,assistant,status,stage,deleted,data_json) VALUES(?,?,?,?,?,?,?,?,?)');
    customer.run('duplicate-a', '+919876543210', 'A', '', '', '', '', 0, '{}');
    customer.run('duplicate-b', '+919876543210', 'B', '', '', '', '', 0, '{}');
    const beforeVersion = Number(phoneDb.prepare('PRAGMA user_version').get().user_version);
    let phoneError;
    const next = fixture(21);
    try {
      // Reuse the same database while pointing at a manifest that adds 021.
      run({ ...next, dbPath: phone.dbPath, lockPath: phone.lockPath }, phoneDb);
    } catch (error) { phoneError = error; }
    finally { fs.rmSync(next.root, { recursive: true, force: true }); }
    assert.equal(phoneError?.code, 'CRM_PHONE_CONFLICT');
    assert.ok(Array.isArray(phoneError.conflicts) && phoneError.conflicts.length === 1);
    assert.deepEqual(phoneError.conflicts[0].customerIds.sort(), ['duplicate-a', 'duplicate-b']);
    assert.equal(Number(phoneDb.prepare('PRAGMA user_version').get().user_version), beforeVersion);
    assert.equal(migrationIndex(phoneDb, 'idx_customers_phone_active'), undefined);
  } finally {
    phoneDb.close();
    fs.rmSync(phone.root, { recursive: true, force: true });
  }

  const group = fixture(21);
  const groupDb = new DatabaseSync(group.dbPath);
  try {
    run(group, groupDb);
    const now = new Date().toISOString();
    groupDb.prepare('INSERT INTO ws_accounts(id,display_name,provider,origin,partition_key,status,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run('account-conflict', '', '', '', '', '未连接', 1, now, now);
    groupDb.prepare('INSERT INTO ws_group_monitor_profiles(id,account_id,slot_key,status,enabled,poll_interval_sec,last_heartbeat_at,last_error,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run('profile-a', 'account-conflict', 'slot-a', 'paused', 1, 45, '', '', '{}', now, now);
    groupDb.prepare('INSERT INTO ws_group_monitor_profiles(id,account_id,slot_key,status,enabled,poll_interval_sec,last_heartbeat_at,last_error,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run('profile-b', 'account-conflict', 'slot-b', 'paused', 1, 45, '', '', '{}', now, now);
    const target = groupDb.prepare('INSERT INTO ws_group_monitor_targets(id,profile_id,account_id,group_jid,group_name,source_id,vip_only,enabled,last_snapshot_hash,last_seen_at,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    target.run('target-a', 'profile-a', 'account-conflict', '1203-duplicate@g.us', 'A', '', 1, 1, '', '', '{}', now, now);
    target.run('target-b', 'profile-b', 'account-conflict', '1203-duplicate@g.us', 'B', '', 1, 1, '', '', '{}', now, now);
    const beforeVersion = Number(groupDb.prepare('PRAGMA user_version').get().user_version);
    let groupError;
    const next = fixture(22);
    try {
      run({ ...next, dbPath: group.dbPath, lockPath: group.lockPath }, groupDb);
    } catch (error) { groupError = error; }
    finally { fs.rmSync(next.root, { recursive: true, force: true }); }
    assert.equal(groupError?.code, 'GROUP_TARGET_CONFLICT');
    assert.ok(Array.isArray(groupError.conflicts) && groupError.conflicts.length === 1);
    assert.deepEqual(groupError.conflicts[0].targetIds.sort(), ['target-a', 'target-b']);
    assert.equal(Number(groupDb.prepare('PRAGMA user_version').get().user_version), beforeVersion);
    assert.equal(migrationIndex(groupDb, 'idx_ws_group_targets_enabled_account_group'), undefined);
  } finally {
    groupDb.close();
    fs.rmSync(group.root, { recursive: true, force: true });
  }
  console.log('migration conflict diagnostics: duplicate phone and enabled group targets fail closed with conflict lists');
}

main();
