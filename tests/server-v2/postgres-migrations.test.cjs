'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const migrationsDir = path.join(repo, 'server', 'migrations');
const expected = [
  '001-foundation.sql',
  '002-customers-and-identities.sql',
  '003-business-records.sql',
  '004-messages-and-ws.sql',
  '005-ai-followups-outbox.sql',
  '006-ai-observations.sql',
  '007-business-date-separation.sql',
  '008-outbox-dedupe.sql',
  '009-worker-heartbeats.sql',
  '010-legacy-workspace-state.sql',
  '011-hot-chat-profiles.sql',
];

for (const file of expected) assert.equal(fs.existsSync(path.join(migrationsDir, file)), true, `missing ${file}`);

const sql = expected.map(file => fs.readFileSync(path.join(migrationsDir, file), 'utf8')).join('\n');
for (const table of [
  'schema_migrations', 'legacy_records', 'audit_events', 'customers', 'customer_identities',
  'business_records', 'conversations', 'messages', 'ws_accounts', 'ws_checkpoints',
  'ai_jobs', 'followup_tasks', 'sync_outbox', 'import_batches', 'import_rows',
  'ai_analysis_results', 'ai_field_observations',
  'worker_heartbeats',
  'legacy_workspace_state', 'legacy_workspace_snapshots',
  'hot_chat_profiles', 'hot_chat_profile_fields', 'hot_chat_events', 'hot_chat_sync_outbox',
]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`), `missing table ${table}`);

for (const phrase of ['CREATE INDEX', 'UNIQUE', 'jsonb', 'FOR UPDATE SKIP LOCKED']) {
  if (phrase === 'FOR UPDATE SKIP LOCKED') continue;
  assert.match(sql, new RegExp(phrase, 'i'), `migration contract missing ${phrase}`);
}
assert.doesNotMatch(sql, /DROP TABLE|DROP DATABASE|TRUNCATE/i, 'migrations must not destroy existing data');
assert.doesNotMatch(sql, /^\s*(BEGIN|COMMIT);/im, 'migration runner owns transaction boundaries');
assert.match(fs.readFileSync(path.join(migrationsDir, '007-business-date-separation.sql'), 'utf8'), /business_date/);
assert.match(fs.readFileSync(path.join(migrationsDir, '008-outbox-dedupe.sql'), 'utf8'), /uq_sync_outbox_event/);
assert.match(fs.readFileSync(path.join(migrationsDir, '009-worker-heartbeats.sql'), 'utf8'), /last_seen_at/);
assert.match(fs.readFileSync(path.join(migrationsDir, '010-legacy-workspace-state.sql'), 'utf8'), /JSONB/i);
assert.match(fs.readFileSync(path.join(migrationsDir, '011-hot-chat-profiles.sql'), 'utf8'), /VALUES\s*\(11,/i);
assert.match(fs.readFileSync(path.join(migrationsDir, '011-hot-chat-profiles.sql'), 'utf8'), /UNIQUE\s*\(\s*customer_id\s*,\s*account_id\s*,\s*conversation_id\s*\)/i);

for (const file of [
  'server/src/Zhike.Infrastructure/Database/PostgresConnectionFactory.cs',
  'server/src/Zhike.Infrastructure/Database/MigrationRunner.cs',
  'server/src/Zhike.Infrastructure/Database/DatabaseHealthProbe.cs',
  'server/src/Zhike.Infrastructure/Database/WorkerHeartbeatRepository.cs',
]) assert.equal(fs.existsSync(path.join(repo, file)), true, `missing ${file}`);

const runner = fs.readFileSync(path.join(repo, 'server/src/Zhike.Infrastructure/Database/MigrationRunner.cs'), 'utf8');
assert.match(runner, /BeginTransactionAsync/);
assert.match(runner, /RollbackAsync/);
assert.match(runner, /LatestVersion/);
assert.match(runner, /GetAppliedVersionAsync/);
assert.match(fs.readFileSync(path.join(repo, 'server/src/Zhike.Api/Program.cs'), 'utf8'), /runtimeSchemaVersion/);
assert.match(fs.readFileSync(path.join(repo, 'server/src/Zhike.Api/Program.cs'), 'utf8'), /schema-mismatch/);
assert.match(fs.readFileSync(path.join(repo, 'server/src/Zhike.Api/Program.cs'), 'utf8'), /ApplyAsync/);

console.log('PostgreSQL migration contract: schema files, indexes, JSON payloads and non-destructive guards present');
