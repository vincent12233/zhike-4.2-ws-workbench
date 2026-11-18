'use strict';

/**
 * Read-only compatibility mapping from the production legacy queues to the
 * controlled Worker job contract.
 *
 * This module intentionally has no database import and no write path. The
 * legacy tables remain authoritative until a separately approved cutover.
 */

class QueueAdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'QueueAdapterError';
    this.code = code;
  }
}

function required(row, key) {
  const value = row?.[key];
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new QueueAdapterError('INVALID_LEGACY_ROW', `${key} is required`);
  }
  return String(value);
}

function optional(row, key, fallback = '') {
  const value = row?.[key];
  return value === undefined || value === null ? fallback : String(value);
}

function integer(row, key, fallback = 0) {
  const value = Number(row?.[key]);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function mapCollectionItemToWorkerJob(row) {
  const legacyId = required(row, 'id');
  const accountId = required(row, 'account_id');
  const conversationId = required(row, 'conversation_id');
  const jobId = `legacy:collection:${legacyId}`;
  return {
    jobId,
    source: 'ws_collection_items',
    kind: 'ws.collect.history',
    legacyId,
    accountId,
    runId: optional(row, 'run_id'),
    conversationId,
    status: optional(row, 'status', 'queued'),
    attempts: integer(row, 'attempts'),
    analysisStatus: optional(row, 'analysis_status', 'pending'),
    followupStatus: optional(row, 'followup_status', 'none'),
    nextFollowupAt: optional(row, 'next_followup_at'),
    lastError: optional(row, 'last_error'),
    checkpoint: optional(row, 'checkpoint'),
    coverageStatus: optional(row, 'coverage_status', 'unknown'),
    idempotencyKey: `legacy:collection:${legacyId}`,
    createdAt: optional(row, 'created_at'),
    updatedAt: optional(row, 'updated_at'),
  };
}

function mapAiJobToWorkerJob(row) {
  const legacyId = required(row, 'id');
  const accountId = required(row, 'account_id');
  const conversationId = required(row, 'conversation_id');
  const jobId = `legacy:ai:${legacyId}`;
  return {
    jobId,
    source: 'ai_jobs',
    kind: 'ws.ai.analysis',
    legacyId,
    accountId,
    conversationId,
    status: optional(row, 'status', 'queued'),
    attempts: integer(row, 'attempts'),
    maxAttempts: integer(row, 'max_attempts', 1),
    nextAttemptAt: optional(row, 'next_attempt_at'),
    lockedAt: optional(row, 'locked_at'),
    leaseToken: optional(row, 'lease_token'),
    lastError: optional(row, 'last_error'),
    analysisId: optional(row, 'analysis_id'),
    payloadJson: optional(row, 'payload_json', '{}'),
    idempotencyKey: optional(row, 'idempotency_key') || `legacy:ai:${legacyId}`,
    createdAt: optional(row, 'created_at'),
    updatedAt: optional(row, 'updated_at'),
  };
}

/**
 * Enforce the cutover invariant before a caller can hand a job to a Worker.
 * Two active consumers are always a hard error; both inactive is safe but not
 * executable. This function is deliberately side-effect free.
 */
function assertSingleConsumer({ legacyConsumerActive = false, workerConsumerActive = false } = {}) {
  // Configuration is fail-closed: only a real boolean true can activate a
  // consumer. Strings such as "false" or "true" are malformed input.
  const legacy = legacyConsumerActive === true;
  const worker = workerConsumerActive === true;
  if (legacy && worker) {
    throw new QueueAdapterError('DUAL_CONSUMER', 'legacy and Worker consumers cannot run at the same time');
  }
  return { allowed: worker && !legacy, legacyConsumerActive: legacy, workerConsumerActive: worker };
}

module.exports = {
  QueueAdapterError,
  mapCollectionItemToWorkerJob,
  mapAiJobToWorkerJob,
  assertSingleConsumer,
};

