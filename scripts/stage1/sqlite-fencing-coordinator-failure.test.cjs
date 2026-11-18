'use strict';

const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FencingError, SqliteFencedWriter } = require('../../resources/app/sidecar-write-coordinator.cjs');

const root = mkdtempSync(path.join(os.tmpdir(), 'zhike-stage1-5-fence-failure-'));
const dbPath = path.join(root, 'workspace.sqlite');
const db = new DatabaseSync(dbPath);
try {
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=100; CREATE TABLE protected_business(id TEXT PRIMARY KEY,payload TEXT NOT NULL);');
  const writer = new SqliteFencedWriter(db);
  writer.ensureSchema();
  const lease = writer.acquire('failure-scope', 'worker-a', 60_000);

  assert.throws(() => writer.runProtectedWrite(lease, { idempotencyKey: 'rollback-event', cursor: 'rollback-cursor' }, connection => {
    connection.prepare('INSERT INTO protected_business(id,payload) VALUES(?,?)').run('rollback-row', 'must rollback');
    throw new Error('forced business failure');
  }), /forced business failure/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM protected_business').get().count, 0, 'business mutation must rollback');
  assert.equal(writer.inspect('failure-scope').facts.length, 0, 'writer fact must rollback with business data');
  assert.equal(writer.inspect('failure-scope').checkpoint, null, 'checkpoint must rollback with business data');

  const blocker = new DatabaseSync(dbPath);
  blocker.exec('PRAGMA busy_timeout=100; BEGIN IMMEDIATE;');
  assert.throws(() => writer.runProtectedWrite(lease, { idempotencyKey: 'busy-event', cursor: 'busy-cursor' }, connection => {
    connection.prepare('INSERT INTO protected_business(id,payload) VALUES(?,?)').run('busy-row', 'must not run');
  }), error => /busy|locked/i.test(String(error?.message || '')));
  blocker.exec('ROLLBACK');
  blocker.close();
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM protected_business').get().count, 0, 'busy transaction must not partially write business data');
  assert.equal(writer.inspect('failure-scope').facts.length, 0, 'busy transaction must not write a fact');
  assert.equal(writer.inspect('failure-scope').checkpoint, null, 'busy transaction must not advance checkpoint');
  console.log('stage1.5 fencing coordinator failure paths: callback rollback and SQLite BUSY fail closed without business/fact/checkpoint residue passed');
} finally {
  try { db.close(); } catch {}
  rmSync(root, { recursive: true, force: true });
}
