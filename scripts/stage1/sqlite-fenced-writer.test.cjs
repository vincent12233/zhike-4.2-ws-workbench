'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { FencingError, SqliteFencedWriter } = require('./sqlite-fenced-writer.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-stage1-fenced-writer-'));
const dbPath = path.join(root, 'writer.sqlite');
const db = new DatabaseSync(dbPath);
try {
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1500;');
  const a = new SqliteFencedWriter(db); a.ensureSchema();
  const leaseA = a.acquire('account:fixture/collector:fixture', 'worker-a', 60_000);
  const first = a.writeFactAndCheckpoint(leaseA, { idempotencyKey: 'event-1', cursor: 'cursor-1', payload: { text: 'a' } });
  assert.equal(first.accepted, true);
  assert.equal(a.writeFactAndCheckpoint(leaseA, { idempotencyKey: 'event-1', cursor: 'cursor-1', payload: { text: 'replay' } }).deduplicated, true);

  const b = new SqliteFencedWriter(new DatabaseSync(dbPath));
  let held = false;
  try { b.acquire(leaseA.scopeKey, 'worker-b', 60_000); } catch (error) { held = error.code === 'LEASE_HELD'; }
  assert.equal(held, true, 'a live lease must block a second owner');
  a.release(leaseA);
  const leaseB = b.acquire(leaseA.scopeKey, 'worker-b', 60_000);
  assert.equal(leaseB.fencingToken, leaseA.fencingToken + 1);
  let stale = false;
  try { a.writeFactAndCheckpoint(leaseA, { idempotencyKey: 'event-stale', cursor: 'cursor-stale', payload: {} }); } catch (error) { stale = error instanceof FencingError && error.code === 'STALE_FENCE'; }
  assert.equal(stale, true, 'old fencing generation must be rejected after takeover');
  assert.equal(b.writeFactAndCheckpoint(leaseB, { idempotencyKey: 'event-2', cursor: 'cursor-2', payload: { text: 'b' } }).accepted, true);
  const inspected = b.inspect(leaseB.scopeKey);
  assert.equal(inspected.facts.length, 2);
  assert.equal(inspected.checkpoint.cursor, 'cursor-2');
  assert.equal(Number(inspected.checkpoint.fencing_token), leaseB.fencingToken);
  b.db.close();
  console.log(JSON.stringify({ ok: true, scope: 'isolated-only', staleWriterRejected: true, idempotentReplay: true, checkpointOrder: true, productionDatabaseOpened: false, productionWorkerStarted: false }));
} finally {
  try { db.close(); } catch {}
  fs.rmSync(root, { recursive: true, force: true });
}

