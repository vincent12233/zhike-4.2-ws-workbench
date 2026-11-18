'use strict';

// Stage 1.5: use the real server.mjs sidecar and its ws_messages table in an
// isolated data root. No production path, real WS account, or formal Worker is
// started by this test.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { mkdtempSync, rmSync } = require('node:fs');
const { createServer: createTcpServer } = require('node:net');
const os = require('node:os');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const app = path.join(repo, 'resources', 'app');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-stage1-5-fence-sidecar-'));
const token = 'stage1-5-sidecar-token';
let port = 0;
let headers;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let child;

async function allocatePort() {
  const probe = createTcpServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  const assigned = address && typeof address === 'object' ? Number(address.port) : 0;
  await new Promise(resolve => probe.close(resolve));
  if (!assigned) throw new Error('failed to allocate an isolated sidecar port');
  return assigned;
}

function start() {
  child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
    cwd: app,
    windowsHide: true,
    env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token, ZHIKE_FENCING_MODE: 'isolated' },
    stdio: 'ignore',
  });
}

async function request(pathname, init = {}) {
  for (let attempt = 0; attempt < 1200; attempt += 1) {
    try { return await fetch(`http://127.0.0.1:${port}${pathname}`, { ...init, headers: { ...headers, ...(init.headers || {}) } }); }
    catch { await wait(25); }
  }
  throw new Error('isolated sidecar did not become available');
}

async function json(response) {
  const value = await response.json();
  return { response, value };
}

async function stop() {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  for (let attempt = 0; attempt < 100 && child.exitCode === null; attempt += 1) await wait(25);
  if (child.exitCode === null) child.kill('SIGKILL');
}

(async () => {
  try {
    port = await allocatePort();
    headers = { 'content-type': 'application/json', 'x-zhike-api-token': token, origin: `http://127.0.0.1:${port}` };
    start();
    const created = await json(await request('/api/ws/conversations', {
      method: 'POST',
      body: JSON.stringify({ externalId: 'fencing-sidecar-contact', title: '隔离 fencing 客户', conversationType: 'direct', unreadCount: 0, data: { conversationType: 'direct', historyLoaded: true } }),
    }));
    assert.ok([200, 201].includes(created.response.status));
    const conversationId = created.value.id;

    const acquiredA = await json(await request('/api/ws/fencing', { method: 'POST', body: JSON.stringify({ action: 'acquire', scopeKey: 'ws:default:collector', ownerId: 'worker-a', leaseMs: 1000 }) }));
    assert.equal(acquiredA.response.status, 200);
    const leaseA = acquiredA.value.lease;

    // A is delayed before BEGIN IMMEDIATE. B can take over after A expires;
    // A must then fail before inserting ws_messages or its checkpoint.
    const aPromise = request('/api/ws/fencing/write', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'default', conversationId, lease: leaseA, idempotencyKey: 'fence:a', cursor: 'cursor-a', testDelayMs: 1500, message: { externalId: 'fence-message-a', originalText: 'A must be rejected' } }),
    });
    await wait(1150);

    const acquiredB = await json(await request('/api/ws/fencing', { method: 'POST', body: JSON.stringify({ action: 'acquire', scopeKey: 'ws:default:collector', ownerId: 'worker-b', leaseMs: 3000 }) }));
    assert.equal(acquiredB.response.status, 200, 'B must take over after A lease expiry');
    const leaseB = acquiredB.value.lease;
    const bWrite = await json(await request('/api/ws/fencing/write', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'default', conversationId, lease: leaseB, idempotencyKey: 'fence:b', cursor: 'cursor-b', message: { externalId: 'fence-message-b', originalText: 'B committed' } }),
    }));
    assert.equal(bWrite.response.status, 200);
    assert.equal(bWrite.value.ok, true);
    assert.equal(bWrite.value.deduplicated, false);

    const aWrite = await json(await aPromise);
    assert.equal(aWrite.response.status, 409, 'expired A business write must be rejected by the sidecar transaction');
    assert.equal(aWrite.value.code, 'STALE_FENCE');

    const duplicateB = await json(await request('/api/ws/fencing/write', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'default', conversationId, lease: leaseB, idempotencyKey: 'fence:b', cursor: 'cursor-b', message: { externalId: 'fence-message-b', originalText: 'B committed' } }),
    }));
    assert.equal(duplicateB.response.status, 200);
    assert.equal(duplicateB.value.deduplicated, true, 'same idempotency key must not insert a duplicate business row');

    const heldByB = await json(await request('/api/ws/fencing', { method: 'POST', body: JSON.stringify({ action: 'acquire', scopeKey: 'ws:default:collector', ownerId: 'worker-c', leaseMs: 1000 }) }));
    assert.equal(heldByB.response.status, 409, 'active B lease must fence C');
    const released = await json(await request('/api/ws/fencing', { method: 'POST', body: JSON.stringify({ action: 'release', lease: leaseB }) }));
    assert.equal(released.response.status, 200);
    const acquiredC = await json(await request('/api/ws/fencing', { method: 'POST', body: JSON.stringify({ action: 'acquire', scopeKey: 'ws:default:collector', ownerId: 'worker-c', leaseMs: 1000 }) }));
    assert.equal(acquiredC.response.status, 200, 'released lease must be acquirable by the next worker');

    await stop();
    await wait(1150);
    start();
    const acquiredD = await json(await request('/api/ws/fencing', { method: 'POST', body: JSON.stringify({ action: 'acquire', scopeKey: 'ws:default:collector', ownerId: 'worker-d', leaseMs: 1000 }) }));
    assert.equal(acquiredD.response.status, 200, 'sidecar restart must allow a new owner after the old lease expires');

    await stop();
    const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'));
    const messages = db.prepare("SELECT external_id,original_text FROM ws_messages WHERE account_id='default' AND conversation_id=? ORDER BY external_id").all(conversationId);
    const facts = db.prepare("SELECT scope_key,idempotency_key,fencing_token FROM zhike_writer_facts WHERE scope_key='ws:default:collector' ORDER BY idempotency_key").all();
    const checkpoint = db.prepare("SELECT cursor,fencing_token FROM zhike_writer_checkpoints WHERE scope_key='ws:default:collector'").get();
    const leases = db.prepare("SELECT owner_id,fencing_token,active FROM zhike_writer_leases WHERE scope_key='ws:default:collector'").get();
    db.close();
    assert.deepEqual(messages.map(row => ({ external_id: row.external_id, original_text: row.original_text })), [{ external_id: 'fence-message-b', original_text: 'B committed' }], 'only B business data may survive');
    assert.deepEqual(facts.map(row => ({ idempotency_key: row.idempotency_key, fencing_token: Number(row.fencing_token) })), [{ idempotency_key: 'fence:b', fencing_token: 2 }]);
    assert.equal(checkpoint.cursor, 'cursor-b');
    assert.equal(Number(checkpoint.fencing_token), 2);
    assert.equal(leases.owner_id, 'worker-d');
    assert.equal(Number(leases.fencing_token), 4);
    assert.equal(Number(leases.active), 1);
    console.log('stage1.5 sidecar fencing integration: real ws_messages write, lease takeover, stale rollback, checkpoint atomicity and idempotent replay passed');
  } finally {
    await stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
