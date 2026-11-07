'use strict';

const crypto = require('node:crypto');

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function asIso(value, fallback = new Date().toISOString()) {
  const parsed = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function cursorRank(cursor) {
  const text = String(cursor ?? '').trim();
  if (/^\d+$/.test(text)) return Number(text);
  return null;
}

function fingerprintMessage(message) {
  const canonical = {
    accountId: String(message.accountId || '').trim(),
    conversationKey: String(message.conversationKey || '').trim(),
    externalMessageId: String(message.externalMessageId || '').trim(),
    body: String(message.body || '').trim(),
    sentAt: asIso(message.sentAt, '1970-01-01T00:00:00.000Z'),
    direction: message.direction === 'outgoing' ? 'outgoing' : 'incoming',
  };
  return stableHash(canonical);
}

class InMemoryPipeline {
  constructor(options = {}) {
    this.maxAttempts = Number.isInteger(options.maxAttempts) ? options.maxAttempts : 5;
    this.staleAfterMs = Number.isFinite(options.staleAfterMs) ? options.staleAfterMs : 120_000;
    this.accounts = new Map();
    this.conversations = new Map();
    this.messages = new Map();
    this.fingerprints = new Map();
    this.checkpoints = new Map();
    this.aiJobs = new Map();
    this.outbox = [];
    this.customers = new Map();
    this.followups = new Map();
  }

  registerAccount(account) {
    if (!account?.id) throw new Error('accountId is required');
    this.accounts.set(String(account.id), {
      id: String(account.id),
      customerId: String(account.customerId || ''),
      status: account.status || '已连接',
    });
  }

  ingestMessage(input) {
    const accountId = String(input?.accountId || '').trim();
    const conversationKey = String(input?.conversationKey || '').trim();
    if (!accountId || !conversationKey) throw new Error('accountId and conversationKey are required');
    if (!this.accounts.has(accountId)) throw new Error(`unknown WS account: ${accountId}`);
    const normalized = {
      accountId,
      conversationKey,
      externalMessageId: String(input.externalMessageId || '').trim(),
      body: String(input.body || '').trim(),
      sentAt: asIso(input.sentAt),
      observedAt: asIso(input.observedAt),
      direction: input.direction === 'outgoing' ? 'outgoing' : 'incoming',
      previewOnly: Boolean(input.previewOnly),
      cursor: String(input.cursor || '').trim(),
    };
    const fingerprint = fingerprintMessage(normalized);
    const existingId = this.fingerprints.get(`${accountId}:${fingerprint}`);
    if (existingId) {
      return { messageId: existingId, deduplicated: true, conversationId: this.messages.get(existingId).conversationId, message: this.messages.get(existingId) };
    }

    const conversationId = `conv-${stableHash({ accountId, conversationKey }).slice(0, 24)}`;
    const conversationMapKey = `${accountId}:${conversationKey}`;
    const previousConversation = this.conversations.get(conversationMapKey);
    const messageId = `msg-${fingerprint.slice(0, 24)}`;
    const message = { id: messageId, ...normalized, fingerprint, conversationId };
    this.messages.set(messageId, message);
    this.fingerprints.set(`${accountId}:${fingerprint}`, messageId);
    const previousTime = previousConversation?.lastMessageAt || '';
    const lastMessageAt = !previousTime || message.sentAt > previousTime ? message.sentAt : previousTime;
    this.conversations.set(conversationMapKey, {
      id: conversationId,
      accountId,
      externalKey: conversationKey,
      customerId: this.accounts.get(accountId).customerId || '',
      lastMessageAt,
      updatedAt: normalized.observedAt,
    });

    this.#advanceCheckpoint(conversationMapKey, normalized.cursor, fingerprint, normalized.observedAt);
    const dedupeKey = `analysis:${accountId}:${fingerprint}`;
    if (![...this.aiJobs.values()].some((job) => job.dedupeKey === dedupeKey)) {
      const job = {
        id: `job-${stableHash(dedupeKey).slice(0, 24)}`,
        jobType: 'ai.analysis',
        dedupeKey,
        messageId,
        state: 'pending',
        attempts: 0,
        availableAt: normalized.observedAt,
        lockedAt: null,
        lastError: '',
        createdAt: normalized.observedAt,
        updatedAt: normalized.observedAt,
      };
      this.aiJobs.set(job.id, job);
      this.outbox.push({
        aggregateType: 'message',
        aggregateId: messageId,
        eventType: 'ai.analysis.requested',
        payload: { jobId: job.id, messageId, conversationId },
        state: 'pending',
      });
    }
    return { messageId, deduplicated: false, conversationId, message };
  }

  #advanceCheckpoint(key, cursor, fingerprint, updatedAt) {
    if (!cursor && !fingerprint) return;
    const current = this.checkpoints.get(key);
    const nextRank = cursorRank(cursor);
    const currentRank = cursorRank(current?.cursor);
    const shouldAdvance = !current
      || (nextRank !== null && (currentRank === null || nextRank >= currentRank))
      || (nextRank === null && currentRank === null && updatedAt >= current.updatedAt);
    if (shouldAdvance) this.checkpoints.set(key, {
      cursor: cursor || current?.cursor || '',
      lastMessageFingerprint: fingerprint || current?.lastMessageFingerprint || '',
      updatedAt,
    });
  }

  claimJobs(now = new Date().toISOString()) {
    const nowIso = asIso(now);
    const claimed = [];
    for (const job of this.aiJobs.values()) {
      if (!['pending', 'retrying'].includes(job.state) || job.availableAt > nowIso) continue;
      job.state = 'running';
      job.attempts += 1;
      job.lockedAt = nowIso;
      job.updatedAt = nowIso;
      claimed.push(job);
    }
    return claimed;
  }

  recoverStaleJobs(now = new Date().toISOString()) {
    const nowMs = new Date(now).getTime();
    for (const job of this.aiJobs.values()) {
      if (job.state !== 'running' || !job.lockedAt) continue;
      if (nowMs - new Date(job.lockedAt).getTime() < this.staleAfterMs) continue;
      job.state = job.attempts >= this.maxAttempts ? 'dead' : 'retrying';
      job.availableAt = asIso(now);
      job.lockedAt = null;
      job.updatedAt = asIso(now);
    }
  }

  completeJob(jobId, now = new Date().toISOString()) {
    const job = this.aiJobs.get(jobId);
    if (!job) throw new Error(`unknown job: ${jobId}`);
    job.state = 'succeeded';
    job.lockedAt = null;
    job.updatedAt = asIso(now);
    return job;
  }

  failJob(jobId, error, now = new Date().toISOString()) {
    const job = this.aiJobs.get(jobId);
    if (!job) throw new Error(`unknown job: ${jobId}`);
    job.lastError = String(error || 'unknown error').slice(0, 500);
    job.lockedAt = null;
    job.updatedAt = asIso(now);
    if (job.attempts >= this.maxAttempts) {
      job.state = 'dead';
      job.availableAt = asIso(now);
    } else {
      job.state = 'retrying';
      const delayMs = Math.min(300_000, 1000 * (2 ** Math.max(0, job.attempts - 1)));
      job.availableAt = new Date(new Date(now).getTime() + delayMs).toISOString();
    }
    return job;
  }

  applyAiResult(result) {
    const customerId = String(result?.customerId || '').trim();
    if (!customerId) throw new Error('customerId is required');
    const customer = this.customers.get(customerId) || { id: customerId };
    const conflicts = [];
    for (const [field, value] of Object.entries(result.fields || {})) {
      if (value === undefined || value === null || value === '') continue;
      if (customer[field] === undefined || customer[field] === null || customer[field] === '') customer[field] = value;
      else if (String(customer[field]) !== String(value)) conflicts.push({ field, existing: customer[field], proposed: value, status: '待确认' });
    }
    customer.aiConfidence = Number.isFinite(result.confidence) ? result.confidence : customer.aiConfidence;
    customer.lastAiMessageId = result.sourceMessageId || customer.lastAiMessageId || '';
    this.customers.set(customerId, customer);

    let followup = { created: false, task: null };
    if (result.followup?.reasonKey) {
      const dedupeKey = `${customerId}:${String(result.followup.reasonKey).trim()}`;
      let task = this.followups.get(dedupeKey);
      if (!task) {
        task = {
          id: `followup-${stableHash(dedupeKey).slice(0, 24)}`,
          customerId,
          reasonKey: String(result.followup.reasonKey).trim(),
          title: String(result.followup.title || ''),
          detail: String(result.followup.detail || ''),
          dueAt: result.followup.dueAt ? asIso(result.followup.dueAt) : null,
          priority: String(result.followup.priority || 'normal'),
          state: 'pending',
          sourceMessageId: result.sourceMessageId || null,
          dedupeKey,
        };
        this.followups.set(dedupeKey, task);
        followup = { created: true, task };
      } else followup = { created: false, task };
    }
    return { customer, conflicts, followup };
  }
}

module.exports = { InMemoryPipeline, fingerprintMessage };
