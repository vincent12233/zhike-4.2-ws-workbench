'use strict';

/*
 * Stage 1.5 queue compatibility review.
 * This test opens only a temporary SQLite database. It does not start a Worker,
 * call a provider, login to WS, or enable a production queue.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations } = require('../../resources/app/migration-runner.cjs');

const root = path.resolve(__dirname, '..', '..');
const migrationDir = path.join(root, 'resources', 'app', 'migrations');
const manifestPath = path.join(migrationDir, 'manifest.json');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-stage1-5-queue-'));
const dbPath = path.join(tempRoot, 'workspace.sqlite');
const lockPath = path.join(tempRoot, '.migration.lock');
const backupDir = path.join(tempRoot, '.backups');

const serverSource = fs.readFileSync(path.join(root, 'resources', 'app', 'server.mjs'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const sqlByVersion = new Map(manifest.migrations.map(item => [Number(item.version), fs.readFileSync(path.join(migrationDir, item.file), 'utf8')]));
const supportedSchemaVersion = Number(manifest.supportedSchemaVersion);

function assertNoDualWriteFlags() {
  assert.doesNotMatch(serverSource, /ws_ai_outbox|ai_outbox/i, 'production server must not activate a second AI outbox');
  assert.doesNotMatch(serverSource, /worker-primary|worker\.v1|group-monitor\.worker\.v1/i, 'production server must not silently enable a Worker flag');
  assert.doesNotMatch(serverSource, /INSERT INTO\s+ws_collection_runs[\s\S]{0,800}INSERT INTO\s+ws_ai_outbox/i, 'server must not dual-write old and new queues');
}

function run() {
  assert.ok(Number.isInteger(supportedSchemaVersion) && supportedSchemaVersion >= 22, 'manifest authority must retain the Stage 1.5 baseline (schema 22 or newer)');
  assert.equal(sqlByVersion.has(20), true);
  assert.equal(sqlByVersion.has(21), true);
  assert.equal(sqlByVersion.has(22), true);
  assert.equal(sqlByVersion.has(supportedSchemaVersion), true, `manifest latest schema ${supportedSchemaVersion} must have a migration entry`);
  assertNoDualWriteFlags();

  const db = new DatabaseSync(dbPath);
  try {
    const result = runMigrations({ db, dbPath, migrationDir, manifestPath, backupDir, lockPath });
    assert.equal(result.version, supportedSchemaVersion);
    const now = new Date().toISOString();
    db.prepare('INSERT INTO ws_collection_runs(id,account_id,status,total,discovered,completed,analyzing,analyzed,failed,skipped,retryable,last_error,checkpoint,cursor,resume_count,last_success_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('compat-run', 'default', 'completed', 1, 1, 1, 0, 0, 0, 0, 0, '', 'cursor-legacy', 'source-legacy', 1, now, now, now);
    db.prepare('INSERT INTO ws_conversations(id,account_id,external_id,title,customer_id,last_message_text,intent_level,data_json,created_at,updated_at,last_message_at,unread_count,language) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('conversation-legacy', 'default', 'external-legacy', 'Legacy conversation', '', 'legacy', '', '{}', now, now, now, 0, 'en');
    db.prepare('INSERT INTO ws_collection_items(id,account_id,run_id,conversation_id,status,attempts,analysis_status,followup_status,next_followup_at,last_error,checkpoint,coverage_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('compat-item', 'default', 'compat-run', 'conversation-legacy', 'completed', 2, 'done', 'scheduled', now, '', 'cursor-legacy', 'full-history', now, now);
    db.prepare('INSERT INTO ws_ai_analyses(id,account_id,conversation_id,result_json,confidence,provider_name,model,error_message,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run('compat-analysis', 'default', 'conversation-legacy', '{"summary":"retained"}', 0.91, 'fixture', 'fixture-model', '', now, now);
    db.prepare('INSERT INTO ai_jobs(id,account_id,conversation_id,idempotency_key,payload_json,status,attempts,max_attempts,next_attempt_at,locked_at,lease_token,last_error,analysis_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('compat-job', 'default', 'conversation-legacy', 'compat-key', '{"legacy":true}', 'completed', 1, 5, now, '', '', '', 'compat-analysis', now, now);
    const before = {
      run: db.prepare('SELECT status,checkpoint,cursor FROM ws_collection_runs WHERE id=?').get('compat-run'),
      item: db.prepare('SELECT status,attempts,checkpoint,coverage_status FROM ws_collection_items WHERE id=?').get('compat-item'),
      analysis: db.prepare('SELECT result_json,confidence FROM ws_ai_analyses WHERE id=?').get('compat-analysis'),
      job: db.prepare('SELECT status,attempts,analysis_id,idempotency_key FROM ai_jobs WHERE id=?').get('compat-job'),
    };
    db.close();

    const restarted = new DatabaseSync(dbPath);
    try {
      const rerun = runMigrations({ db: restarted, dbPath, migrationDir, manifestPath, backupDir, lockPath });
      assert.equal(rerun.version, supportedSchemaVersion);
      const after = {
        run: restarted.prepare('SELECT status,checkpoint,cursor FROM ws_collection_runs WHERE id=?').get('compat-run'),
        item: restarted.prepare('SELECT status,attempts,checkpoint,coverage_status FROM ws_collection_items WHERE id=?').get('compat-item'),
        analysis: restarted.prepare('SELECT result_json,confidence FROM ws_ai_analyses WHERE id=?').get('compat-analysis'),
        job: restarted.prepare('SELECT status,attempts,analysis_id,idempotency_key FROM ai_jobs WHERE id=?').get('compat-job'),
      };
      assert.deepEqual(after, before, 'legacy queue and AI history changed during compatibility rerun');
      assert.equal(restarted.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ws_ai_outbox'").get(), undefined);
      assert.equal(restarted.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version=22').get().count, 1);
      assert.equal(restarted.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version=?').get(supportedSchemaVersion).count, 1);
      console.log(JSON.stringify({
        ok: true,
        scope: 'isolated-only',
        manifestMax: supportedSchemaVersion,
        legacyRunRetained: true,
        legacyItemRetained: true,
        aiAnalysisRetained: true,
        aiJobRetained: true,
        noSecondAiOutbox: true,
        noDualWrite: true,
        doubleReadWrite: false,
        productionWorkerStarted: false,
        productionDatabaseOpened: false,
        tempRoot,
      }));
    } finally {
      restarted.close();
    }
  } finally {
    try { if (fs.existsSync(dbPath)) fs.rmSync(dbPath, { force: true }); } catch {}
    try { if (fs.existsSync(tempRoot)) fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
  }
}

run();
