'use strict';

const assert = require('node:assert/strict');
const { InMemoryPipeline } = require('../../server/reference/pipeline.cjs');

(async () => {
  const { buildIngestBatch } = await import('../../connectors/ws-worker/src/collector.mjs');
  const batch = buildIngestBatch({
    accountId: 'wa-test',
    conversations: [{ conversationKey: 'phone:+8613800000001', displayName: '测试客户', unreadCount: 1 }],
    messages: [{ accountId: 'wa-test', conversationKey: 'phone:+8613800000001', externalMessageId: 'm-1', body: '请发报价', sentAt: '2026-11-08T10:00:00Z', direction: 'incoming' }],
  });
  assert.equal(batch.scope, 'visible-authorized-content');
  assert.equal(batch.messages.length, 1);
  const pipeline = new InMemoryPipeline();
  pipeline.registerAccount({ id: 'wa-test', customerId: 'c-test' });
  const result = pipeline.ingestMessage({ ...batch.messages[0], cursor: '1', observedAt: batch.capturedAt });
  assert.equal(result.deduplicated, false);
  const repeat = pipeline.ingestMessage({ ...batch.messages[0], cursor: '1', observedAt: batch.capturedAt });
  assert.equal(repeat.deduplicated, true);
  assert.equal(pipeline.outbox.length, 1);
  console.log('authorized WS smoke fixture: list/message capture, ingest, dedupe and AI enqueue pass; real login deferred');
})();
