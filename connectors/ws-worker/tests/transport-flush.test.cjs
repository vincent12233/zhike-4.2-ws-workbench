'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const { ConnectorApiClient } = await import('../src/checkpoint-client.mjs');
  const { CaptureBatchFlusher } = await import('../src/flush-loop.mjs');
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ accepted: 1 }) };
  };
  const client = new ConnectorApiClient('http://api.test/', { apiToken: 'secret-token', fetchImpl });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-flush-'));
  const { ProfileStore } = await import('../src/profile-store.mjs');
  const flusher = new CaptureBatchFlusher({ apiClient: client, profileStore: new ProfileStore(root), connectorId: 'connector-1' });
  const result = await flusher.flush({
    accountId: 'acct-1',
    messages: [{ conversationKey: 'chat-1', externalMessageId: 'm-1', body: 'hello', sentAt: '2026-11-08T00:00:00Z', cursor: '1' }],
  });
  assert.equal(result.response.accepted, 1);
  assert.equal(calls.length, 1, 'v1 flush commits ingest and checkpoint atomically');
  assert.equal(calls[0].url, 'http://api.test/api/v2/ws/ingest/batch');
  assert.equal(calls[0].options.headers.authorization, 'Bearer secret-token');
  assert.equal(JSON.parse(calls[0].options.body).protocol, 'zhike.ws.ingest.batch.v1');
  assert.equal(JSON.parse(calls[0].options.body).scope, 'visible-authorized-content');
  assert.equal(JSON.parse(calls[0].options.body).messages[0].connectorId, 'connector-1');
  assert.equal((await new ProfileStore(root).readCheckpoint('acct-1')).accountId, 'acct-1');
  const listOnlyCalls = [];
  const listOnlyClient = new ConnectorApiClient('http://api.test/', { apiToken: 'secret-token', fetchImpl: async (url, options) => { listOnlyCalls.push({ url, options }); return { ok: true, status: 200, json: async () => ({ accepted: 0 }) }; } });
  await new CaptureBatchFlusher({ apiClient: listOnlyClient, profileStore: new ProfileStore(root), connectorId: 'connector-1' }).flush({ accountId: 'acct-list-only', conversations: [{ id: 'chat-1', title: '列表客户' }] });
  assert.equal(listOnlyCalls.length, 1, 'list-only capture posts ingest without an invalid empty checkpoint');
  const listPayload = JSON.parse(listOnlyCalls[0].options.body);
  assert.equal(listPayload.conversations.length, 1, 'list-only capture forwards conversation rows');
  assert.equal(listPayload.conversations[0].accountId, 'acct-list-only', 'conversation rows are fenced to the batch account');
  assert.equal(listPayload.conversations[0].displayName, '列表客户');
  await assert.rejects(
    () => listOnlyClient.ingestBatch({ accountId: 'acct-list-only', conversations: [{ accountId: 'acct-other', conversationKey: 'chat-2' }] }),
    /conversation account mismatch/i,
    'conversation rows from another account are rejected before transport',
  );
  await assert.rejects(() => new ConnectorApiClient('http://api.test', { fetchImpl }).ingestBatch({ accountId: 'acct-1', messages: [] }), /ZHIKE_API_TOKEN is required/i);
  fs.rmSync(root, { recursive: true, force: true });
  console.log('WS transport flush: bearer auth, atomic ingest/checkpoint and durable profile checkpoint pass');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
