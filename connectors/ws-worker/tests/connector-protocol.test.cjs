'use strict';

const assert = require('node:assert/strict');

(async () => {
  const protocol = await import('../src/collector.mjs');

  const conversations = protocol.collectConversationList([
    { id: 'c-2', title: 'Bob', unread: '2', lastMessage: 'hi', lastMessageAt: '2026-11-08T02:02:00Z' },
    { id: 'c-1', title: 'Alice', unread: true, lastMessage: 'hello', lastMessageAt: '2026-11-08T02:01:00Z' },
    { id: 'c-2', title: 'Bob (duplicate)', unread: 3, lastMessage: 'new', lastMessageAt: '2026-11-08T02:03:00Z' },
  ]);
  assert.deepEqual(conversations.map((item) => item.conversationKey), ['c-1', 'c-2']);
  assert.equal(conversations[1].unreadCount, 3);
  assert.equal(conversations[1].lastMessagePreview, 'new');

  const unreadMerge = protocol.collectConversationList([
    { id: 'c-3', unread: 7, lastMessageAt: '2026-11-08T02:04:00Z', preview: 'latest' },
    { id: 'c-3', unread: 1, lastMessageAt: '2026-11-08T02:03:00Z', preview: 'older' },
  ]);
  assert.equal(unreadMerge[0].unreadCount, 7, 'latest list row keeps the highest unread count');

  const base = {
    accountId: 'acct-1', conversationKey: 'c-1', externalMessageId: 'm-1',
    body: 'hello', sentAt: '2026-11-08T02:01:00Z', direction: 'incoming',
  };
  const first = protocol.normalizeVisibleMessage(base);
  const duplicate = protocol.normalizeVisibleMessage({ ...base, previewOnly: true });
  assert.equal(first.fingerprint, duplicate.fingerprint);
  assert.equal(first.previewOnly, false);
  assert.equal(protocol.messageFingerprint(base), first.fingerprint);

  const checkpoint = protocol.createCheckpoint({
    accountId: 'acct-1',
    seenFingerprints: [first.fingerprint],
    lastConversationKey: 'c-1',
    lastMessageAt: first.sentAt,
  });
  assert.equal(protocol.resumeMessages([first, { ...base, externalMessageId: 'm-2', body: 'new' }], checkpoint).length, 1);

  assert.throws(() => protocol.createCheckpoint({}), /accountId is required/i);
  assert.throws(() => protocol.buildIngestBatch({
    accountId: 'acct-2', checkpoint,
    messages: [{ ...base, externalMessageId: 'm-3', body: 'wrong account' }],
  }), /account mismatch/i);

  const ordered = protocol.buildIngestBatch({
    accountId: 'acct-1',
    messages: [
      { ...base, externalMessageId: 'm-4', body: 'newer', sentAt: '2026-11-08T03:00:00Z', cursor: '20' },
      { ...base, externalMessageId: 'm-5', body: 'older', sentAt: '2026-11-08T02:30:00Z', cursor: '19' },
    ],
  });
  assert.equal(ordered.checkpoint.cursor, '20', 'checkpoint cursor does not move backwards for out-of-order messages');
  assert.equal(ordered.messages[0].cursor, '20');
  assert.equal(typeof ordered.messages[0].observedAt, 'string');
  assert.deepEqual(ordered.checkpoints.map((item) => item.accountId), ['acct-1']);

  const listOnly = protocol.buildIngestBatch({ accountId: 'acct-list-only', conversations: [{ id: 'chat-1', title: '列表客户' }] });
  assert.deepEqual(listOnly.checkpoints, [], 'list-only capture must not emit an empty checkpoint');
  assert.match(listOnly.conversations[0].capturedAt, /^\d{4}-\d{2}-\d{2}T/, 'list-only rows carry a capture timestamp for stale-batch fencing');

  const batch = protocol.buildIngestBatch({
    accountId: 'acct-1',
    conversations,
    messages: [first, duplicate, { ...base, externalMessageId: 'm-2', body: 'new' }],
    checkpoint,
  });
  assert.equal(batch.protocol, 'zhike.ws.ingest.batch.v1');
  assert.equal(batch.accountId, 'acct-1');
  assert.equal(batch.messages.length, 1);
  assert.equal(batch.messages[0].externalMessageId, 'm-2');
  assert.equal('cookie' in batch, false);
  assert.equal('qrCode' in batch, false);

  assert.deepEqual(protocol.reconnectPlan(1, { baseDelayMs: 1000, maxDelayMs: 5000 }), { attempt: 1, state: '正在重连', delayMs: 1000 });
  assert.deepEqual(protocol.reconnectPlan(4, { baseDelayMs: 1000, maxDelayMs: 5000 }), { attempt: 4, state: '正在重连', delayMs: 5000 });
  assert.equal(protocol.connectorFailure('session-expired').state, '会话过期');
  assert.match(protocol.connectorFailure('selector changed').message, /selector changed/);

  console.log('WS connector protocol: list capture, message idempotency, checkpoints, batches and reconnect states pass');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
