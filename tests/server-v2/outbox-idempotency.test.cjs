'use strict';

const assert = require('node:assert/strict');
const { InMemoryPipeline, fingerprintMessage } = require('../../server/reference/pipeline.cjs');

const pipeline = new InMemoryPipeline({ maxAttempts: 3, staleAfterMs: 1_000 });
pipeline.registerAccount({ id: 'wa-1', customerId: 'customer-1' });

const newer = pipeline.ingestMessage({
  accountId: 'wa-1',
  conversationKey: 'phone:+8613800000001',
  externalMessageId: 'm-2',
  body: '需要今天报价',
  sentAt: '2026-11-08T10:02:00Z',
  direction: 'incoming',
  cursor: '2',
});
assert.equal(newer.deduplicated, false);
assert.equal(pipeline.messages.size, 1);
assert.equal(pipeline.aiJobs.size, 1);
assert.equal(pipeline.outbox.length, 1);

const duplicate = pipeline.ingestMessage({
  accountId: 'wa-1',
  conversationKey: 'phone:+8613800000001',
  externalMessageId: 'm-2',
  body: '需要今天报价',
  sentAt: '2026-11-08T10:02:00Z',
  direction: 'incoming',
  cursor: '2',
});
assert.equal(duplicate.deduplicated, true);
assert.equal(pipeline.messages.size, 1);
assert.equal(pipeline.aiJobs.size, 1);
assert.equal(pipeline.outbox.length, 1);

const older = pipeline.ingestMessage({
  accountId: 'wa-1',
  conversationKey: 'phone:+8613800000001',
  externalMessageId: 'm-1',
  body: '你好',
  sentAt: '2026-11-08T10:01:00Z',
  direction: 'incoming',
  cursor: '1',
});
assert.equal(older.deduplicated, false);
assert.equal(pipeline.messages.size, 2);
assert.equal(pipeline.conversations.get('wa-1:phone:+8613800000001').lastMessageAt, '2026-11-08T10:02:00.000Z');
assert.equal(pipeline.checkpoints.get('wa-1:phone:+8613800000001').cursor, '2', 'older batch must not move checkpoint backwards');

const firstFingerprint = fingerprintMessage(newer.message);
assert.equal(firstFingerprint, newer.message.fingerprint);

const claimed = pipeline.claimJobs('2026-11-08T10:03:00Z');
assert.equal(claimed.length, 2, 'each unique message gets one AI job');
assert.ok(claimed.every((job) => job.state === 'running'));
pipeline.recoverStaleJobs('2026-11-08T10:04:01Z');
assert.ok([...pipeline.aiJobs.values()].every((job) => job.state === 'retrying'));

const retryClaim = pipeline.claimJobs('2026-11-08T10:05:00Z');
assert.equal(retryClaim.length, 2);
for (let attempt = 0; attempt < 3; attempt += 1) {
  for (const job of retryClaim) pipeline.failJob(job.id, `provider-timeout-${attempt}`, '2026-11-08T10:06:0' + attempt + 'Z');
  if (attempt < 2) pipeline.claimJobs(`2026-11-08T10:07:0${attempt}Z`);
}
assert.ok([...pipeline.aiJobs.values()].every((job) => job.state === 'dead'), 'exhausted jobs must be dead-lettered');

const applied = pipeline.applyAiResult({
  jobId: 'manual-analysis-1',
  customerId: 'customer-1',
  sourceMessageId: newer.message.id,
  confidence: 0.91,
  fields: { name: 'Alice', phone: '+8613800000001', origin: '展会' },
  followup: { reasonKey: '报价', title: '发送报价', dueAt: '2026-11-08T12:00:00Z', priority: 'high' },
});
assert.equal(applied.customer.name, 'Alice');
assert.equal(applied.followup.created, true);
const repeat = pipeline.applyAiResult({
  jobId: 'manual-analysis-2',
  customerId: 'customer-1',
  sourceMessageId: newer.message.id,
  confidence: 0.95,
  fields: { name: '另一个名字', phone: '+8613800000999', origin: '广告' },
  followup: { reasonKey: '报价', title: '发送报价', dueAt: '2026-11-08T13:00:00Z', priority: 'high' },
});
assert.equal(repeat.customer.name, 'Alice', 'AI must not overwrite an existing field');
assert.equal(repeat.customer.phone, '+8613800000001');
assert.deepEqual(repeat.conflicts.map((item) => item.field).sort(), ['name', 'origin', 'phone']);
assert.equal(pipeline.followups.size, 1, 'same customer/reason must not create duplicate reminder');

console.log('outbox/idempotency pipeline: duplicate, ordering, retry, dead-letter, AI merge and follow-up dedupe pass');
