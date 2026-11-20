'use strict';

/*
 * SQLite schema migration runner used by the local sidecar.
 *
 * The runner is intentionally independent from server.mjs so it can be
 * exercised against a temporary DatabaseSync connection.  It owns the
 * migration manifest, checksum validation, the migration-only file lease,
 * preflight backup and integrity gates.  It never opens a database itself;
 * callers pass the already opened connection and its path.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { planWsIndexRecovery } = require('./modules/migration-ws-index-recovery.cjs');

const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
const DEFAULT_LOCK_POLL_MS = 25;
const DEFAULT_STALE_LOCK_MS = 5 * 60_000;

class MigrationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MigrationError';
    this.code = code;
    Object.assign(this, details);
  }
}

function hashMigration(value) {
  let content = value;
  if (typeof value === 'string' && fs.existsSync(value)) content = fs.readFileSync(value);
  if (typeof content === 'string' || Buffer.isBuffer(content)) {
    // SQL is text and may be checked out with CRLF on Windows.  Hash the
    // canonical LF form so a platform line-ending conversion is not mistaken
    // for a migration edit while comments/content changes remain detectable.
    const canonical = String(content).replace(/\r\n?/g, '\n');
    return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
  }
  throw new TypeError('migration content must be a path, string or Buffer');
}

function migrationError(code, message, details) {
  return new MigrationError(code, message, details);
}

function assertManifestEntry(entry, index) {
  if (!entry || !Number.isInteger(Number(entry.version)) || Number(entry.version) < 1) {
    throw migrationError('MIGRATION_MANIFEST_INVALID', `迁移清单第 ${index + 1} 项缺少有效 version。`);
  }
  if (typeof entry.file !== 'string' || !entry.file || path.basename(entry.file) !== entry.file || entry.file.includes('..')) {
    throw migrationError('MIGRATION_MANIFEST_INVALID', `迁移清单版本 ${entry.version} 的 file 不安全。`);
  }
  if (typeof entry.checksum !== 'string' || !/^[a-f0-9]{64}$/i.test(entry.checksum)) {
    throw migrationError('MIGRATION_MANIFEST_INVALID', `迁移清单版本 ${entry.version} 缺少 SHA-256 checksum。`);
  }
  if (typeof entry.description !== 'string' || !entry.description.trim()) {
    throw migrationError('MIGRATION_MANIFEST_INVALID', `迁移清单版本 ${entry.version} 缺少 description。`);
  }
}

function loadManifest({ migrationDir, manifestPath } = {}) {
  if (!migrationDir) throw new TypeError('migrationDir is required');
  const resolvedDir = path.resolve(migrationDir);
  const resolvedManifest = path.resolve(manifestPath || path.join(resolvedDir, 'manifest.json'));
  if (!fs.existsSync(resolvedManifest)) throw migrationError('MIGRATION_MANIFEST_MISSING', `缺少迁移 manifest: ${resolvedManifest}`);
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(resolvedManifest, 'utf8')); } catch (error) {
    throw migrationError('MIGRATION_MANIFEST_INVALID', `迁移 manifest 无法解析: ${error.message}`);
  }
  if (!parsed || !Array.isArray(parsed.migrations) || parsed.migrations.length === 0) {
    throw migrationError('MIGRATION_MANIFEST_INVALID', '迁移 manifest 必须包含非空 migrations 数组。');
  }
  const entries = parsed.migrations.map((entry, index) => ({
    version: Number(entry.version),
    file: entry.file,
    description: entry.description,
    checksum: String(entry.checksum || '').toLowerCase(),
  }));
  const discoveredFiles = fs.readdirSync(resolvedDir).filter(name => /^\d{3}-.+\.sql$/i.test(name));
  const listedFiles = new Set(entries.map(entry => entry.file));
  const unregisteredFiles = discoveredFiles.filter(name => !listedFiles.has(name));
  if (unregisteredFiles.length) {
    throw migrationError('MIGRATION_MANIFEST_UNREGISTERED', `发现未登记的迁移文件: ${unregisteredFiles.join(', ')}`, { files: unregisteredFiles });
  }
  entries.sort((a, b) => a.version - b.version);
  const seen = new Set();
  entries.forEach((entry, index) => {
    assertManifestEntry(entry, index);
    if (seen.has(entry.version)) throw migrationError('MIGRATION_MANIFEST_INVALID', `迁移版本重复: ${entry.version}`);
    seen.add(entry.version);
    const filePath = path.join(resolvedDir, entry.file);
    if (!fs.existsSync(filePath)) throw migrationError('MIGRATION_FILE_MISSING', `缺少迁移文件 ${entry.file}。`, { version: entry.version, file: entry.file });
    const actualChecksum = hashMigration(filePath);
    if (actualChecksum !== entry.checksum) {
      throw migrationError('MIGRATION_CHECKSUM_MISMATCH', `迁移文件 ${entry.file} 的 checksum 与 manifest 不一致。`, {
        version: entry.version,
        file: entry.file,
        expectedChecksum: entry.checksum,
        actualChecksum,
      });
    }
    entry.sql = fs.readFileSync(filePath, 'utf8');
    entry.filePath = filePath;
  });
  const supportedSchemaVersion = Number(parsed.supportedSchemaVersion || entries.at(-1).version);
  if (!Number.isInteger(supportedSchemaVersion) || supportedSchemaVersion < entries.at(-1).version) {
    throw migrationError('MIGRATION_MANIFEST_INVALID', 'supportedSchemaVersion 必须覆盖 manifest 中的最高版本。');
  }
  return {
    format: Number(parsed.format || 1),
    supportedSchemaVersion,
    migrations: entries,
    path: resolvedManifest,
  };
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

function waitMs(milliseconds) {
  if (milliseconds <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function lockLooksActive(lockPath, staleLockMs) {
  let stat;
  try { stat = fs.statSync(lockPath); } catch (error) { return error.code !== 'ENOENT'; }
  let owner = null;
  try { owner = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch {}
  const age = Math.max(0, Date.now() - stat.mtimeMs);
  if (owner && processIsAlive(Number(owner.pid)) && age < staleLockMs) return true;
  if (!owner && age < staleLockMs) return true;
  return false;
}

function acquireMigrationLock(lockPath, options = {}) {
  const timeoutMs = Number(options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
  const pollMs = Number(options.pollMs ?? DEFAULT_LOCK_POLL_MS);
  const staleLockMs = Number(options.staleLockMs ?? DEFAULT_STALE_LOCK_MS);
  const resolved = path.resolve(lockPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const token = crypto.randomUUID();
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (true) {
    let fd;
    try {
      fd = fs.openSync(resolved, 'wx');
      const owner = { pid: process.pid, host: os.hostname(), token, generation: token, startedAt: new Date().toISOString() };
      fs.writeFileSync(fd, JSON.stringify(owner));
      fs.closeSync(fd);
      fd = undefined;
      return {
        path: resolved,
        token,
        release() {
          try {
            const current = JSON.parse(fs.readFileSync(resolved, 'utf8'));
            if (current.token === token) fs.rmSync(resolved, { force: true });
          } catch {}
        },
      };
    } catch (error) {
      if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
      if (error.code !== 'EEXIST') throw error;
      if (!lockLooksActive(resolved, staleLockMs)) { try { fs.rmSync(resolved, { force: true }); } catch {} continue; }
      if (Date.now() >= deadline) throw migrationError('MIGRATION_LOCK_TIMEOUT', `迁移锁等待超时: ${resolved}`, { lockPath: resolved });
      waitMs(Math.min(pollMs, Math.max(1, deadline - Date.now())));
    }
  }
}

function readIntegrity(db) {
  const integrity = db.prepare('PRAGMA integrity_check').all().map(row => Object.values(row)[0]);
  const quickCheck = db.prepare('PRAGMA quick_check').all().map(row => Object.values(row)[0]);
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
  const ok = integrity.length === 1 && integrity[0] === 'ok' && quickCheck.length === 1 && quickCheck[0] === 'ok' && foreignKeys.length === 0;
  return { ok, integrity, quickCheck, foreignKeys };
}

function assertIntegrity(db, phase) {
  const result = readIntegrity(db);
  if (!result.ok) throw migrationError('MIGRATION_INTEGRITY_FAILED', `${phase} 完整性检查失败。`, { integrity: result });
  return result;
}

function tableColumns(db, tableName) {
  try { return db.prepare(`PRAGMA table_info(${tableName})`).all().map(row => String(row.name)); } catch { return []; }
}

function ensureSchemaMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL,
      description TEXT NOT NULL,
      checksum TEXT NOT NULL
    );
  `);
  const columns = tableColumns(db, 'schema_migrations');
  if (!columns.includes('checksum')) db.exec("ALTER TABLE schema_migrations ADD COLUMN checksum TEXT NOT NULL DEFAULT ''");
}

// A Stage 4 manifest was calculated before removing one terminal blank line.
// This exception proves the exact old bytes and the resulting schema; it does
// not weaken file checksum validation or rewrite the migration registry.
const MIGRATION_024_CANONICAL = '9dc642557b9007b9de83c73aab035e017caa7d41a2ed58b1cb275e9fb9dd640f';
const MIGRATION_024_EXTRA_LF = 'eeff6bc11ed4de1573199d1cb71897b7853b5f750c0b7cd353dfff4a1cbda4b6';
const MIGRATION_024_TABLES = ['ai_jobs', 'ai_crm_suggestions', 'ai_job_evidence', 'ai_task_audit'];
function migration024SchemaFingerprint(db) {
  const marks = MIGRATION_024_TABLES.map(() => '?').join(',');
  const rows = db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name IN (${marks}) ORDER BY type,name`).all(...MIGRATION_024_TABLES);
  return crypto.createHash('sha256').update(JSON.stringify(rows.map(row => ({ ...row, sql: row.sql == null ? null : String(row.sql).replace(/\r\n?/g, '\n').trim() })))).digest('hex');
}
function expected024SchemaFingerprint(manifest, version) {
  const { DatabaseSync } = require('node:sqlite');
  const expected = new DatabaseSync(':memory:');
  try {
    for (const migration of manifest.migrations.filter(item => item.version <= version)) {
      applyMigrationCompatibility(expected, migration);
      expected.exec(migration.version === 24 ? migration.sql + '\n' : migration.sql);
    }
    return migration024SchemaFingerprint(expected);
  } finally { expected.close(); }
}
function known024Compatibility(db, manifest, entry, row, currentVersion) {
  if (entry.version !== 24 || entry.file !== '024-ai-pipeline-crm-review.sql' || entry.checksum !== MIGRATION_024_CANONICAL ||
      String(row.checksum).toLowerCase() !== MIGRATION_024_EXTRA_LF || hashMigration(entry.sql + '\n') !== MIGRATION_024_EXTRA_LF) return null;
  if (currentVersion < 24) throw migrationError('MIGRATION_COMPATIBILITY_SCHEMA_MISMATCH', '024 兼容记录与数据库版本不一致。');
  const fingerprint = migration024SchemaFingerprint(db), expected = expected024SchemaFingerprint(manifest, currentVersion);
  if (fingerprint !== expected) throw migrationError('MIGRATION_COMPATIBILITY_SCHEMA_MISMATCH', '024 已执行 checksum 只有在真实 schema 与精确终止换行变体一致时才可兼容。', { version: 24 });
  return { version: 24, file: entry.file, status: 'accepted-with-audit', legacyChecksum: MIGRATION_024_EXTRA_LF, canonicalChecksum: MIGRATION_024_CANONICAL, schemaVersion: currentVersion, schemaFingerprint: fingerprint, reason: 'byte-exact-extra-terminal-LF', originalRegistryRetained: true };
}
function compatibilityBackupHash(file) {
  const hash = crypto.createHash('sha256'), buffer = Buffer.allocUnsafe(64 * 1024), fd = fs.openSync(file, 'r');
  try { let bytes; while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes)); return hash.digest('hex'); }
  finally { fs.closeSync(fd); }
}
function compatibilityAuditState(options, manifest, compatibility, currentVersion) {
  if (!compatibility.length) return { path: null, exists: false };
  if (!options.dbPath || !fs.existsSync(path.resolve(options.dbPath))) throw migrationError('MIGRATION_COMPATIBILITY_BACKUP_REQUIRED', '024 兼容需要真实隔离或工作区文件及迁移前备份。');
  const backupDir = path.resolve(options.backupDir || path.join(path.dirname(options.dbPath), '.backups'));
  const auditPath = path.join(backupDir, 'compatibility', 'migration-024-extra-terminal-lf.json');
  if (!fs.existsSync(auditPath)) return { path: auditPath, exists: false };
  let audit;
  try { audit = JSON.parse(fs.readFileSync(auditPath, 'utf8')); } catch { throw migrationError('MIGRATION_COMPATIBILITY_AUDIT_INVALID', '024 兼容审计文件损坏，已拒绝覆盖或忽略。'); }
  if (!audit || typeof audit !== 'object' || Array.isArray(audit)) throw migrationError('MIGRATION_COMPATIBILITY_AUDIT_INVALID', '024 兼容审计格式无效，已拒绝覆盖或忽略。');
  const { proofSha256, ...unsigned } = audit;
  const proof = crypto.createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
  if (audit.format !== 'zhike-migration-024-eof-proof-v1' || proofSha256 !== proof ||
      audit.dbPath !== path.resolve(options.dbPath) || audit.legacyChecksum !== MIGRATION_024_EXTRA_LF ||
      audit.canonicalChecksum !== MIGRATION_024_CANONICAL || audit.reason !== 'byte-exact-extra-terminal-LF' ||
      !Number.isInteger(audit.schemaVersion) || audit.schemaVersion < 24 || audit.schemaVersion > currentVersion ||
      audit.schemaFingerprint !== expected024SchemaFingerprint(manifest, audit.schemaVersion)) {
    throw migrationError('MIGRATION_COMPATIBILITY_AUDIT_INVALID', '024 兼容审计证据不匹配，已拒绝覆盖或忽略。');
  }
  try { if (typeof audit.backupPath !== 'string' || !/^[a-f0-9]{64}$/.test(audit.backupSha256 || '') || compatibilityBackupHash(audit.backupPath) !== audit.backupSha256) throw new Error('backup hash mismatch'); }
  catch { throw migrationError('MIGRATION_COMPATIBILITY_BACKUP_INVALID', '024 兼容的原始备份缺失或校验失败，已拒绝继续。'); }
  return { path: auditPath, exists: true };
}
function writeCompatibilityAudit(options, auditState, compatibility, backupPath) {
  if (!compatibility.length || auditState.exists) return;
  if (!backupPath) throw migrationError('MIGRATION_COMPATIBILITY_BACKUP_REQUIRED', '024 兼容必须在任何升级或审计写入前完成备份。');
  const record = { format: 'zhike-migration-024-eof-proof-v1', dbPath: path.resolve(options.dbPath), ...compatibility[0], backupPath, backupSha256: compatibilityBackupHash(backupPath), createdAt: new Date().toISOString() };
  const proofSha256 = crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex');
  const temporary = auditState.path + '.' + process.pid + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
  try {
    fs.mkdirSync(path.dirname(auditState.path), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify({ ...record, proofSha256 }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, auditState.path);
  } catch (cause) {
    try { fs.rmSync(temporary, { force: true }); } catch {}
    throw migrationError('MIGRATION_COMPATIBILITY_AUDIT_FAILED', '024 兼容审计无法原子保存，升级未继续。', { cause });
  }
}

function inspectApplied(db, manifest, currentVersion) {
  const columns = tableColumns(db, 'schema_migrations');
  if (columns.length === 0) return { rows: new Map(), compatibility: [], hasChecksum: false, needsTable: true, needsBackfill: false };
  const select = columns.includes('checksum')
    ? 'SELECT version,description,checksum FROM schema_migrations'
    : 'SELECT version,description,NULL AS checksum FROM schema_migrations';
  const rows = new Map(db.prepare(select).all().map(row => [Number(row.version), row]));
  const compatibility = [];
  for (const row of rows.values()) {
    const entry = manifest.migrations.find(item => item.version === row.version);
    if (!entry) throw migrationError('MIGRATION_METADATA_UNKNOWN', `数据库记录了未受支持的迁移版本 ${row.version}。`, { version: row.version });
    if (row.checksum && String(row.checksum).toLowerCase() !== entry.checksum) {
      const accepted = known024Compatibility(db, manifest, entry, row, currentVersion);
      if (accepted) { compatibility.push(accepted); continue; }
      throw migrationError('MIGRATION_CHECKSUM_MISMATCH', `已执行迁移 ${entry.file} 的 checksum 不一致。`, {
        version: entry.version,
        expectedChecksum: entry.checksum,
        actualChecksum: row.checksum,
      });
    }
  }
  return { rows, compatibility, hasChecksum: columns.includes('checksum'), needsTable: false, needsBackfill: [...rows.values()].some(row => !row.checksum) };
}

function backupDatabase(dbPath, backupDir, integrity) {
  if (!dbPath || !backupDir) return null;
  const resolvedDb = path.resolve(dbPath);
  if (!fs.existsSync(resolvedDb)) throw migrationError('MIGRATION_BACKUP_FAILED', `数据库文件不存在，无法备份: ${resolvedDb}`);
  fs.mkdirSync(path.resolve(backupDir), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(path.resolve(backupDir), `migration-${stamp}-${process.pid}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
  try {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'modules', 'migration-backup.cjs'), resolvedDb, target],
      { windowsHide: true, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr.trim() || `SQLite 备份进程退出 ${result.status}`);
    const snapshot = JSON.parse(result.stdout);
    if (JSON.stringify(snapshot) !== JSON.stringify(integrity)) throw new Error('独立快照与源数据库完整性检查结果不同。');
  } catch (error) {
    for (const suffix of ['', '-wal', '-shm', '-journal']) { try { fs.rmSync(target + suffix, { force: true }); } catch {} }
    throw migrationError('MIGRATION_BACKUP_FAILED', `数据库备份失败: ${error.message}`, { cause: error });
  }
  return target;
}

function setUserVersion(db, version) {
  if (!Number.isInteger(version) || version < 0) throw new TypeError('schema version must be a non-negative integer');
  db.exec(`PRAGMA user_version = ${version}`);
}

// Legacy 6.0 sidecars created ai_jobs inline and some workspaces therefore
// reach the migration boundary with the table present but without the lease
// column.  Keep this compatibility step inside the versioned runner so the
// server never owns ad-hoc schema DDL.  It runs in the same transaction as the
// authoritative 020 migration and is a no-op for fresh/full-schema tables.
function applyMigrationCompatibility(db, entry) {
  if (entry.version !== 20 || !/ai-schema-authority/i.test(entry.file)) return;
  const columns = tableColumns(db, 'ai_jobs');
  if (columns.length && !columns.includes('lease_token')) {
    db.exec("ALTER TABLE ai_jobs ADD COLUMN lease_token TEXT NOT NULL DEFAULT ''");
  }
}

function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tableName));
}

function preflightMigrationConflicts(db, entry) {
  if (entry.version === 21 && tableExists(db, 'customers')) {
    const conflicts = db.prepare(`
      SELECT phone_normalized AS canonical_phone, COUNT(*) AS count
      FROM customers
      WHERE deleted=0 AND phone_normalized<>''
      GROUP BY phone_normalized
      HAVING COUNT(*) > 1
      ORDER BY phone_normalized
    `).all().map(row => ({
      canonicalPhone: String(row.canonical_phone),
      count: Number(row.count),
      customerIds: db.prepare('SELECT id FROM customers WHERE deleted=0 AND phone_normalized=? ORDER BY id').all(row.canonical_phone).map(item => String(item.id)),
    }));
    if (conflicts.length) throw migrationError('CRM_PHONE_CONFLICT', '迁移 021 发现活动客户 canonical phone 冲突，已拒绝建立唯一约束。', { version: entry.version, file: entry.file, conflicts });
  }
  if (entry.version === 22 && tableExists(db, 'ws_group_monitor_targets')) {
    const targetColumns = tableColumns(db, 'ws_group_monitor_targets');
    const hasProfileId = targetColumns.includes('profile_id');
    const conflicts = db.prepare(`
      SELECT account_id, group_jid, COUNT(*) AS count
      FROM ws_group_monitor_targets
      WHERE enabled=1
      GROUP BY account_id, group_jid
      HAVING COUNT(*) > 1
      ORDER BY account_id, group_jid
    `).all().map(row => ({
      accountId: String(row.account_id),
      groupJid: String(row.group_jid),
      count: Number(row.count),
      targetIds: db.prepare('SELECT id FROM ws_group_monitor_targets WHERE account_id=? AND group_jid=? AND enabled=1 ORDER BY id').all(row.account_id, row.group_jid).map(item => String(item.id)),
      profileIds: hasProfileId ? db.prepare('SELECT profile_id FROM ws_group_monitor_targets WHERE account_id=? AND group_jid=? AND enabled=1 ORDER BY id').all(row.account_id, row.group_jid).map(item => String(item.profile_id)) : [],
    }));
    if (conflicts.length) throw migrationError('GROUP_TARGET_CONFLICT', '迁移 022 发现同一账号启用重复群组目标，已拒绝建立唯一约束。', { version: entry.version, file: entry.file, conflicts });
  }
}

function applyMigration(db, entry) {
  applyMigrationCompatibility(db, entry);
  db.exec(entry.sql);
  db.prepare('INSERT INTO schema_migrations(version,applied_at,description,checksum) VALUES(?,?,?,?)').run(entry.version, new Date().toISOString(), entry.description, entry.checksum);
  setUserVersion(db, entry.version);
  const integrity = assertIntegrity(db, `迁移 ${entry.version}`);
  return { version: entry.version, file: entry.file, checksum: entry.checksum, integrity };
}

function initializeEmptyDatabase(db, manifest) {
  // The caller has verified an entirely empty schema under the migration
  // lease. Keep the registry, all DDL and user_version in the same transaction
  // so first use needs one durable commit and cannot leave a partial schema.
  const applied = [];
  try {
    db.exec('BEGIN IMMEDIATE');
    ensureSchemaMigrationsTable(db);
    for (const entry of manifest.migrations) {
      preflightMigrationConflicts(db, entry);
      try {
        applied.push(applyMigration(db, entry));
      } catch (error) {
        if (error instanceof MigrationError && error.code === 'MIGRATION_INTEGRITY_FAILED') throw error;
        throw migrationError('MIGRATION_FAILED', `迁移 ${entry.version} (${entry.file}) 失败: ${error.message}`, { version: entry.version, file: entry.file, cause: error });
      }
    }
    const integrity = assertIntegrity(db, '迁移后');
    db.exec('COMMIT');
    return { applied, integrity };
  } catch (error) {
    // Also cover registry creation, conflict preflights, the final integrity
    // gate and COMMIT failures, not just errors inside a migration's SQL.
    try { db.exec('ROLLBACK'); } catch {}
    if (error instanceof MigrationError) throw error;
    throw migrationError('MIGRATION_FAILED', `空数据库初始化失败: ${error.message}`, { cause: error });
  }
}

function runMigrations(options = {}) {
  const { db } = options;
  if (!db || typeof db.prepare !== 'function' || typeof db.exec !== 'function') throw new TypeError('db DatabaseSync connection is required');
  const manifest = loadManifest(options);
  const maxVersion = Math.min(manifest.supportedSchemaVersion, manifest.migrations.at(-1).version);
  // Configure the connection before the first read.  A previous process may
  // have just released its migration file lease while SQLite is still
  // closing a WAL handle; retry the read during that short handoff window.
  db.exec('PRAGMA busy_timeout = 5000');
  const readVersion = () => {
    let lastError;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try { return Number(db.prepare('PRAGMA user_version').get().user_version || 0); } catch (error) {
        lastError = error;
        if (!/database is locked|database table is locked|SQLITE_BUSY/i.test(String(error.message || error))) throw error;
        waitMs(25);
      }
    }
    throw lastError;
  };
  const lock = acquireMigrationLock(options.lockPath || path.join(path.dirname(options.dbPath || 'workspace.sqlite'), '.migration.lock'), {
    timeoutMs: options.lockTimeoutMs,
    pollMs: options.lockPollMs,
    staleLockMs: options.staleLockMs,
  });
  try {
    // Read the version only after acquiring the migration lease.  A second
    // process may already be switching journal mode or committing DDL; doing
    // this read before the lease would race SQLite's schema lock and surface a
    // spurious `database is locked` error instead of waiting for the owner.
    let current = readVersion();
    // Historical device packages have a reviewed target schema. Build only a
    // fresh, private candidate at that version. Every SQL file has already
    // passed manifest verification, including the migrations after the target.
    if (Object.hasOwn(options, 'initializeAtVersion')) {
      const version = options.initializeAtVersion;
      if (!manifest.migrations.some(entry => entry.version === version)) {
        throw migrationError('MIGRATION_TARGET_INVALID', '请求的初始化版本未登记。');
      }
      if (current !== 0 || db.prepare('SELECT 1 FROM sqlite_master LIMIT 1').get()) {
        throw migrationError('MIGRATION_TARGET_NOT_EMPTY', '指定历史版本仅适用于空白恢复目标。');
      }
      manifest.migrations = manifest.migrations.filter(entry => entry.version <= version);
    }
    if (current > maxVersion) throw migrationError('SCHEMA_VERSION_UNSUPPORTED', `数据库 schema 版本 ${current} 高于当前支持版本 ${maxVersion}，已拒绝写入。`, { currentVersion: current, supportedVersion: maxVersion, readOnly: true });
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    const appliedBefore = inspectApplied(db, manifest, current);
    const auditState = compatibilityAuditState(options, manifest, appliedBefore.compatibility, current);
    if (appliedBefore.compatibility.length && !auditState.exists && options.backup === false) throw migrationError('MIGRATION_COMPATIBILITY_BACKUP_REQUIRED', '024 兼容首次启用不能禁用迁移前备份。');
    const pending = manifest.migrations.filter(entry => entry.version > current);
    const needsMetadata = appliedBefore.needsTable || !appliedBefore.hasChecksum || appliedBefore.needsBackfill;
    const preIntegrity = readIntegrity(db);
    const repairs = planWsIndexRecovery(db, manifest, current, preIntegrity);
    if (!preIntegrity.ok && !repairs.length) {
      throw migrationError('MIGRATION_INTEGRITY_FAILED', '迁移前完整性检查失败。', { integrity: preIntegrity });
    }
    const needsBackup = pending.length || needsMetadata || repairs.length || (appliedBefore.compatibility.length && !auditState.exists);
    if (repairs.length && (options.backup === false || !options.dbPath)) {
      throw migrationError('MIGRATION_INDEX_BACKUP_REQUIRED', '修复 WS 二级索引需要可验证的原始 SQLite 快照。', { integrity: preIntegrity });
    }
    const backupDir = options.backupDir || path.join(path.dirname(options.dbPath || ''), '.backups');
    let backupPath = null;
    if (repairs.length) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const locked = readIntegrity(db);
        const currentPlan = planWsIndexRecovery(db, manifest, current, locked);
        if (JSON.stringify(currentPlan) !== JSON.stringify(repairs) || JSON.stringify(locked) !== JSON.stringify(preIntegrity)) {
          throw migrationError('MIGRATION_INDEX_STATE_CHANGED', 'WS 索引在备份前已改变，请重新检查。', { integrity: locked });
        }
        backupPath = backupDatabase(options.dbPath, backupDir, locked);
        for (const repair of repairs) db.exec(repair.sql);
        assertIntegrity(db, 'WS 二级索引修复后');
        db.exec('COMMIT');
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch {}
        error.backupPath = backupPath;
        throw error;
      }
    } else if (needsBackup && options.backup !== false) {
      backupPath = backupDatabase(options.dbPath, backupDir, preIntegrity);
    }
    writeCompatibilityAudit(options, auditState, appliedBefore.compatibility, backupPath);
    db.exec('PRAGMA journal_mode = WAL;');
    // Version zero alone is not evidence of a new database: legacy workspaces
    // may already contain data, views or a migration registry. Only a schema
    // with no objects at all may take the atomic initialization path.
    if (current === 0 && !db.prepare('SELECT 1 FROM sqlite_master LIMIT 1').get()) {
      const { applied, integrity } = initializeEmptyDatabase(db, manifest);
      return { version: readVersion(), applied, backupPath, integrity, preIntegrity, manifest: manifest.path, compatibility: appliedBefore.compatibility, compatibilityAuditPath: auditState.path };
    }
    ensureSchemaMigrationsTable(db);
    const applied = [];
    for (const entry of manifest.migrations) {
      const row = db.prepare('SELECT version,description,checksum FROM schema_migrations WHERE version=?').get(entry.version);
      if (entry.version <= current) {
        // Older 6.0 workspaces can have a user_version set by the legacy
        // runner without an audit row (the v5 upgrade fixture is one example).
        // Preserve those schemas and establish the registry record as a
        // legacy backfill; future runs still verify the immutable checksum.
        if (!row) db.prepare('INSERT INTO schema_migrations(version,applied_at,description,checksum) VALUES(?,?,?,?)').run(entry.version, new Date().toISOString(), `${entry.description} (legacy backfill)`, entry.checksum);
        else if (row.checksum && String(row.checksum).toLowerCase() !== entry.checksum && !appliedBefore.compatibility.some(item => item.version === entry.version && item.legacyChecksum === String(row.checksum).toLowerCase())) throw migrationError('MIGRATION_CHECKSUM_MISMATCH', `已执行迁移 ${entry.file} 的 checksum 不一致。`, { version: entry.version, expectedChecksum: entry.checksum, actualChecksum: row.checksum });
        else if (!row.checksum) db.prepare('UPDATE schema_migrations SET checksum=? WHERE version=?').run(entry.checksum, entry.version);
        continue;
      }
      preflightMigrationConflicts(db, entry);
      try {
        db.exec('BEGIN IMMEDIATE');
        const migration = applyMigration(db, entry);
        db.exec('COMMIT');
        applied.push(migration);
        current = entry.version;
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch {}
        if (error instanceof MigrationError && error.code === 'MIGRATION_INTEGRITY_FAILED') throw error;
        throw migrationError('MIGRATION_FAILED', `迁移 ${entry.version} (${entry.file}) 失败: ${error.message}`, { version: entry.version, file: entry.file, cause: error });
      }
    }
    const integrity = assertIntegrity(db, '迁移后');
    return { version: readVersion(), applied, backupPath, integrity, preIntegrity, repairedIndexes: repairs.map(repair => repair.name), manifest: manifest.path, compatibility: appliedBefore.compatibility, compatibilityAuditPath: auditState.path };
  } finally {
    lock.release();
  }
}

module.exports = {
  MigrationError,
  acquireMigrationLock,
  hashMigration,
  loadManifest,
  readIntegrity,
  runMigrations,
};
