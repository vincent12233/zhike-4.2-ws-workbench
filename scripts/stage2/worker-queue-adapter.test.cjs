'use strict';

const assert = require('node:assert/strict');
const {
  QueueAdapterError,
  mapCollectionItemToWorkerJob,
  mapAiJobToWorkerJob,
  assertSingleConsumer,
} = require('../../resources/app/worker-queue-adapter.cjs');

function run() {
  const collection = {
    id: 'item-1', account_id: 'account-1', run_id: 'run-1', conversation_id: 'conversation-1',
    status: 'retryable', attempts: 2, analysis_status: 'pending', followup_status: 'none',
    next_followup_at: '2026-11-16T10:00:00.000Z', last_error: 'temporary',
    checkpoint: 'history:42', coverage_status: 'full-history', created_at: 'created', updated_at: 'updated',
  };
  const collectionBefore = structuredClone(collection);
  const collectionJob = mapCollectionItemToWorkerJob(collection);
  assert.deepEqual(collectionJob, {
    jobId: 'legacy:collection:item-1',
    source: 'ws_collection_items',
    kind: 'ws.collect.history',
    legacyId: 'item-1',
    accountId: 'account-1',
    runId: 'run-1',
    conversationId: 'conversation-1',
    status: 'retryable',
    attempts: 2,
    analysisStatus: 'pending',
    followupStatus: 'none',
    nextFollowupAt: '2026-11-16T10:00:00.000Z',
    lastError: 'temporary',
    checkpoint: 'history:42',
    coverageStatus: 'full-history',
    idempotencyKey: 'legacy:collection:item-1',
    createdAt: 'created',
    updatedAt: 'updated',
  });
  assert.deepEqual(collection, collectionBefore, 'collection row must not be mutated');
  assert.deepEqual(mapCollectionItemToWorkerJob(collection), collectionJob, 'mapping must be stable');

  const ai = {
    id: 'ai-1', account_id: 'account-1', conversation_id: 'conversation-1',
    idempotency_key: 'ai:conversation-1:v4', payload_json: '{"source":"legacy"}',
    status: 'running', attempts: 3, max_attempts: 5, next_attempt_at: '', locked_at: 'locked',
    lease_token: 'lease-1', last_error: '', analysis_id: 'analysis-1', created_at: 'a-created', updated_at: 'a-updated',
  };
  const aiJob = mapAiJobToWorkerJob(ai);
  assert.deepEqual(aiJob, {
    jobId: 'legacy:ai:ai-1',
    source: 'ai_jobs',
    kind: 'ws.ai.analysis',
    legacyId: 'ai-1',
    accountId: 'account-1',
    conversationId: 'conversation-1',
    status: 'running',
    attempts: 3,
    maxAttempts: 5,
    nextAttemptAt: '',
    lockedAt: 'locked',
    leaseToken: 'lease-1',
    lastError: '',
    analysisId: 'analysis-1',
    payloadJson: '{"source":"legacy"}',
    idempotencyKey: 'ai:conversation-1:v4',
    createdAt: 'a-created',
    updatedAt: 'a-updated',
  });
  assert.deepEqual(mapAiJobToWorkerJob({ id: 'ai-2', account_id: 'a', conversation_id: 'c' }).idempotencyKey, 'legacy:ai:ai-2');

  assert.deepEqual(assertSingleConsumer({ legacyConsumerActive: false, workerConsumerActive: false }), {
    allowed: false, legacyConsumerActive: false, workerConsumerActive: false,
  });
  assert.deepEqual(assertSingleConsumer({ legacyConsumerActive: false, workerConsumerActive: true }), {
    allowed: true, legacyConsumerActive: false, workerConsumerActive: true,
  });
  assert.deepEqual(assertSingleConsumer({ legacyConsumerActive: 'false', workerConsumerActive: 'true' }), {
    allowed: false, legacyConsumerActive: false, workerConsumerActive: false,
  }, 'malformed string flags must fail closed');
  assert.throws(
    () => assertSingleConsumer({ legacyConsumerActive: true, workerConsumerActive: true }),
    error => error instanceof QueueAdapterError && error.code === 'DUAL_CONSUMER',
  );
  assert.throws(() => mapCollectionItemToWorkerJob({ account_id: 'a' }), /id is required/);
  assert.throws(() => mapAiJobToWorkerJob({ id: 'a' }), /account_id is required/);

  console.log(JSON.stringify({
    ok: true,
    stableCollectionJob: true,
    stableAiJob: true,
    legacyRowsUnchanged: true,
    dualConsumerRejected: true,
    productionQueueWritten: false,
  }));
}

run();

