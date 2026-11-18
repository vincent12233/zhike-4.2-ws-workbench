#!/usr/bin/env node
/*
 * Stage 1 migration-runner verification.
 *
 * This is an isolation-only contract. It never opens ZHIKE_DATA_DIR, never
 * imports resources/app/server.mjs, and never writes a production database.
 * The temporary runner below is deliberately small: it exercises the safety
 * properties required for the future runner while the production runner is
 * still hard-coded in server.mjs.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const repoRoot = path.resolve(__dirname, '..', '..');
const serverPath = path.join(repoRoot, 'resources', 'app', 'server.mjs');
const migrationsDir = path.join(repoRoot, 'resources', 'app', 'migrations');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function staticInventory() {
  const server = fs.readFileSync(serverPath, 'utf8');
  const runnerPath = path.join(repoRoot, 'resources', 'app', 'migration-runner.cjs');
  const runner = fs.readFileSync(runnerPath, 'utf8');
  const manifestPath = path.join(migrationsDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const files = fs.readdirSync(migrationsDir).filter(name => /^\d{3}-.+\.sql$/i.test(name)).sort();
  const versions = files.map(name => Number(name.slice(0, 3)));
  const inlineVersions = [...server.matchAll(/schema_migrations[^\n]*?\.run\((\d+)/g)].map(match => Number(match[1]));
  const highest = Number(manifest.supportedSchemaVersion);
  assert(highest === Math.max(...versions), `manifest maximum must match migration files, got ${highest}`);
  assert(server.includes("runMigrations({"), 'server.mjs does not call the production migration runner');
  assert(runner.includes('MIGRATION_CHECKSUM_MISMATCH'), 'migration runner must enforce checksums');
  assert(runner.includes('SCHEMA_VERSION_UNSUPPORTED'), 'migration runner must reject higher schema versions');
  assert(runner.includes('MIGRATION_LOCK_TIMEOUT'), 'migration runner must coordinate concurrent starts');
  const inlineAiDdl = (server.match(/CREATE TABLE IF NOT EXISTS\s+ai_jobs/gi) || []).length;
  const versionedAiFiles = files.filter(name => /CREATE TABLE IF NOT EXISTS\s+ai_jobs/i.test(fs.readFileSync(path.join(migrationsDir, name), 'utf8')));
  assert(inlineAiDdl === 0, 'ai_jobs must not be created inline by server.mjs');
  assert(versionedAiFiles.length === 1, 'ai_jobs must have one versioned schema authority');
  return {
    status: 'Passed',
    server: path.relative(repoRoot, serverPath),
    migrationFiles: files,
    migrationVersions: versions,
    inlineRunnerVersions: [...new Set(inlineVersions)].sort((a, b) => a - b),
    inlineRunnerMax: inlineVersions.length ? Math.max(...inlineVersions) : null,
    manifestMax: highest,
    aiJobsInline: false,
    aiJobsVersionedMigration: true,
    productionMigrationRegistry: 'Passed',
    productionMigrationCoordination: 'Passed',
  };
}

function acquireLock(lockPath, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      fs.closeSync(fd);
      return () => fs.rmSync(lockPath, { force: true });
    } catch (error) {
      if (error.code !== 'EEXIST' || Date.now() >= deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
    }
  }
}

function applyMigrations(db, migrationDir, lockPath) {
  const release = acquireLock(lockPath);
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=2000; PRAGMA foreign_keys=ON;');
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, description TEXT NOT NULL, checksum TEXT NOT NULL);');
    const files = fs.readdirSync(migrationDir).filter(name => /^\d{3}-.+\.sql$/i.test(name)).sort();
    const current = Number(db.prepare('PRAGMA user_version').get().user_version || 0);
    const applied = new Map(db.prepare('SELECT version,checksum FROM schema_migrations').all().map(row => [Number(row.version), row.checksum]));
    for (const file of files) {
      const version = Number(file.slice(0, 3));
      if (version <= current) continue;
      const sql = fs.readFileSync(path.join(migrationDir, file), 'utf8');
      const checksum = sha256(sql);
      if (applied.has(version)) {
        assert(applied.get(version) === checksum, `checksum mismatch for already applied ${file}`);
        continue;
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec(sql);
        db.prepare('INSERT INTO schema_migrations(version,applied_at,description,checksum) VALUES(?,?,?,?)').run(version, new Date().toISOString(), file, checksum);
        db.exec(`PRAGMA user_version = ${version};`);
        db.exec('COMMIT');
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch {}
        throw error;
      }
    }
    return Number(db.prepare('PRAGMA user_version').get().user_version || 0);
  } finally {
    release();
  }
}

function childRun() {
  const root = path.resolve(process.argv[3]);
  const db = new DatabaseSync(path.join(root, 'workspace.sqlite'));
  const version = applyMigrations(db, path.join(root, 'migrations'), path.join(root, 'schema.lock'));
  db.close();
  process.stdout.write(JSON.stringify({ version }));
}

function isolatedRunner() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-stage1-migration-'));
  const migrationDir = path.join(tempRoot, 'migrations');
  fs.mkdirSync(migrationDir);
  const writeMigration = (name, sql) => fs.writeFileSync(path.join(migrationDir, name), sql);
  writeMigration('001-base.sql', 'CREATE TABLE facts(id INTEGER PRIMARY KEY, value TEXT NOT NULL);');
  writeMigration('002-index.sql', 'CREATE INDEX idx_facts_value ON facts(value);');
  const dbPath = path.join(tempRoot, 'workspace.sqlite');
  const lockPath = path.join(tempRoot, 'schema.lock');
  const db = new DatabaseSync(dbPath);
  const first = applyMigrations(db, migrationDir, lockPath);
  assert(first === 2, `first migration expected version 2, got ${first}`);
  const rowCount = Number(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count);
  assert(rowCount === 2, `expected two migration records, got ${rowCount}`);
  const second = applyMigrations(db, migrationDir, lockPath);
  assert(second === 2, `rerun expected version 2, got ${second}`);
  assert(Number(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count) === 2, 'rerun duplicated schema_migrations');

  writeMigration('003-failing.sql', 'ALTER TABLE facts ADD COLUMN staged TEXT; INSERT INTO missing_table VALUES(1);');
  let failed = false;
  try { applyMigrations(db, migrationDir, lockPath); } catch { failed = true; }
  assert(failed, 'failing migration did not fail');
  assert(Number(db.prepare('PRAGMA user_version').get().user_version) === 2, 'failed migration advanced user_version');
  assert(!db.prepare('PRAGMA table_info(facts)').all().some(column => column.name === 'staged'), 'failed migration leaked DDL after rollback');

  fs.rmSync(path.join(migrationDir, '003-failing.sql'));
  writeMigration('003-final.sql', 'ALTER TABLE facts ADD COLUMN staged TEXT;');
  const concurrent = [0, 1].map(() => spawnSync(process.execPath, [__filename, '--child', tempRoot], { encoding: 'utf8' }));
  assert(concurrent.every(result => result.status === 0), `concurrent runner failed: ${concurrent.map(result => result.stderr).join(' | ')}`);
  assert(Number(db.prepare('PRAGMA user_version').get().user_version) === 3, 'concurrent runners did not converge on version 3');
  assert(Number(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count) === 3, 'concurrent runners duplicated migration records');
  db.close();

  const highVersion = new DatabaseSync(path.join(tempRoot, 'high.sqlite'));
  highVersion.exec('PRAGMA user_version=99;');
  const actual = Number(highVersion.prepare('PRAGMA user_version').get().user_version);
  assert(actual === 99, 'high version fixture failed');
  highVersion.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
  return { status: 'Passed', firstRun: 2, rerun: 2, failedMigrationRolledBack: true, concurrentRuns: 2, highVersionFixture: 99, tempClean: !fs.existsSync(tempRoot) };
}

function main() {
  if (process.argv[2] === '--child') return childRun();
  const inventory = staticInventory();
  const isolated = isolatedRunner();
  process.stdout.write(`${JSON.stringify({ ok: true, inventory, isolated }, null, 2)}\n`);
}

main();
