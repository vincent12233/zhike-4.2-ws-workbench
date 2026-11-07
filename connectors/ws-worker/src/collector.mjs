import { createHash } from 'node:crypto';

export const PROTOCOL = 'zhike.ws.ingest.batch.v1';
export const CHECKPOINT_VERSION = 1;

const asText = (value) => value == null ? '' : String(value).trim();
const accountIdOf = (value) => {
  const accountId = asText(value);
  if (!accountId) throw new Error('accountId is required');
  return accountId;
};

function firstValue(input, keys) {
  for (const key of keys) {
    const value = input?.[key];
    if (value !== undefined && value !== null && asText(value) !== '') return value;
  }
  return '';
}

function asBoolean(value) {
  if (value === true || value === 1) return true;
  return ['true', '1', 'yes', 'y', '是', '有'].includes(asText(value).toLowerCase());
}

function asUnreadCount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (asBoolean(value)) return 1;
  const count = Number.parseInt(asText(value), 10);
  return Number.isFinite(count) ? Math.max(0, count) : 0;
}

function stableDate(value) {
  const text = asText(value);
  if (!text) return '';
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

function cursorRank(value) {
  const text = asText(value);
  return /^\d+$/.test(text) ? Number(text) : null;
}

function compareMessages(left, right) {
  const leftCursor = cursorRank(left?.cursor);
  const rightCursor = cursorRank(right?.cursor);
  if (leftCursor !== null && rightCursor !== null && leftCursor !== rightCursor) return leftCursor - rightCursor;
  if (leftCursor !== null && rightCursor === null) return 1;
  if (leftCursor === null && rightCursor !== null) return -1;
  const leftAt = Date.parse(left?.sentAt || left?.observedAt || '') || 0;
  const rightAt = Date.parse(right?.sentAt || right?.observedAt || '') || 0;
  return leftAt - rightAt;
}

export function messageFingerprint(input = {}) {
  const externalMessageId = asText(firstValue(input, ['externalMessageId', 'messageId', 'id', 'key']));
  const canonical = [
    asText(firstValue(input, ['accountId', 'account', 'profileId'])),
    asText(firstValue(input, ['conversationKey', 'conversationId', 'chatId', 'jid'])),
    externalMessageId,
    stableDate(firstValue(input, ['sentAt', 'timestamp', 'time'])),
    asText(firstValue(input, ['direction', 'fromMe']) || ''),
    externalMessageId ? '' : asText(firstValue(input, ['body', 'text', 'message'])),
  ].join('\u001f');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function normalizeVisibleMessage(input = {}) {
  const direction = ['outgoing', 'send', 'sent'].includes(asText(input.direction).toLowerCase()) || asBoolean(input.fromMe) ? 'outgoing' : 'incoming';
  const normalized = {
    connectorId: asText(firstValue(input, ['connectorId', 'connector'])),
    accountId: asText(firstValue(input, ['accountId', 'account', 'profileId'])),
    externalMessageId: asText(firstValue(input, ['externalMessageId', 'messageId', 'id', 'key'])),
    conversationKey: asText(firstValue(input, ['conversationKey', 'conversationId', 'chatId', 'jid'])),
    body: asText(firstValue(input, ['body', 'text', 'message'])),
    sentAt: stableDate(firstValue(input, ['sentAt', 'timestamp', 'time'])),
    direction,
    previewOnly: asBoolean(input.previewOnly),
    observedAt: stableDate(firstValue(input, ['observedAt', 'capturedAt'])) || new Date().toISOString(),
    cursor: asText(input.cursor),
  };
  normalized.fingerprint = messageFingerprint(normalized);
  return normalized;
}

export function normalizeVisibleConversation(input = {}) {
  return {
    conversationKey: asText(firstValue(input, ['conversationKey', 'conversationId', 'chatId', 'jid', 'id'])),
    displayName: asText(firstValue(input, ['displayName', 'title', 'name', 'subject'])),
    unreadCount: asUnreadCount(firstValue(input, ['unreadCount', 'unread', 'badge'])),
    lastMessagePreview: asText(firstValue(input, ['lastMessagePreview', 'lastMessage', 'preview', 'snippet'])),
    lastMessageAt: stableDate(firstValue(input, ['lastMessageAt', 'updatedAt', 'timestamp', 'time'])),
    visibleOnly: input.visibleOnly !== false,
  };
}

export function collectConversationList(input = []) {
  const rows = Array.isArray(input) ? input : (Array.isArray(input.rows) ? input.rows : (Array.isArray(input.items) ? input.items : (input.conversations || input.visibleConversations || [])));
  const byKey = new Map();
  for (const row of rows) {
    const item = normalizeVisibleConversation(row);
    if (!item.conversationKey) continue;
    const previous = byKey.get(item.conversationKey);
    if (!previous) {
      byKey.set(item.conversationKey, item);
      continue;
    }
    const previousTime = Date.parse(previous.lastMessageAt) || 0;
    const itemTime = Date.parse(item.lastMessageAt) || 0;
    if (itemTime >= previousTime) byKey.set(item.conversationKey, { ...item, unreadCount: Math.max(item.unreadCount, previous.unreadCount) });
    else if (item.unreadCount > previous.unreadCount) byKey.set(item.conversationKey, { ...previous, unreadCount: item.unreadCount });
  }
  return [...byKey.values()].sort((a, b) => a.conversationKey.localeCompare(b.conversationKey));
}

export function createCheckpoint(input = {}) {
  const fingerprints = [...new Set((input.seenFingerprints || []).map(asText).filter(Boolean))].slice(-5000);
  const accountId = accountIdOf(input.accountId);
  return {
    version: CHECKPOINT_VERSION,
    accountId,
    lastConversationKey: asText(input.lastConversationKey),
    cursor: asText(input.cursor || input.lastMessageAt),
    lastMessageFingerprint: asText(input.lastMessageFingerprint || fingerprints.at(-1)),
    lastMessageAt: stableDate(input.lastMessageAt),
    seenFingerprints: fingerprints,
    updatedAt: new Date().toISOString(),
  };
}

export function resumeMessages(messages = [], checkpoint = {}) {
  const checkpointAccountId = asText(checkpoint.accountId);
  const seen = new Set((checkpoint.seenFingerprints || []).map(asText).filter(Boolean));
  const result = [];
  for (const raw of messages) {
    const item = normalizeVisibleMessage(raw);
    if (checkpointAccountId && item.accountId && item.accountId !== checkpointAccountId) throw new Error('checkpoint account mismatch');
    if (!item.conversationKey || (!item.body && !item.externalMessageId)) continue;
    if (seen.has(item.fingerprint) || result.some((candidate) => candidate.fingerprint === item.fingerprint)) continue;
    result.push(item);
  }
  return result;
}

export function buildIngestBatch({ accountId = '', conversations = [], messages = [], checkpoint = {}, connectorId = '' } = {}) {
  const checkpointAccountId = asText(checkpoint.accountId);
  if (accountId && checkpointAccountId && asText(accountId) !== checkpointAccountId) throw new Error('checkpoint account mismatch');
  const normalizedAccountId = accountIdOf(accountId || checkpointAccountId);
  const uniqueMessages = resumeMessages(messages.map((message) => {
    const messageAccountId = asText(message?.accountId || message?.account || message?.profileId);
    if (messageAccountId && messageAccountId !== normalizedAccountId) throw new Error('message account mismatch');
    return { ...message, accountId: normalizedAccountId, connectorId: message.connectorId || connectorId };
  }), { ...checkpoint, accountId: normalizedAccountId });
  const latest = uniqueMessages.reduce((current, item) => !current || compareMessages(item, current) > 0 ? item : current, null);
  const nextCheckpoint = createCheckpoint({
    accountId: normalizedAccountId,
    lastConversationKey: latest?.conversationKey || checkpoint.lastConversationKey,
    cursor: latest?.cursor || checkpoint.cursor,
    lastMessageFingerprint: latest?.fingerprint || checkpoint.lastMessageFingerprint,
    lastMessageAt: latest?.sentAt || checkpoint.lastMessageAt,
    seenFingerprints: [...(checkpoint.seenFingerprints || []), ...uniqueMessages.map((message) => message.fingerprint)],
  });
  const checkpointEnvelope = nextCheckpoint.lastConversationKey ? {
    accountId: nextCheckpoint.accountId,
    conversationKey: nextCheckpoint.lastConversationKey,
    cursor: nextCheckpoint.cursor,
    lastMessageFingerprint: nextCheckpoint.lastMessageFingerprint,
    updatedAt: nextCheckpoint.updatedAt,
  } : null;
  return {
    protocol: PROTOCOL,
    connectorId: asText(connectorId),
    accountId: normalizedAccountId,
    capturedAt: new Date().toISOString(),
    scope: 'visible-authorized-content',
    conversations: collectConversationList(conversations),
    messages: uniqueMessages,
    checkpoint: nextCheckpoint,
    // A list-only capture can legitimately contain no message/conversation
    // cursor yet.  Do not emit an invalid empty checkpoint; the list itself
    // remains available to the next capture cycle.
    checkpoints: checkpointEnvelope ? [checkpointEnvelope] : [],
  };
}

export function reconnectPlan(attempt = 1, { baseDelayMs = 1000, maxDelayMs = 30000 } = {}) {
  const safeAttempt = Math.max(1, Math.trunc(Number(attempt) || 1));
  const base = Math.max(0, Number(baseDelayMs) || 0);
  const max = Math.max(base, Number(maxDelayMs) || base);
  return { attempt: safeAttempt, state: '正在重连', delayMs: Math.min(max, base * (2 ** (safeAttempt - 1))) };
}

export function connectorFailure(reason = '') {
  const message = asText(reason) || 'WS 连接器采集失败';
  const lower = message.toLowerCase();
  let state = '连接失败';
  let detail = '';
  let retryable = true;
  if (lower.includes('session') || lower.includes('expired') || message.includes('会话')) {
    state = '会话过期';
    retryable = false;
  } else if (lower.includes('selector') || message.includes('页面结构')) {
    state = '连接失败';
    detail = '页面结构变化';
    retryable = false;
  }
  return { state, detail, message, retryable, occurredAt: new Date().toISOString() };
}
