import { createHash } from 'node:crypto';

export const PROTOCOL = 'zhike.ws.ingest.batch.v1';
export const CHECKPOINT_VERSION = 1;

const asText = (value) => value == null ? '' : String(value).trim();

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
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : text;
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
  const direction = input.direction === 'outgoing' || asBoolean(input.fromMe) ? 'outgoing' : 'incoming';
  const normalized = {
    accountId: asText(firstValue(input, ['accountId', 'account', 'profileId'])),
    externalMessageId: asText(firstValue(input, ['externalMessageId', 'messageId', 'id', 'key'])),
    conversationKey: asText(firstValue(input, ['conversationKey', 'conversationId', 'chatId', 'jid'])),
    body: asText(firstValue(input, ['body', 'text', 'message'])),
    sentAt: stableDate(firstValue(input, ['sentAt', 'timestamp', 'time'])),
    direction,
    previewOnly: asBoolean(input.previewOnly),
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
  const rows = Array.isArray(input) ? input : (Array.isArray(input.rows) ? input.rows : (input.conversations || []));
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
    if (itemTime >= previousTime) byKey.set(item.conversationKey, item);
    else if (item.unreadCount > previous.unreadCount) byKey.set(item.conversationKey, { ...previous, unreadCount: item.unreadCount });
  }
  return [...byKey.values()].sort((a, b) => a.conversationKey.localeCompare(b.conversationKey));
}

export function createCheckpoint(input = {}) {
  const fingerprints = [...new Set((input.seenFingerprints || []).map(asText).filter(Boolean))].slice(-5000);
  return {
    version: CHECKPOINT_VERSION,
    accountId: asText(input.accountId),
    lastConversationKey: asText(input.lastConversationKey),
    lastMessageAt: stableDate(input.lastMessageAt),
    seenFingerprints: fingerprints,
    updatedAt: new Date().toISOString(),
  };
}

export function resumeMessages(messages = [], checkpoint = {}) {
  const seen = new Set((checkpoint.seenFingerprints || []).map(asText).filter(Boolean));
  const result = [];
  for (const raw of messages) {
    const item = normalizeVisibleMessage(raw);
    if (!item.conversationKey || (!item.body && !item.externalMessageId)) continue;
    if (seen.has(item.fingerprint) || result.some((candidate) => candidate.fingerprint === item.fingerprint)) continue;
    result.push(item);
  }
  return result;
}

export function buildIngestBatch({ accountId = '', conversations = [], messages = [], checkpoint = {} } = {}) {
  const normalizedAccountId = asText(accountId || checkpoint.accountId);
  const uniqueMessages = resumeMessages(messages.map((message) => ({ ...message, accountId: message.accountId || normalizedAccountId })), checkpoint);
  const nextCheckpoint = createCheckpoint({
    accountId: normalizedAccountId,
    lastConversationKey: uniqueMessages.at(-1)?.conversationKey || checkpoint.lastConversationKey,
    lastMessageAt: uniqueMessages.at(-1)?.sentAt || checkpoint.lastMessageAt,
    seenFingerprints: [...(checkpoint.seenFingerprints || []), ...uniqueMessages.map((message) => message.fingerprint)],
  });
  return {
    protocol: PROTOCOL,
    accountId: normalizedAccountId,
    capturedAt: new Date().toISOString(),
    scope: 'visible-authorized-content',
    conversations: collectConversationList(conversations),
    messages: uniqueMessages,
    checkpoint: nextCheckpoint,
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
  let retryable = true;
  if (lower.includes('session') || lower.includes('expired') || message.includes('会话')) {
    state = '会话过期';
    retryable = false;
  } else if (lower.includes('selector') || message.includes('页面结构')) {
    state = '页面结构变化';
    retryable = false;
  }
  return { state, message, retryable, occurredAt: new Date().toISOString() };
}
