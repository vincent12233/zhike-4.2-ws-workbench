// Loaded both by the sidecar (require) and as a classic browser script from
// index.html. The wrapper keeps every declaration private in the browser,
// exposes the same API as window.ZhikeAiJobPipeline, and never touches the
// CommonJS `module` global where it does not exist.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else if (root) root.ZhikeAiJobPipeline = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

/**
 * Storage-agnostic AI job lifecycle used by the controlled Stage 4 pipeline.
 *
 * The module deliberately knows nothing about SQLite or HTTP.  A storage
 * adapter must provide atomic compare-and-set semantics through
 * `updateIf(id, predicate, updater)`.  The sidecar can therefore wrap the
 * adapter call in its own transaction/fencing gate while tests use the
 * in-memory adapter exported below.
 */

const STATUS = Object.freeze({
  PENDING: 'pending',
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  RETRY_SCHEDULED: 'retry_scheduled',
});

const LEGACY_TO_CANONICAL = Object.freeze({
  pending: STATUS.PENDING,
  queued: STATUS.QUEUED,
  running: STATUS.RUNNING,
  retryable: STATUS.RETRY_SCHEDULED,
  retry_scheduled: STATUS.RETRY_SCHEDULED,
  completed: STATUS.COMPLETED,
  failed: STATUS.FAILED,
  cancelled: STATUS.CANCELLED,
  canceled: STATUS.CANCELLED,
});

const CANONICAL_TO_LEGACY = Object.freeze({
  [STATUS.PENDING]: 'queued',
  [STATUS.QUEUED]: 'queued',
  [STATUS.RUNNING]: 'running',
  [STATUS.COMPLETED]: 'completed',
  [STATUS.FAILED]: 'failed',
  [STATUS.CANCELLED]: 'cancelled',
  [STATUS.RETRY_SCHEDULED]: 'retryable',
});

const TRANSITIONS = Object.freeze({
  [STATUS.PENDING]: new Set([STATUS.QUEUED, STATUS.CANCELLED]),
  [STATUS.QUEUED]: new Set([STATUS.RUNNING, STATUS.CANCELLED]),
  [STATUS.RUNNING]: new Set([STATUS.COMPLETED, STATUS.FAILED, STATUS.RETRY_SCHEDULED, STATUS.CANCELLED]),
  [STATUS.RETRY_SCHEDULED]: new Set([STATUS.QUEUED, STATUS.RUNNING, STATUS.CANCELLED]),
  [STATUS.FAILED]: new Set([STATUS.RETRY_SCHEDULED, STATUS.CANCELLED]),
  [STATUS.COMPLETED]: new Set(),
  [STATUS.CANCELLED]: new Set(),
});

const text = value => String(value == null ? '' : value).normalize('NFKC').trim();
const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const clone = value => {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
};
const nowIso = () => new Date().toISOString();

class PipelineError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AiJobPipelineError';
    this.code = code;
    this.details = details;
  }
}

function normalizeStatus(value) {
  const key = text(value).toLocaleLowerCase().replace(/[\s-]+/g, '_');
  const result = LEGACY_TO_CANONICAL[key];
  if (!result) throw new PipelineError('INVALID_STATUS', `Unsupported AI job status: ${value}`);
  return result;
}

function toLegacyStatus(value) {
  const canonical = normalizeStatus(value);
  return CANONICAL_TO_LEGACY[canonical];
}

function parseJson(value, fallback) {
  if (value == null || value === '') return clone(fallback);
  if (typeof value === 'object') return clone(value);
  try { return JSON.parse(String(value)); }
  catch { return clone(fallback); }
}

function checkpointObject(value) {
  const parsed = parseJson(value, {});
  if (parsed == null) return {};
  if (typeof parsed === 'number' && Number.isFinite(parsed)) return { offset: parsed };
  if (typeof parsed === 'string' && /^\d+(?:\.\d+)?$/.test(parsed.trim())) return { offset: Number(parsed) };
  if (typeof parsed !== 'object' || Array.isArray(parsed)) return { value: parsed };
  return parsed;
}

const CHECKPOINT_PROGRESS_KEYS = Object.freeze([
  'completedChunks', 'completed_chunks', 'offset', 'sequence', 'position',
  'cursorPosition', 'cursor_position', 'index', 'page', 'progress', 'count',
]);

function checkpointProgress(value) {
  const point = checkpointObject(value);
  const numbers = CHECKPOINT_PROGRESS_KEYS
    .map(key => Number(point?.[key]))
    .filter(Number.isFinite);
  return numbers.length ? Math.max(...numbers) : 0;
}

function mergeCheckpoint(previous, incoming) {
  const prior = checkpointObject(previous);
  const next = checkpointObject(incoming);
  const priorProgress = checkpointProgress(prior);
  const nextProgress = checkpointProgress(next);
  if (nextProgress < priorProgress) {
    throw new PipelineError('CHECKPOINT_REGRESSION', 'Checkpoint cannot move backwards.', {
      previous: prior,
      incoming: next,
      previousProgress: priorProgress,
      incomingProgress: nextProgress,
    });
  }
  for (const key of CHECKPOINT_PROGRESS_KEYS) {
    const oldValue = Number(prior?.[key]);
    const nextValue = Number(next?.[key]);
    if (Number.isFinite(oldValue) && Number.isFinite(nextValue) && nextValue < oldValue) {
      throw new PipelineError('CHECKPOINT_REGRESSION', `Checkpoint field ${key} cannot move backwards.`, {
        field: key,
        previous: oldValue,
        incoming: nextValue,
      });
    }
  }
  return { ...prior, ...next };
}

function normalizeJob(row = {}) {
  const rawStatus = text(row.status || row.state) || STATUS.PENDING;
  const checkpoint = checkpointObject(row.checkpoint ?? row.checkpoint_json);
  const payload = parseJson(row.payload ?? row.payload_json, {});
  const normalized = {
    id: text(row.id),
    accountId: text(row.accountId ?? row.account_id) || 'default',
    conversationId: text(row.conversationId ?? row.conversation_id),
    groupId: text(row.groupId ?? row.group_id),
    groupJid: text(row.groupJid ?? row.group_jid),
    sourceEventId: text(row.sourceEventId ?? row.source_event_id),
    sourceMessageId: text(row.sourceMessageId ?? row.source_message_id),
    taskType: text(row.taskType ?? row.task_type ?? row.kind) || 'chat_analysis',
    idempotencyKey: text(row.idempotencyKey ?? row.idempotency_key),
    payload,
    status: normalizeStatus(rawStatus),
    legacyStatus: text(row.legacyStatus) || rawStatus,
    priority: Math.max(0, Math.min(100, Math.floor(finite(row.priority)))),
    attempts: Math.max(0, Math.floor(finite(row.attempts))),
    maxAttempts: Math.max(1, Math.min(100, Math.floor(finite(row.maxAttempts ?? row.max_attempts) || 5))),
    nextAttemptAt: text(row.nextAttemptAt ?? row.next_attempt_at),
    lockedAt: text(row.lockedAt ?? row.locked_at),
    leaseToken: text(row.leaseToken ?? row.lease_token),
    workerOwnerId: text(row.workerOwnerId ?? row.worker_owner_id),
    fencingToken: Math.max(0, Math.floor(finite(row.fencingToken ?? row.fencing_token))),
    lastError: text(row.lastError ?? row.last_error),
    analysisId: text(row.analysisId ?? row.analysis_id),
    resultRef: text(row.resultRef ?? row.result_ref),
    checkpoint,
    cancelRequested: row.cancelRequested === true || row.cancel_requested === true || Number(row.cancelRequested ?? row.cancel_requested) === 1,
    createdAt: text(row.createdAt ?? row.created_at),
    updatedAt: text(row.updatedAt ?? row.updated_at),
  };
  if (!normalized.id) throw new PipelineError('INVALID_JOB', 'AI job id is required.');
  return normalized;
}

function normalizeLegacyJob(row = {}) {
  const rawStatus = text(row.status || row.state) || 'queued';
  return { ...normalizeJob({ ...row, status: rawStatus }), legacyStatus: rawStatus };
}

function createMemoryStore(initial = []) {
  const jobs = new Map();
  const idempotency = new Map();
  const audits = [];
  const copy = value => clone(value);
  const keyFor = (accountId, idempotencyKey) => `${text(accountId) || 'default'}\u0000${text(idempotencyKey)}`;
  for (const item of Array.isArray(initial) ? initial : []) {
    const job = normalizeJob(item);
    jobs.set(job.id, copy(job));
    if (job.idempotencyKey) idempotency.set(keyFor(job.accountId, job.idempotencyKey), job.id);
  }
  return {
    getById(id) { const value = jobs.get(text(id)); return value ? copy(value) : null; },
    findByIdempotency(accountId, key) {
      const id = idempotency.get(keyFor(accountId, key));
      return id ? this.getById(id) : null;
    },
    insertIfAbsent(value) {
      const job = normalizeJob(value);
      const existingById = jobs.get(job.id);
      if (existingById) return { created: false, job: copy(existingById) };
      const existingId = job.idempotencyKey ? idempotency.get(keyFor(job.accountId, job.idempotencyKey)) : null;
      if (existingId) return { created: false, job: copy(jobs.get(existingId)) };
      jobs.set(job.id, copy(job));
      if (job.idempotencyKey) idempotency.set(keyFor(job.accountId, job.idempotencyKey), job.id);
      return { created: true, job: copy(job) };
    },
    updateIf(id, predicate, updater) {
      const current = jobs.get(text(id));
      if (!current || (typeof predicate === 'function' && !predicate(copy(current)))) return null;
      const next = typeof updater === 'function' ? updater(copy(current)) : { ...copy(current), ...clone(updater) };
      const normalized = normalizeJob(next);
      jobs.set(normalized.id, copy(normalized));
      if (normalized.idempotencyKey) idempotency.set(keyFor(normalized.accountId, normalized.idempotencyKey), normalized.id);
      return copy(normalized);
    },
    appendAudit(entry) { audits.push(copy(entry)); },
    list() { return [...jobs.values()].map(copy); },
    audits() { return audits.map(copy); },
  };
}

function createAiJobPipeline(options = {}) {
  const store = options.store || createMemoryStore();
  for (const method of ['getById', 'findByIdempotency', 'insertIfAbsent', 'updateIf']) {
    if (typeof store[method] !== 'function') throw new TypeError(`AI job storage adapter requires ${method}()`);
  }
  const clock = typeof options.now === 'function' ? options.now : nowIso;
  const idFactory = typeof options.idFactory === 'function' ? options.idFactory : () => `ai-job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const leaseFactory = typeof options.leaseFactory === 'function' ? options.leaseFactory : () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  const defaultMaxAttempts = Math.max(1, Math.min(100, Math.floor(finite(options.maxAttempts) || 5)));
  const defaultBackoff = Math.max(0, Math.floor(finite(options.retryDelayMs) || 1000));

  const at = () => {
    const value = clock();
    if (value instanceof Date) return value.toISOString();
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : nowIso();
  };
  const read = id => {
    const row = store.getById(text(id));
    return row ? normalizeJob(row) : null;
  };
  const requireJob = id => {
    const job = read(id);
    if (!job) throw new PipelineError('NOT_FOUND', `AI job not found: ${id}`);
    return job;
  };
  const audit = (action, before, after, details = {}) => {
    if (typeof store.appendAudit !== 'function') return;
    store.appendAudit({ action, jobId: after?.id || before?.id || '', from: before?.status || '', to: after?.status || '', at: at(), details: clone(details) });
  };
  const write = (job, predicate, updater, details = {}) => {
    const updated = store.updateIf(job.id, predicate, current => {
      const before = normalizeJob(current);
      const next = normalizeJob(updater(before));
      next.updatedAt = at();
      return next;
    });
    if (!updated) {
      const current = read(job.id);
      throw new PipelineError('CONCURRENT_UPDATE', 'AI job changed before the operation committed.', { expected: job, current });
    }
    const next = normalizeJob(updated);
    audit(details.action || 'update', job, next, details);
    return next;
  };
  const assertLease = (job, leaseToken) => {
    if (!text(leaseToken) || !job.leaseToken || text(leaseToken) !== job.leaseToken) {
      throw new PipelineError('LEASE_MISMATCH', 'AI job lease is no longer valid.', { jobId: job.id });
    }
  };
  const assertRunningLease = (job, leaseToken) => {
    if (job.status === STATUS.CANCELLED || job.status === STATUS.COMPLETED || job.status === STATUS.FAILED) {
      throw new PipelineError('TERMINAL_JOB', 'AI job is already terminal.', { jobId: job.id, status: job.status });
    }
    if (job.status !== STATUS.RUNNING) throw new PipelineError('INVALID_STATE', 'AI job is not running.', { jobId: job.id, status: job.status });
    assertLease(job, leaseToken);
    if (job.cancelRequested) throw new PipelineError('TERMINAL_JOB', 'AI job cancellation was requested.', { jobId: job.id });
  };
  const delayFor = (attempts, requested) => {
    if (requested != null) return Math.max(0, Math.floor(finite(requested)));
    const exponent = Math.max(0, Math.min(10, Math.floor(attempts) - 1));
    return Math.min(24 * 60 * 60 * 1000, defaultBackoff * (2 ** exponent));
  };

  function build(input = {}) {
    const accountId = text(input.accountId ?? input.account_id) || 'default';
    const conversationId = text(input.conversationId ?? input.conversation_id);
    const idempotencyKey = text(input.idempotencyKey ?? input.idempotency_key);
    if (!conversationId) throw new PipelineError('INVALID_INPUT', 'conversationId is required.');
    if (!idempotencyKey) throw new PipelineError('INVALID_INPUT', 'idempotencyKey is required.');
    const createdAt = at();
    return {
      id: text(input.id) || text(idFactory({ accountId, conversationId, idempotencyKey })),
      accountId,
      conversationId,
      groupId: text(input.groupId ?? input.group_id),
      groupJid: text(input.groupJid ?? input.group_jid),
      sourceEventId: text(input.sourceEventId ?? input.source_event_id),
      sourceMessageId: text(input.sourceMessageId ?? input.source_message_id),
      taskType: text(input.taskType ?? input.task_type ?? input.kind) || 'chat_analysis',
      idempotencyKey,
      payload: parseJson(input.payload ?? input.payload_json, {}),
      status: STATUS.PENDING,
      legacyStatus: 'queued',
      priority: Math.max(0, Math.min(100, Math.floor(finite(input.priority)))),
      attempts: 0,
      maxAttempts: Math.max(1, Math.min(100, Math.floor(finite(input.maxAttempts ?? input.max_attempts) || defaultMaxAttempts))),
      nextAttemptAt: createdAt,
      lockedAt: '',
      leaseToken: '',
      lastError: '',
      analysisId: text(input.analysisId ?? input.analysis_id),
      resultRef: text(input.resultRef ?? input.result_ref),
      checkpoint: checkpointObject(input.checkpoint ?? input.checkpoint_json),
      cancelRequested: false,
      createdAt,
      updatedAt: createdAt,
    };
  }

  function enqueue(input = {}) {
    const accountId = text(input.accountId ?? input.account_id) || 'default';
    const idempotencyKey = text(input.idempotencyKey ?? input.idempotency_key);
    if (!idempotencyKey) throw new PipelineError('INVALID_INPUT', 'idempotencyKey is required.');
    const existing = store.findByIdempotency(accountId, idempotencyKey);
    if (existing) return { existed: true, job: normalizeJob(existing) };
    const pending = build(input);
    const inserted = store.insertIfAbsent(pending);
    if (!inserted?.created) return { existed: true, job: normalizeJob(inserted?.job || store.findByIdempotency(accountId, idempotencyKey)) };
    const queued = write(normalizeJob(inserted.job), current => current.status === STATUS.PENDING, current => ({ ...current, status: STATUS.QUEUED, legacyStatus: 'queued' }), { action: 'enqueue' });
    return { existed: false, job: queued };
  }

  function transition(id, target, options = {}) {
    const current = requireJob(id);
    const nextStatus = normalizeStatus(target);
    if (current.status === nextStatus) return { changed: false, job: current };
    if (!TRANSITIONS[current.status]?.has(nextStatus)) {
      throw new PipelineError('INVALID_TRANSITION', `Cannot move AI job from ${current.status} to ${nextStatus}.`, { jobId: current.id, from: current.status, to: nextStatus });
    }
    const next = write(current, row => row.status === current.status, row => ({ ...row, status: nextStatus, legacyStatus: toLegacyStatus(nextStatus), ...(nextStatus !== STATUS.RUNNING ? { lockedAt: '', leaseToken: '' } : {}) }), { action: options.action || 'transition', reason: options.reason || '', target: nextStatus });
    return { changed: true, job: next };
  }

  function claim(id, options = {}) {
    const current = requireJob(id);
    if ([STATUS.COMPLETED, STATUS.FAILED, STATUS.CANCELLED].includes(current.status)) throw new PipelineError('TERMINAL_JOB', 'AI job is already terminal.', { jobId: current.id, status: current.status });
    if (![STATUS.QUEUED, STATUS.RETRY_SCHEDULED].includes(current.status)) return { claimed: false, reason: 'not-ready', job: current };
    const now = at();
    if (current.nextAttemptAt && Date.parse(current.nextAttemptAt) > Date.parse(now)) return { claimed: false, reason: 'backoff', job: current };
    const leaseToken = text(options.leaseToken) || text(leaseFactory(current));
    let claimed;
    try {
      claimed = write(current, row => [STATUS.QUEUED, STATUS.RETRY_SCHEDULED].includes(row.status) && (!row.nextAttemptAt || Date.parse(row.nextAttemptAt) <= Date.parse(now)), row => ({ ...row, status: STATUS.RUNNING, legacyStatus: 'running', attempts: row.attempts + 1, lockedAt: now, leaseToken, nextAttemptAt: '', lastError: '', cancelRequested: false }), { action: 'claim', owner: text(options.owner) });
    } catch (error) {
      if (error instanceof PipelineError && error.code === 'CONCURRENT_UPDATE') return { claimed: false, reason: 'race', job: read(id) };
      throw error;
    }
    return { claimed: true, job: claimed };
  }

  function checkpoint(id, options = {}) {
    const current = requireJob(id);
    assertRunningLease(current, options.leaseToken);
    const nextCheckpoint = mergeCheckpoint(current.checkpoint, options.checkpoint ?? options.value ?? {});
    const updated = write(current, row => row.status === STATUS.RUNNING && row.leaseToken === text(options.leaseToken) && row.cancelRequested !== true, row => ({ ...row, checkpoint: nextCheckpoint }), { action: 'checkpoint' });
    return { changed: true, job: updated };
  }

  function complete(id, options = {}) {
    const current = requireJob(id);
    assertRunningLease(current, options.leaseToken);
    const updated = write(current, row => row.status === STATUS.RUNNING && row.leaseToken === text(options.leaseToken) && row.cancelRequested !== true, row => ({ ...row, status: STATUS.COMPLETED, legacyStatus: 'completed', resultRef: text(options.resultRef ?? options.result_ref ?? row.resultRef), analysisId: text(options.analysisId ?? options.analysis_id ?? row.analysisId), lockedAt: '', leaseToken: '', nextAttemptAt: '', lastError: '' }), { action: 'complete' });
    return { changed: true, job: updated };
  }

  function fail(id, options = {}) {
    const current = requireJob(id);
    assertRunningLease(current, options.leaseToken);
    const retryable = options.retryable !== false;
    const shouldRetry = retryable && current.attempts < current.maxAttempts;
    const nextStatus = shouldRetry ? STATUS.RETRY_SCHEDULED : STATUS.FAILED;
    const now = at();
    const delay = shouldRetry ? delayFor(current.attempts, options.delayMs) : 0;
    const nextAttemptAt = shouldRetry ? new Date(Date.parse(now) + delay).toISOString() : '';
    const updated = write(current, row => row.status === STATUS.RUNNING && row.leaseToken === text(options.leaseToken) && row.cancelRequested !== true, row => ({ ...row, status: nextStatus, legacyStatus: toLegacyStatus(nextStatus), lockedAt: '', leaseToken: '', nextAttemptAt, lastError: text(options.error || options.lastError || 'AI job failed') }), { action: 'fail', retryable, nextStatus });
    return { changed: true, retried: shouldRetry, job: updated };
  }

  function retry(id, options = {}) {
    const current = requireJob(id);
    if (current.status === STATUS.CANCELLED || current.status === STATUS.COMPLETED) throw new PipelineError('TERMINAL_JOB', 'AI job is already terminal.', { jobId: current.id, status: current.status });
    if (current.status === STATUS.RUNNING) throw new PipelineError('INVALID_STATE', 'Running AI jobs must fail or be cancelled before retrying.', { jobId: current.id });
    if (![STATUS.FAILED, STATUS.RETRY_SCHEDULED].includes(current.status)) return { changed: false, job: current };
    const now = at();
    const nextAttemptAt = options.delayMs == null ? now : new Date(Date.parse(now) + Math.max(0, Math.floor(finite(options.delayMs)))).toISOString();
    const updated = write(current, row => [STATUS.FAILED, STATUS.RETRY_SCHEDULED].includes(row.status), row => ({ ...row, status: STATUS.RETRY_SCHEDULED, legacyStatus: 'retryable', nextAttemptAt, lastError: '', lockedAt: '', leaseToken: '', cancelRequested: false }), { action: 'retry', reason: text(options.reason) });
    return { changed: true, job: updated };
  }

  function cancel(id, options = {}) {
    const current = requireJob(id);
    if ([STATUS.COMPLETED, STATUS.FAILED, STATUS.CANCELLED].includes(current.status)) return { changed: false, job: current };
    if (current.status === STATUS.RUNNING && options.leaseToken && current.leaseToken !== text(options.leaseToken)) throw new PipelineError('LEASE_MISMATCH', 'AI job lease is no longer valid.', { jobId: current.id });
    const updated = write(current, row => row.status === current.status && ![STATUS.COMPLETED, STATUS.FAILED, STATUS.CANCELLED].includes(row.status), row => ({ ...row, status: STATUS.CANCELLED, legacyStatus: 'cancelled', cancelRequested: true, lockedAt: '', leaseToken: '', nextAttemptAt: '', lastError: text(options.reason || row.lastError || 'AI job cancelled') }), { action: 'cancel', reason: text(options.reason) });
    return { changed: true, job: updated };
  }

  return Object.freeze({
    enqueue,
    read,
    transition,
    claim,
    checkpoint,
    complete,
    fail,
    retry,
    cancel,
    normalize: normalizeJob,
  });
}

// Compatibility helpers consumed by the legacy read-only queue view and the
// isolated Stage 4 HTTP adapter. They operate on plain job snapshots and do
// not perform writes themselves; the storage-backed pipeline above remains
// the only stateful executor.
const STATES = Object.freeze(Object.values(STATUS));
function status(value) {
  try { return normalizeStatus(value); } catch { return null; }
}
function legacyStatus(value) {
  try { return toLegacyStatus(value); } catch { return null; }
}
function canTransition(from, to) {
  const source = status(from), target = status(to);
  return Boolean(source && target && (source === target || TRANSITIONS[source]?.has(target)));
}
function transitionSnapshot(input, target, options = {}) {
  const current = normalizeJob(input);
  const next = status(target);
  if (!next) throw new PipelineError('INVALID_STATUS', `Unsupported AI job status: ${target}`);
  if (current.status === STATUS.CANCELLED && next !== STATUS.CANCELLED) throw new PipelineError('INVALID_TRANSITION', '已取消任务不能进行非法状态转换。');
  if (current.status !== next && !TRANSITIONS[current.status]?.has(next)) throw new PipelineError('INVALID_TRANSITION', `Cannot move AI job from ${current.status} to ${next}.`);
  return { changed: current.status !== next, job: normalizeJob({ ...current, status: next, legacyStatus: legacyStatus(next), cancelRequested: next === STATUS.CANCELLED ? true : current.cancelRequested, workerOwnerId: options.workerOwnerId ?? current.workerOwnerId, updatedAt: options.updatedAt || current.updatedAt }) };
}
function claimSnapshot(input, ownerId, options = {}) {
  const current = normalizeJob(input);
  if (![STATUS.QUEUED, STATUS.RETRY_SCHEDULED].includes(current.status)) return { claimed: false, reason: 'not-ready', job: current };
  const now = options.now || nowIso();
  if (current.nextAttemptAt && Date.parse(current.nextAttemptAt) > Date.parse(now)) return { claimed: false, reason: 'backoff', job: current };
  return { claimed: true, job: normalizeJob({ ...current, status: STATUS.RUNNING, legacyStatus: 'running', attempts: current.attempts + 1, lockedAt: now, leaseToken: options.leaseToken || `snapshot-${Date.now().toString(36)}`, workerOwnerId: text(ownerId), nextAttemptAt: '', cancelRequested: false, updatedAt: now }) };
}
function cancelSnapshot(input, reason = '') {
  const current = normalizeJob(input);
  if ([STATUS.COMPLETED, STATUS.FAILED, STATUS.CANCELLED].includes(current.status)) return { changed: false, job: current };
  return { changed: true, job: normalizeJob({ ...current, status: STATUS.CANCELLED, legacyStatus: 'cancelled', cancelRequested: true, lastError: text(reason) || 'AI job cancelled', lockedAt: '', leaseToken: '', nextAttemptAt: '' }) };
}
function advanceCheckpoint(previous, incoming) {
  const before = checkpointObject(previous);
  const after = mergeCheckpoint(before, incoming);
  const beforeProgress = checkpointProgress(before);
  const afterProgress = checkpointProgress(after);
  if (afterProgress <= beforeProgress) throw new PipelineError('CHECKPOINT_REGRESSION', 'Checkpoint 必须单调递增。');
  return after;
}
function scheduleRetrySnapshot(input, error = '', now = Date.now(), options = {}) {
  const current = normalizeJob(input);
  const maxAttempts = Math.max(1, current.maxAttempts);
  const attempts = current.attempts;
  const canRetry = attempts < maxAttempts;
  if (!canRetry) return { retry: false, job: normalizeJob({ ...current, status: STATUS.FAILED, legacyStatus: 'failed', lastError: text(error) || 'AI job failed', lockedAt: '', leaseToken: '' }) };
  const delay = Math.max(0, Math.floor(Number(options.delayMs) || 1000 * (2 ** Math.max(0, attempts - 1))));
  return { retry: true, job: normalizeJob({ ...current, status: STATUS.RETRY_SCHEDULED, legacyStatus: 'retryable', nextAttemptAt: new Date(Number(now) + delay).toISOString(), lastError: text(error) || 'AI job failed', lockedAt: '', leaseToken: '' }) };
}
function isTerminal(value) {
  const normalized = status(value);
  return normalized === STATUS.COMPLETED || normalized === STATUS.FAILED || normalized === STATUS.CANCELLED;
}
function nextRetryAt(attempts = 1, now = Date.now(), baseDelayMs = 1000) {
  const exponent = Math.max(0, Math.min(10, Math.floor(Number(attempts) || 0) - 1));
  return new Date(Number(now) + Math.min(24 * 60 * 60 * 1000, Math.max(0, Number(baseDelayMs) || 1000) * (2 ** exponent))).toISOString();
}
function makeIdempotencyKey(input = {}) {
  const accountId = text(input.accountId ?? input.account_id) || 'default';
  const jobType = text(input.jobType ?? input.job_type) || 'ws.ai.analysis';
  const conversationId = text(input.conversationId ?? input.conversation_id);
  const groupJid = text(input.groupJid ?? input.group_jid);
  const explicit = text(input.idempotencyKey ?? input.idempotency_key);
  return explicit ? `${accountId}:${jobType}:${explicit}` : `${accountId}:${jobType}:${conversationId || groupJid}`;
}
function validateResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new PipelineError('INVALID_RESULT', 'AI result must be an object.');
  if (result.evidence != null && !Array.isArray(result.evidence)) throw new PipelineError('INVALID_RESULT', 'AI 证据必须是数组。');
  for (const evidence of result.evidence || []) {
    if (!evidence || typeof evidence !== 'object' || !text(evidence.field) || evidence.text == null) throw new PipelineError('INVALID_RESULT', 'AI 证据必须包含字段和原文。');
  }
  if (result.profileFacts != null && (typeof result.profileFacts !== 'object' || Array.isArray(result.profileFacts))) throw new PipelineError('INVALID_RESULT', 'AI profileFacts must be an object.');
  return clone(result);
}

return {
  STATES,
  status,
  legacyStatus,
  canTransition,
  transition: transitionSnapshot,
  claim: claimSnapshot,
  cancel: cancelSnapshot,
  scheduleRetry: scheduleRetrySnapshot,
  isTerminal,
  nextRetryAt,
  advanceCheckpoint,
  makeIdempotencyKey,
  validateResult,
  STATUS,
  TRANSITIONS,
  PipelineError,
  normalizeStatus,
  toLegacyStatus,
  normalizeJob,
  normalizeLegacyJob,
  checkpointProgress,
  mergeCheckpoint,
  createMemoryStore,
  createAiJobPipeline,
};
});
