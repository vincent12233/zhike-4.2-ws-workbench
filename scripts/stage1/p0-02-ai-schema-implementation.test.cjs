'use strict';

/*
 * P0-02 implementation gate for the versioned AI schema consolidation.
 *
 * This file is intentionally read-only with respect to the product: it reads
 * server/migration source and creates only a temporary SQLite fixture.  It
 * never imports server.mjs, opens ZHIKE_DATA_DIR, runs a migration against a
 * product database, or starts an AI worker.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const repoRoot = path.resolve(__dirname, '..', '..');
const serverPath = path.join(repoRoot, 'resources', 'app', 'server.mjs');
const migrationsDir = path.join(repoRoot, 'resources', 'app', 'migrations');
const { runMigrations } = require(path.join(repoRoot, 'resources', 'app', 'migration-runner.cjs'));
const migrationManifest = JSON.parse(fs.readFileSync(path.join(migrationsDir, 'manifest.json'), 'utf8'));
const supportedSchemaVersion = Number(migrationManifest.supportedSchemaVersion);

const EXPECTED_JOB_FIELDS = [
  'id', 'account_id', 'conversation_id', 'idempotency_key', 'payload_json',
  'status', 'attempts', 'max_attempts', 'next_attempt_at', 'locked_at',
  'lease_token', 'last_error', 'analysis_id', 'created_at', 'updated_at',
];
const EXPECTED_STATUSES = ['queued', 'running', 'retryable', 'completed', 'failed', 'cancelled'];

const results = [];
function record(id, ok, evidence, remediation = '') {
  results.push({ id, status: ok ? 'Passed' : 'Failed', evidence, ...(remediation ? { remediation } : {}) });
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function read(relative) { return fs.readFileSync(path.join(repoRoot, relative), 'utf8'); }

function extractColumns(sql, tableName) {
  const match = sql.match(new RegExp(`CREATE TABLE(?: IF NOT EXISTS)?\\s+${tableName}\\s*\\(([\\s\\S]*?)\\n\\s*\\);`, 'i'));
  if (!match) return [];
  return match[1].split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => !/^(?:PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)\b/i.test(line))
    .map(line => line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+/)?.[1])
    .filter(Boolean);
}

function staticAudit() {
  const server = fs.readFileSync(serverPath, 'utf8');
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(name => /^\d{3}-.+\.sql$/i.test(name))
    .sort();
  const migrationSql = migrationFiles.map(name => ({ name, sql: fs.readFileSync(path.join(migrationsDir, name), 'utf8') }));
  const aiMigrations = migrationSql.filter(({ sql }) => /CREATE TABLE(?: IF NOT EXISTS)?\s+ai_jobs\b/i.test(sql));
  const inlineCreates = (server.match(/CREATE TABLE IF NOT EXISTS\s+ai_jobs\b/gi) || []).length;
  const inlineLeaseAlters = (server.match(/ALTER TABLE\s+ai_jobs\s+ADD COLUMN\s+lease_token/gi) || []).length;

  record(
    'schema-authority-single-source',
    inlineCreates === 0 && aiMigrations.length === 1,
    `server inline ai_jobs CREATE count=${inlineCreates}; versioned ai_jobs CREATE files=${aiMigrations.map(item => item.name).join(',') || '(none)'}`,
    'Move the existing ai_jobs DDL (including lease_token) into one versioned migration before adding any new queue tables.',
  );
  record(
    'lease-column-is-versioned',
    inlineLeaseAlters === 0 && aiMigrations.some(({ sql }) => /lease_token\s+TEXT/i.test(sql)),
    `server inline lease ALTER count=${inlineLeaseAlters}; versioned lease column=${aiMigrations.some(({ sql }) => /lease_token\s+TEXT/i.test(sql))}`,
    'The lease column must be part of the same authoritative migration and not added during server startup.',
  );

  const legacyInlineColumns = extractColumns(server, 'ai_jobs');
  const versionedColumns = aiMigrations.length === 1 ? extractColumns(aiMigrations[0].sql, 'ai_jobs') : [];
  const observedColumns = versionedColumns.length ? versionedColumns : legacyInlineColumns;
  record(
    'job-field-preservation',
    EXPECTED_JOB_FIELDS.every(field => observedColumns.includes(field)),
    `observed job fields=${observedColumns.join(',') || '(none)'}`,
    'Preserve every legacy field and idempotency key during the consolidation; do not silently drop lease, retry, or analysis references.',
  );

  const statusLiterals = new Set([...server.matchAll(/status(?:\s*=|\s+IN\s*\([^)]*)[^\n]*?['"](queued|running|retryable|completed|failed|cancelled)['"]/gi)].map(match => match[1]));
  record(
    'job-status-history-enumerated',
    EXPECTED_STATUSES.every(status => statusLiterals.has(status)),
    `status literals observed=${[...statusLiterals].sort().join(',')}`,
    'Freeze the six historical states and map them explicitly; completed/failed/cancelled rows must never be re-enqueued by backfill.',
  );

  // This is a concrete current bug/risk: startup recovery differs from the
  // lease-expiry recovery in /api/ws/ai-jobs and ignores max_attempts.
  const blindRecovery = /UPDATE ai_jobs SET status='queued'[^\n]*WHERE status='running'/i.test(server);
  record(
    'restart-recovery-preserves-history',
    !blindRecovery,
    `unconditional running->queued startup recovery=${blindRecovery}`,
    'Use one recovery transition that preserves attempts/max_attempts and distinguishes retryable from terminal failed work.',
  );

  const analysisMigrations = migrationSql.filter(({ sql }) => /CREATE TABLE(?: IF NOT EXISTS)?\s+ws_ai_analyses\b/i.test(sql));
  const analysesSql = analysisMigrations.at(-1)?.sql || '';
  const analysisColumns = extractColumns(analysesSql, 'ws_ai_analyses');
  record(
    'analysis-history-is-versioned',
    analysisColumns.length > 0 && ['id', 'account_id', 'conversation_id', 'result_json', 'confidence', 'provider_name', 'model', 'error_message', 'created_at', 'updated_at'].every(field => analysisColumns.includes(field)),
    `ws_ai_analyses columns=${analysisColumns.join(',') || '(none)'}`,
    'Keep ws_ai_analyses as the immutable-compatible result history while a new queue projection is introduced.',
  );

  const evidenceSql = migrationSql.filter(({ sql }) => /CREATE TABLE(?: IF NOT EXISTS)?\s+ai_customer_field_evidence\b/i.test(sql)).map(item => item.sql).join('\n');
  const evidenceHasUnique = /UNIQUE\s*\(\s*customer_id\s*,\s*analysis_id\s*,\s*field_name\s*\)/i.test(evidenceSql);
  record(
    'evidence-uniqueness-is-versioned',
    evidenceHasUnique,
    `ai_customer_field_evidence unique(customer_id,analysis_id,field_name)=${evidenceHasUnique}`,
    'Retain the existing evidence uniqueness barrier; legacy rows without message/segment provenance must be marked unscoped rather than fabricated.',
  );

  return {
    serverPath: path.relative(repoRoot, serverPath),
    migrationFiles,
    inlineCreates,
    inlineLeaseAlters,
    legacyInlineColumns,
    versionedAiJobsMigrations: aiMigrations.map(item => item.name),
  };
}

function isolatedHistoryFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-stage1-p0-02-'));
  const db = new DatabaseSync(path.join(tempRoot, 'fixture.sqlite'));
  let summary;
  try {
    db.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE ai_jobs (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        next_attempt_at TEXT NOT NULL DEFAULT '',
        locked_at TEXT NOT NULL DEFAULT '',
        lease_token TEXT NOT NULL DEFAULT '',
        last_error TEXT NOT NULL DEFAULT '',
        analysis_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(account_id, idempotency_key)
      );
      CREATE TABLE ws_ai_analyses (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        result_json TEXT NOT NULL,
        confidence REAL NOT NULL,
        provider_name TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        error_message TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE ai_customer_field_evidence (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL DEFAULT '',
        analysis_id TEXT NOT NULL DEFAULT '',
        field_name TEXT NOT NULL,
        value_json TEXT NOT NULL DEFAULT 'null',
        confidence REAL NOT NULL DEFAULT 0,
        source_text TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'accepted',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(customer_id, analysis_id, field_name)
      );
    `);

    const now = new Date().toISOString();
    const insertJob = db.prepare(`INSERT INTO ai_jobs
      (id,account_id,conversation_id,idempotency_key,payload_json,status,attempts,max_attempts,next_attempt_at,locked_at,lease_token,last_error,analysis_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    insertJob.run('job-completed', 'acct', 'conv-1', 'hist:conv-1:v1', '{"source":"history"}', 'completed', 1, 5, '', '', '', '', 'analysis-1', now, now);
    insertJob.run('job-retryable', 'acct', 'conv-2', 'hist:conv-2:v1', '{"source":"history"}', 'retryable', 2, 5, now, '', '', 'provider timeout', '', now, now);
    insertJob.run('job-cancelled', 'acct', 'conv-3', 'hist:conv-3:v1', '{"source":"history"}', 'cancelled', 1, 5, '', '', '', 'group excluded', '', now, now);
    insertJob.run('job-dead', 'acct', 'conv-4', 'hist:conv-4:v1', '{"source":"history"}', 'failed', 5, 5, '', '', '', 'permanent failure', '', now, now);
    db.prepare('INSERT INTO ws_ai_analyses(id,account_id,conversation_id,result_json,confidence,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('analysis-1', 'acct', 'conv-1', '{"summary":"done"}', 0.91, now, now);
    db.prepare('INSERT INTO ws_ai_analyses(id,account_id,conversation_id,result_json,confidence,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('analysis-orphan', 'acct', 'conv-x', '{"summary":"orphan"}', 0.75, now, now);

    const linkedCompleted = Number(db.prepare(`SELECT COUNT(*) AS count FROM ai_jobs j
      JOIN ws_ai_analyses a ON a.id=j.analysis_id AND a.account_id=j.account_id
      WHERE j.status='completed'`).get().count);
    const orphanAnalyses = Number(db.prepare(`SELECT COUNT(*) AS count FROM ws_ai_analyses a
      LEFT JOIN ai_jobs j ON j.analysis_id=a.id AND j.account_id=a.account_id
      WHERE j.id IS NULL`).get().count);
    const terminalRows = Number(db.prepare("SELECT COUNT(*) AS count FROM ai_jobs WHERE status IN ('completed','failed','cancelled')").get().count);
    assert(linkedCompleted === 1, `expected one linked completed job, got ${linkedCompleted}`);
    assert(orphanAnalyses === 1, `expected one orphan analysis, got ${orphanAnalyses}`);
    assert(terminalRows === 3, `expected three terminal history rows, got ${terminalRows}`);
    record('isolated-history-link-audit', true, `linked completed jobs=${linkedCompleted}; orphan analyses=${orphanAnalyses}; terminal history rows=${terminalRows}`);

    const evidence = db.prepare(`INSERT INTO ai_customer_field_evidence
      (id,customer_id,conversation_id,analysis_id,field_name,value_json,confidence,source_text,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
    evidence.run('e-1', 'customer-1', 'conv-1', 'analysis-1', 'occupation', '"analyst"', 0.9, 'source', 'accepted', now, now);
    let duplicateRejected = false;
    try { evidence.run('e-2', 'customer-1', 'conv-1', 'analysis-1', 'occupation', '"analyst"', 0.9, 'source', 'accepted', now, now); } catch { duplicateRejected = true; }
    assert(duplicateRejected, 'duplicate evidence field was accepted');
    record('isolated-evidence-uniqueness', true, 'duplicate (customer,analysis,field) rejected by SQLite unique constraint');

    let duplicateJobRejected = false;
    try { insertJob.run('job-duplicate', 'acct', 'conv-z', 'hist:conv-1:v1', '{}', 'queued', 0, 5, now, '', '', '', '', now, now); } catch { duplicateJobRejected = true; }
    assert(duplicateJobRejected, 'duplicate account/idempotency job was accepted');
    insertJob.run('job-cross-account', 'acct-2', 'conv-1', 'hist:conv-1:v1', '{}', 'queued', 0, 5, now, '', '', '', '', now, now);
    record('isolated-job-idempotency-scope', true, 'same account/key rejected while the same key in another account is accepted');

    summary = { linkedCompleted, orphanAnalyses, terminalRows, duplicateRejected, duplicateJobRejected };
  } finally {
    try { db.close(); } catch {}
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  return { ...summary, tempClean: !fs.existsSync(tempRoot) };
}

function isolatedLegacySchemaMigration() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-stage1-p0-02-migration-'));
  const dbPath = path.join(tempRoot, 'workspace.sqlite');
  const backupDir = path.join(tempRoot, 'backups');
  const lockPath = path.join(tempRoot, 'migration.lock');
  const db = new DatabaseSync(dbPath);
  try {
    // Model the real 6.0 inline schema boundary: ai_jobs exists, but the
    // lease column was introduced by the old startup ALTER and is absent.
    db.exec(`
      CREATE TABLE ai_jobs (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL DEFAULT 'default',
        conversation_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 5,
        next_attempt_at TEXT NOT NULL, locked_at TEXT NOT NULL DEFAULT '',
        last_error TEXT NOT NULL DEFAULT '', analysis_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(account_id,idempotency_key)
      );
      CREATE TABLE customers (
        id TEXT PRIMARY KEY, phone_normalized TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '', assistant TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '',
        stage TEXT NOT NULL DEFAULT '', deleted INTEGER NOT NULL DEFAULT 0, data_json TEXT NOT NULL
      );
      CREATE TABLE ws_group_monitor_targets (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, group_jid TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0, channel_id TEXT NOT NULL DEFAULT ''
      );
      PRAGMA user_version = 19;
    `);
    const result = runMigrations({
      db, dbPath, migrationDir: migrationsDir,
      manifestPath: path.join(migrationsDir, 'manifest.json'),
      backupDir, lockPath, lockTimeoutMs: 3000,
    });
    const aiColumns = db.prepare('PRAGMA table_info(ai_jobs)').all().map(row => row.name);
    assert(result.version === supportedSchemaVersion, `legacy schema migration must reach ${supportedSchemaVersion}, got ${result.version}`);
    assert(aiColumns.includes('lease_token'), 'legacy ai_jobs table did not receive lease_token inside migration 020');
    assert(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='customer_group_memberships'").get(), 'group identity ledger was not created');
    assert(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_customers_phone_active'").get(), 'CRM active phone uniqueness index was not created');
    record('isolated-legacy-schema-migration', true, `legacy user_version 19 -> ${result.version}; lease column, P0 indexes and current additive migrations present`);
    return { from: 19, to: result.version, leaseColumn: true, tempClean: true };
  } finally {
    try { db.close(); } catch {}
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function main() {
  let staticSummary;
  let isolatedSummary;
  let migrationSummary;
  try {
    staticSummary = staticAudit();
    isolatedSummary = isolatedHistoryFixture();
    migrationSummary = isolatedLegacySchemaMigration();
  } catch (error) {
    record('test-harness', false, String(error?.stack || error));
  }
  const failed = results.filter(item => item.status === 'Failed');
  const output = {
    ok: failed.length === 0,
    scope: 'isolated-only',
    productionDatabaseOpened: false,
    productionWorkerStarted: false,
    results,
    staticSummary,
    isolatedSummary,
    migrationSummary,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (failed.length) process.exitCode = 2;
}

main();
