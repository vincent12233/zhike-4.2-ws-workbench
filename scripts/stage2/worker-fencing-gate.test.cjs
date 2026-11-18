'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { SqliteFencedWriter } = require('../../resources/app/sidecar-write-coordinator.cjs');
const { createWorkerFencingGate } = require('../../resources/app/worker-fencing-gate.cjs');

function makeTempDb() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-stage2-fencing-gate-'));
  const dbPath = path.join(root, 'isolated.sqlite');
  const db = new DatabaseSync(dbPath);
  return { root, db, dbPath };
}

function testDisabledGateFailsClosed() {
  let calls = 0;
  const gate = createWorkerFencingGate({
    enabled: false,
    writer: { runProtectedWrite() { calls += 1; } },
  });
  assert.equal(gate.enabled, false);
  assert.throws(
    () => gate.runProtectedWrite({ scopeKey: 'test' }, { idempotencyKey: 'x', cursor: 'c' }, () => {}),
    error => error?.code === 'WORKER_FENCING_DISABLED',
  );
  assert.equal(calls, 0, 'disabled gate must not call the writer');
}

function testEnabledGateDelegatesTransactionalWriter() {
  const { root, db } = makeTempDb();
  try {
    const writer = new SqliteFencedWriter(db, { clock: () => 1000 });
    writer.ensureSchema();
    db.exec('CREATE TABLE business_events (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
    const lease = writer.acquire('ws:isolated', 'worker-a', 30_000);
    const gate = createWorkerFencingGate({ enabled: true, writer });
    const result = gate.runProtectedWrite(
      lease,
      { idempotencyKey: 'event-1', cursor: 'cursor-1', payload: { source: 'stage2' } },
      (connection) => {
        connection.prepare('INSERT INTO business_events(id,body) VALUES(?,?)').run('event-1', 'committed');
        return { businessWritten: true };
      },
    );
    assert.equal(gate.enabled, true);
    assert.equal(result.businessWritten, true);
    assert.equal(result.fact.accepted, true);
    assert.equal(result.checkpoint.cursor, 'cursor-1');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM business_events').get().count, 1);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

testDisabledGateFailsClosed();
testEnabledGateDelegatesTransactionalWriter();
console.log('stage2 worker fencing gate: disabled fail-closed and enabled transactional delegation passed');
