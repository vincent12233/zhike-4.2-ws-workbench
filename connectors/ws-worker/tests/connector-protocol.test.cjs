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
