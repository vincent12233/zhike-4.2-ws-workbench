#!/usr/bin/env node
/*
 * Stage 1 P0-05 isolation-only SQLite lease/fencing verification.
 *
 * This test intentionally does not import production server code and never
 * opens the production workspace database.  It models the durable contract
 * that must be implemented by the future sidecar writer: a lease generation
 * is persisted, every business write checks the generation in the same
 * transaction, stale writers are rejected, and the checkpoint advances only
 * with the accepted business fact.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-stage1-fencing-'));
const dbPath = path.join(tempRoot, 'isolated.sqlite');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const now = () => Date.now();
const token = (n) => `fence-${n}`;
const db = new DatabaseSync(dbPath);
const results = [];

function pass(name, evidence) { results.push({ name, status: 'Passed', evidence }); }
function cleanup() {
  try { db.close(); } catch {}
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

try {
  assert(dbPath.startsWith(os.tmpdir()), 'isolation database must be under the OS temp directory');
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA busy_timeout=1500;
    CREATE TABLE writer_leases (
      scope_key TEXT PRIMARY KEY,
      lease_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      fencing_token INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
    );
    CREATE TABLE business_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope_key TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      payload TEXT NOT NULL,
      fencing_token INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE checkpoints (
      scope_key TEXT PRIMARY KEY,
      cursor TEXT NOT NULL,
      fencing_token INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  const scope = 'account:fixture/collector:fixture';
  const lease = db.prepare('INSERT INTO writer_leases(scope_key,lease_id,owner_id,fencing_token,expires_at,active) VALUES(?,?,?,?,?,1)');
  lease.run(scope, 'lease-a', 'worker-a', 1, now() + 60_000);
  pass('lease-acquire-a', 'durable lease row created with fencing token 1');

  const submit = db.prepare(`
    INSERT INTO business_facts(scope_key,idempotency_key,payload,fencing_token,created_at)
    SELECT ?,?,?,?,?
    WHERE EXISTS (
      SELECT 1 FROM writer_leases
      WHERE scope_key=? AND owner_id=? AND fencing_token=? AND active=1 AND expires_at>?
    )
  `);
  const checkpoint = db.prepare(`
    INSERT INTO checkpoints(scope_key,cursor,fencing_token,updated_at)
    VALUES(?,?,?,?)
    ON CONFLICT(scope_key) DO UPDATE SET cursor=excluded.cursor,
      fencing_token=excluded.fencing_token, updated_at=excluded.updated_at
    WHERE excluded.fencing_token >= checkpoints.fencing_token
  `);

  // A writes a fact and advances its checkpoint atomically.
  db.exec('BEGIN IMMEDIATE');
  const acceptedA = submit.run(scope, 'event-1', 'fact-a', 1, now(), scope, 'worker-a', 1, now());
  assert(acceptedA.changes === 1, 'worker A initial fact was not accepted');
  checkpoint.run(scope, 'cursor-1', 1, now());
  db.exec('COMMIT');
  pass('worker-a-commit', 'fact and checkpoint committed in one transaction');

  // A stops heartbeating; expiry is durable, not process-memory state.
  db.prepare('UPDATE writer_leases SET active=0, expires_at=? WHERE scope_key=?').run(now() - 1, scope);
  pass('lease-expiry', 'worker A lease expired and was persisted');

  // B takes a strictly newer fencing generation.
  db.prepare('UPDATE writer_leases SET lease_id=?,owner_id=?,fencing_token=?,expires_at=?,active=1 WHERE scope_key=?')
    .run('lease-b', 'worker-b', 2, now() + 60_000, scope);
  pass('lease-acquire-b', 'worker B took fencing token 2');

  // A resumes with the old generation.  Its transaction must not write a fact
  // or move the checkpoint, even though the process is still alive.
  db.exec('BEGIN IMMEDIATE');
  const staleA = submit.run(scope, 'event-stale-a', 'stale-a', 1, now(), scope, 'worker-a', 1, now());
  const checkpointBefore = db.prepare('SELECT cursor,fencing_token FROM checkpoints WHERE scope_key=?').get(scope);
  db.exec('ROLLBACK');
  assert(staleA.changes === 0, 'stale worker A unexpectedly wrote a business fact');
  assert(checkpointBefore.cursor === 'cursor-1' && Number(checkpointBefore.fencing_token) === 1, 'stale writer changed checkpoint');
  pass('stale-writer-rejected', 'old worker A changes=0 and checkpoint remained cursor-1');

  // B commits the next event and checkpoint.
  db.exec('BEGIN IMMEDIATE');
  const acceptedB = submit.run(scope, 'event-2', 'fact-b', 2, now(), scope, 'worker-b', 2, now());
  assert(acceptedB.changes === 1, 'worker B fact was not accepted');
  checkpoint.run(scope, 'cursor-2', 2, now());
  db.exec('COMMIT');
  pass('worker-b-commit', 'new fencing generation committed fact and checkpoint');

  // Replays are idempotent and never create another business fact.
  db.exec('BEGIN IMMEDIATE');
  const replay = db.prepare(`
    INSERT INTO business_facts(scope_key,idempotency_key,payload,fencing_token,created_at)
    SELECT ?,?,?,?,? WHERE EXISTS (
      SELECT 1 FROM writer_leases WHERE scope_key=? AND owner_id=? AND fencing_token=? AND active=1 AND expires_at>?
    ) ON CONFLICT(idempotency_key) DO NOTHING
  `).run(scope, 'event-2', 'fact-b-replay', 2, now(), scope, 'worker-b', 2, now());
  db.exec('COMMIT');
  assert(replay.changes === 0, 'duplicate event was inserted');
  assert(Number(db.prepare('SELECT COUNT(*) AS n FROM business_facts').get().n) === 2, 'duplicate fact count is not stable');
  pass('idempotent-retry', 'duplicate idempotency key produced no additional fact');

  // A second connection observes the same durable state and is blocked by the
  // same fencing predicate; no process-local mutex is involved.
  const second = new DatabaseSync(dbPath);
  try {
    second.exec('PRAGMA busy_timeout=1500');
    const observed = second.prepare('SELECT writer_leases.fencing_token AS lease_token,checkpoints.cursor FROM writer_leases JOIN checkpoints USING(scope_key) WHERE writer_leases.scope_key=?').get(scope);
    assert(Number(observed.lease_token) === 2 && observed.cursor === 'cursor-2', 'second connection did not observe durable fence/checkpoint');
    const staleFromSecond = second.prepare(`
      INSERT INTO business_facts(scope_key,idempotency_key,payload,fencing_token,created_at)
      SELECT ?,?,?,?,? WHERE EXISTS (
        SELECT 1 FROM writer_leases WHERE scope_key=? AND owner_id=? AND fencing_token=? AND active=1 AND expires_at>?
      )
    `).run(scope, 'event-stale-second', 'stale-second', 1, now(), scope, 'worker-a', 1, now());
    assert(staleFromSecond.changes === 0, 'second connection accepted stale generation');
    pass('two-connection-fence', 'independent SQLite connection rejected stale token');
  } finally { second.close(); }

  const facts = Number(db.prepare('SELECT COUNT(*) AS n FROM business_facts').get().n);
  const finalCheckpoint = db.prepare('SELECT cursor,fencing_token FROM checkpoints WHERE scope_key=?').get(scope);
  assert(facts === 2 && finalCheckpoint.cursor === 'cursor-2' && Number(finalCheckpoint.fencing_token) === 2, 'final fencing state is inconsistent');
  pass('checkpoint-order', 'two facts, cursor-2, and fencing token 2 are the final durable state');
} catch (error) {
  results.push({ name: 'isolation-run', status: 'Failed', error: String(error?.stack || error) });
  process.exitCode = 2;
} finally {
  cleanup();
}

const failed = results.filter((item) => item.status === 'Failed');
const output = {
  ok: failed.length === 0,
  scope: 'isolated-only',
  productionDatabaseOpened: false,
  productionWorkerStarted: false,
  counts: {
    Passed: results.filter((item) => item.status === 'Passed').length,
    Failed: failed.length,
  },
  results,
  tempClean: !fs.existsSync(tempRoot),
};
console.log(JSON.stringify(output, null, 2));
