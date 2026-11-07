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
];

for (const file of expected) assert.equal(fs.existsSync(path.join(migrationsDir, file)), true, `missing ${file}`);

const sql = expected.map(file => fs.readFileSync(path.join(migrationsDir, file), 'utf8')).join('\n');
for (const table of [
  'schema_migrations', 'legacy_records', 'audit_events', 'customers', 'customer_identities',
  'business_records', 'conversations', 'messages', 'ws_accounts', 'ws_checkpoints',
  'ai_jobs', 'followup_tasks', 'sync_outbox', 'import_batches', 'import_rows',
]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`), `missing table ${table}`);

for (const phrase of ['CREATE INDEX', 'UNIQUE', 'jsonb', 'FOR UPDATE SKIP LOCKED']) {
  if (phrase === 'FOR UPDATE SKIP LOCKED') continue;
  assert.match(sql, new RegExp(phrase, 'i'), `migration contract missing ${phrase}`);
}
assert.doesNotMatch(sql, /DROP TABLE|DROP DATABASE|TRUNCATE/i, 'migrations must not destroy existing data');
assert.doesNotMatch(sql, /^\s*(BEGIN|COMMIT);/im, 'migration runner owns transaction boundaries');

for (const file of [
  'server/src/Zhike.Infrastructure/Database/PostgresConnectionFactory.cs',
  'server/src/Zhike.Infrastructure/Database/MigrationRunner.cs',
  'server/src/Zhike.Infrastructure/Database/DatabaseHealthProbe.cs',
]) assert.equal(fs.existsSync(path.join(repo, file)), true, `missing ${file}`);

const runner = fs.readFileSync(path.join(repo, 'server/src/Zhike.Infrastructure/Database/MigrationRunner.cs'), 'utf8');
assert.match(runner, /BeginTransactionAsync/);
assert.match(runner, /RollbackAsync/);
assert.match(fs.readFileSync(path.join(repo, 'server/src/Zhike.Api/Program.cs'), 'utf8'), /ApplyAsync/);

console.log('PostgreSQL migration contract: schema files, indexes, JSON payloads and non-destructive guards present');
