#!/usr/bin/env node
/*
 * P0-01 implementation contract. Every database and migration directory in
 * this file lives under a temporary OS directory. The production sidecar is
 * never imported or started.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const repoRoot = path.resolve(__dirname, '..', '..');
const runnerPath = path.join(repoRoot, 'resources', 'app', 'migration-runner.cjs');
const { runMigrations, hashMigration } = require(runnerPath);

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function writeManifest(root, entries) {
  const manifest = {
    format: 1,
    supportedSchemaVersion: Math.max(...entries.map(entry => entry.version)),
    migrations: entries.map(entry => ({
      version: entry.version,
      file: entry.file,
      description: entry.description || entry.file,
      checksum: entry.checksum,
    })),
  };
  fs.writeFileSync(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function fixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-p0-01-runner-'));
  const migrationDir = path.join(root, 'migrations');
  const backupDir = path.join(root, 'backups');
  fs.mkdirSync(migrationDir);
  const entries = [];
  for (let version = 4; version <= 18; version += 1) {
    const file = `${String(version).padStart(3, '0')}-fixture.sql`;
    const sql = version === 4
      ? '-- schema marker 4\n'
      : version === 12
        ? '-- schema marker 12\n'
        : `CREATE TABLE IF NOT EXISTS fixture_v${version}(id INTEGER PRIMARY KEY, value TEXT NOT NULL);\n`;
    fs.writeFileSync(path.join(migrationDir, file), sql);
    entries.push({ version, file, description: `fixture ${version}`, checksum: sha256(sql) });
  }
  if (options.extra) {
    for (const extra of options.extra) {
      fs.writeFileSync(path.join(migrationDir, extra.file), extra.sql);
      entries.push({ version: extra.version, file: extra.file, description: extra.description || extra.file, checksum: sha256(extra.sql) });
    }
  }
  entries.sort((a, b) => a.version - b.version);
  writeManifest(root, entries);
  return { root, migrationDir, manifestPath: path.join(root, 'manifest.json'), backupDir, dbPath: path.join(root, 'workspace.sqlite'), lockPath: path.join(root, 'migration.lock'), entries };
}

function openFixture(fx) {
  return new DatabaseSync(fx.dbPath);
}

function run(fx, db, extra = {}) {
  return runMigrations({
    db,
    dbPath: fx.dbPath,
    migrationDir: fx.migrationDir,
    manifestPath: fx.manifestPath,
    backupDir: fx.backupDir,
    lockPath: fx.lockPath,
    lockTimeoutMs: 3000,
    ...extra,
  });
}

function childRun(root) {
  const fx = {
    root,
    migrationDir: path.join(root, 'migrations'),
    manifestPath: path.join(root, 'manifest.json'),
    backupDir: path.join(root, 'backups'),
    dbPath: path.join(root, 'workspace.sqlite'),
    lockPath: path.join(root, 'migration.lock'),
  };
  const db = openFixture(fx);
  try {
    const result = run(fx, db, { lockTimeoutMs: 5000 });
    process.stdout.write(JSON.stringify({ ok: true, version: result.version }));
  } finally { db.close(); }
}

function spawnRunner(root) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [__filename, '--child', root], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', status => resolve({ status, stderr }));
  });
}

function realMigrationConflictPreflight() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-p0-01-conflict-'));
  const dbPath = path.join(root, 'workspace.sqlite');
  const db = new DatabaseSync(dbPath);
  const common = {
    dbPath,
    migrationDir: path.join(repoRoot, 'resources', 'app', 'migrations'),
    manifestPath: path.join(repoRoot, 'resources', 'app', 'migrations', 'manifest.json'),
    backupDir: path.join(root, 'backups'),
    lockPath: path.join(root, 'migration.lock'),
    lockTimeoutMs: 3000,
  };
  try {
    db.exec(`CREATE TABLE customers (id TEXT PRIMARY KEY, phone_normalized TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, data_json TEXT NOT NULL);\n      PRAGMA user_version=20;`);
    db.exec("INSERT INTO customers(id,phone_normalized,deleted,data_json) VALUES('c1','919876543210',0,'{}'),('c2','919876543210',0,'{}')");
    let crmRejected = false;
    try { runMigrations({ db, ...common }); } catch (error) { crmRejected = error.code === 'CRM_PHONE_CONFLICT' && Array.isArray(error.conflicts) && error.conflicts.length === 1; }
    assert(crmRejected, 'migration 021 must fail closed with a CRM_PHONE_CONFLICT report');
    assert(Number(db.prepare('PRAGMA user_version').get().user_version) === 20, 'CRM conflict preflight advanced schema version');
  } finally { try { db.close(); } catch {} }
  const groupDb = new DatabaseSync(dbPath);
  try {
    groupDb.exec(`DROP TABLE customers; CREATE TABLE ws_group_monitor_targets (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, account_id TEXT NOT NULL, group_jid TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0); PRAGMA user_version=21;`);
    groupDb.exec("INSERT INTO ws_group_monitor_targets(id,profile_id,account_id,group_jid,enabled) VALUES('t1','p1','acct','1203@g.us',1),('t2','p2','acct','1203@g.us',1)");
    let groupRejected = false;
    try { runMigrations({ db: groupDb, ...common }); } catch (error) { groupRejected = error.code === 'GROUP_TARGET_CONFLICT' && Array.isArray(error.conflicts) && error.conflicts.length === 1; }
    assert(groupRejected, 'migration 022 must fail closed with a GROUP_TARGET_CONFLICT report');
    assert(Number(groupDb.prepare('PRAGMA user_version').get().user_version) === 21, 'group target conflict preflight advanced schema version');
    return { crmConflict: true, groupConflict: true };
  } finally { try { groupDb.close(); } catch {} fs.rmSync(root, { recursive: true, force: true }); }
}

async function main() {
  if (process.argv[2] === '--child') return childRun(process.argv[3]);
  const fx = fixture();
  const db = openFixture(fx);
  try {
    const first = run(fx, db);
    assert(first.version === 18, `fresh fixture must reach 18, got ${first.version}`);
    assert(first.applied.length === 15, `fresh fixture should apply 15 entries, got ${first.applied.length}`);
    assert(first.integrity.ok === true, 'fresh run must report an integrity check');
    assert(fs.readdirSync(fx.backupDir).length >= 1, 'fresh run must create a backup before writes');

    const second = run(fx, db);
    assert(second.version === 18 && second.applied.length === 0, 'rerun must be idempotent');
    assert(Number(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n) === 15, 'rerun duplicated migration metadata');

    const tamperedPath = path.join(fx.migrationDir, '018-fixture.sql');
    fs.appendFileSync(tamperedPath, '-- tampered\n');
    assert(fx.entries.at(-1).checksum !== hashMigration(tamperedPath), 'tamper fixture did not change checksum');
    let checksumRejected = false;
    try { run(fx, db); } catch (error) { checksumRejected = error.code === 'MIGRATION_CHECKSUM_MISMATCH'; }
    assert(checksumRejected, 'an applied migration with a changed checksum must be rejected');
    fs.writeFileSync(tamperedPath, 'CREATE TABLE IF NOT EXISTS fixture_v18(id INTEGER PRIMARY KEY, value TEXT NOT NULL);\n');

    const high = fixture();
    const highDb = openFixture(high);
    highDb.exec('PRAGMA user_version = 99');
    let highRejected = false;
    try { run(high, highDb); } catch (error) { highRejected = error.code === 'SCHEMA_VERSION_UNSUPPORTED'; }
    assert(highRejected, 'a database above the manifest version must be rejected');
    assert(!fs.existsSync(path.join(high.root, 'backups')), 'high-version rejection must not create a backup');
    highDb.close();
    fs.rmSync(high.root, { recursive: true, force: true });

    const unregistered = fixture();
    fs.writeFileSync(path.join(unregistered.migrationDir, '019-unregistered.sql'), 'CREATE TABLE ignored(id INTEGER PRIMARY KEY);\n');
    const unregisteredDb = openFixture(unregistered);
    let unregisteredRejected = false;
    try { run(unregistered, unregisteredDb); } catch (error) { unregisteredRejected = error.code === 'MIGRATION_MANIFEST_UNREGISTERED'; }
    assert(unregisteredRejected, 'an SQL migration not listed in the manifest must be rejected');
    unregisteredDb.close();
    fs.rmSync(unregistered.root, { recursive: true, force: true });

    const failing = fixture();
    const failingDb = openFixture(failing);
    run(failing, failingDb);
    const failingSql = 'ALTER TABLE fixture_v18 ADD COLUMN staged TEXT; INSERT INTO missing_fixture VALUES(1);';
    fs.writeFileSync(path.join(failing.migrationDir, '019-failing.sql'), failingSql);
    writeManifest(failing.root, [...failing.entries, { version: 19, file: '019-failing.sql', description: 'fixture 19', checksum: sha256(failingSql) }]);
    let failed = false;
    try { run(failing, failingDb); } catch (error) { failed = error.code === 'MIGRATION_FAILED'; }
    assert(failed, 'a failing migration must surface MIGRATION_FAILED');
    assert(Number(failingDb.prepare('PRAGMA user_version').get().user_version) === 18, 'failed migration advanced user_version');
    assert(!failingDb.prepare('PRAGMA table_info(fixture_v18)').all().some(column => column.name === 'staged'), 'failed migration leaked DDL');
    failingDb.close();

    const concurrent = fixture({ extra: [{ version: 19, file: '019-final.sql', sql: 'ALTER TABLE fixture_v18 ADD COLUMN staged TEXT;' }] });
    const children = await Promise.all([spawnRunner(concurrent.root), spawnRunner(concurrent.root)]);
    assert(children.every(child => child.status === 0), `concurrent runners failed: ${children.map(child => child.stderr).join(' | ')}`);
    const concurrentDb = openFixture(concurrent);
    assert(Number(concurrentDb.prepare('PRAGMA user_version').get().user_version) === 19, 'concurrent runners did not converge');
    assert(Number(concurrentDb.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n) === 16, 'concurrent runners duplicated records');
    concurrentDb.close();

    const locked = fixture();
    const lockFd = fs.openSync(locked.lockPath, 'wx');
    fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid, token: 'held' }));
    fs.closeSync(lockFd);
    const lockedDb = openFixture(locked);
    let timedOut = false;
    try { run(locked, lockedDb, { lockTimeoutMs: 80 }); } catch (error) { timedOut = error.code === 'MIGRATION_LOCK_TIMEOUT'; }
    assert(timedOut, 'an active migration lock must be respected');
    lockedDb.close();
    fs.rmSync(locked.root, { recursive: true, force: true });

    const conflictPreflight = realMigrationConflictPreflight();

    db.close();
    fs.rmSync(fx.root, { recursive: true, force: true });
    fs.rmSync(failing.root, { recursive: true, force: true });
    fs.rmSync(concurrent.root, { recursive: true, force: true });
    process.stdout.write(JSON.stringify({ ok: true, fresh: 18, rerun: true, checksum: true, highVersion: true, rollback: true, concurrency: true, lock: true, conflictPreflight }));
  } finally {
    try { db.close(); } catch {}
    if (fs.existsSync(fx.root)) fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
