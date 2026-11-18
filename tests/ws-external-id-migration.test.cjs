const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const repo = path.join(__dirname, '..');
const migrationPath = path.join(repo, 'resources', 'app', 'migrations', '014-ws-message-external-unique.sql');
const migration = readFileSync(migrationPath, 'utf8');
const db = new DatabaseSync(':memory:');
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE ws_messages (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL DEFAULT 'default',
    conversation_id TEXT NOT NULL,
    external_id TEXT NOT NULL DEFAULT '',
    direction TEXT NOT NULL,
    original_text TEXT NOT NULL DEFAULT '',
    data_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_ws_messages_external ON ws_messages(account_id, conversation_id, external_id) WHERE external_id <> '';
`);
const insert = db.prepare('INSERT INTO ws_messages(id,account_id,conversation_id,external_id,direction,original_text,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
insert.run('m-default-1', 'default', 'c-1', 'same-external', 'receive', 'first', '{"source":"ws-webview2"}', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');
insert.run('m-default-2', 'default', 'c-1', 'same-external', 'send', 'duplicate', '{"source":"ws-webview2"}', '2026-11-01T00:00:01.000Z', '2026-11-01T00:00:01.000Z');
insert.run('m-alpha-1', 'alpha', 'c-1', 'same-external', 'receive', 'different account is valid', '{}', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');
insert.run('m-empty', 'default', 'c-1', '', 'receive', 'empty ids remain allowed', '{}', '2026-11-01T00:00:02.000Z', '2026-11-01T00:00:02.000Z');
insert.run('m-array-1', 'default', 'c-1', 'array-external', 'receive', 'array payload canonical', '[]', '2026-11-01T00:00:03.000Z', '2026-11-01T00:00:03.000Z');
insert.run('m-array-2', 'default', 'c-1', 'array-external', 'send', 'array payload duplicate', '[]', '2026-11-01T00:00:04.000Z', '2026-11-01T00:00:04.000Z');

db.exec(migration);

const duplicateKeyCount = db.prepare(`
  SELECT COUNT(*) AS count FROM (
    SELECT account_id, conversation_id, external_id, COUNT(*) AS n
    FROM ws_messages
    WHERE external_id <> ''
    GROUP BY account_id, conversation_id, external_id
    HAVING n > 1
  )
`).get().count;
assert.equal(duplicateKeyCount, 0, 'non-empty external IDs must be unique per account and conversation');
assert.equal(db.prepare('SELECT external_id FROM ws_messages WHERE id=?').get('m-default-1').external_id, 'same-external', 'oldest row keeps canonical external ID');
const duplicate = db.prepare('SELECT external_id,data_json FROM ws_messages WHERE id=?').get('m-default-2');
assert.equal(duplicate.external_id, '', 'duplicate row must be retained without an ambiguous external ID');
assert.equal(JSON.parse(duplicate.data_json).duplicateExternalId, 'same-external', 'duplicate original ID must remain auditable');
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ws_messages WHERE account_id=? AND conversation_id=? AND external_id=?').get('alpha', 'c-1', 'same-external').count, 1, 'same external ID is valid across accounts');
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ws_messages WHERE external_id=?').get('').count, 3, 'empty external IDs remain exempt from the unique index');
const arrayDuplicate = db.prepare('SELECT data_json FROM ws_messages WHERE id=?').get('m-array-2');
const arrayData = JSON.parse(arrayDuplicate.data_json);
assert.equal(arrayData.duplicateExternalId, 'array-external', 'non-object payloads retain the duplicate external ID');
assert.equal(arrayData.legacyDataJson, '[]', 'non-object payloads retain their original data JSON');

// A failed startup can be retried after the migration transaction rolls back;
// rerunning the SQL against an already repaired database must stay harmless.
db.exec(migration);
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ws_messages WHERE external_id=?').get('same-external').count, 2, 'migration is idempotent across a retry');

assert.throws(
  () => insert.run('m-default-3', 'default', 'c-1', 'same-external', 'receive', 'must reject', '{}', '2026-11-01T00:00:03.000Z', '2026-11-01T00:00:03.000Z'),
  /UNIQUE constraint failed/,
  'new duplicate external IDs must fail at the database boundary',
);

console.log('ws external-id migration: duplicate repair and unique account/conversation index pass');
