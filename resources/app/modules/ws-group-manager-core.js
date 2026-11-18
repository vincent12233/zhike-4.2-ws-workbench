'use strict';

// Stage 3 group-manager domain service.  It is intentionally storage-agnostic:
// the sidecar repository can wrap these transitions in SQLite/fencing
// transactions, while the Mock Transport and contract tests use the same
// deterministic rules without touching a production database.
const {
  normalizeMemberIdentity,
  eventIdempotencyKey,
  isConfirmedJoinEvent,
} = require('./ws-group-monitor-core.js');

const text = value => String(value == null ? '' : value).normalize('NFKC').trim();
const nowIso = () => new Date().toISOString();
const keyFor = (accountId, value) => `${text(accountId)}\u0000${text(value).toLocaleLowerCase()}`;
const stableId = (prefix, value) => `${prefix}-${require('node:crypto').createHash('sha256').update(String(value)).digest('hex').slice(0, 32)}`;
const validAccount = value => {
  const accountId = text(value);
  if (!accountId || accountId.length > 160) throw new Error('accountId is required');
  return accountId;
};
const validGroup = value => {
  const groupJid = text(value).toLocaleLowerCase();
  if (!groupJid || !groupJid.endsWith('@g.us')) throw new Error('groupJid is required');
  return groupJid;
};
const flagsEnabled = (flags, name) => Boolean(flags && flags[name] === true);
const assertEnabled = (flags, name) => {
  if (!flagsEnabled(flags, 'IndependentWsGroupManagerEnabled')) throw new Error('Independent WS group manager is disabled');
  if (name && !flagsEnabled(flags, name)) throw new Error(`${name} is disabled`);
};
const eventTime = event => text(event.eventAt || event.event_at || event.observedAt || event.observed_at) || nowIso();
const rankRead = status => ({ unknown: 0, delivered: 1, read: 2 }[status] ?? -1);
const normalizePhone = value => normalizeMemberIdentity(value).phone || '';

function createGroupManager(options = {}) {
  const flags = options.flags || Object.create(null);
  const clock = typeof options.now === 'function' ? options.now : nowIso;
  const groups = new Map();
  const members = new Map();
  const events = new Map();
  const messages = new Map();
  const readEvidence = new Map();
  const syncErrors = new Map();
  const syncRuns = new Map();
  const audits = [];
  const customers = Array.isArray(options.customers) ? options.customers : [];
  const crm = options.crm && typeof options.crm === 'object' ? options.crm : {};

  function touch(value) { return text(value) || clock(); }
  function groupKey(accountId, groupJid) { return keyFor(validAccount(accountId), validGroup(groupJid)); }
  function memberKey(accountId, groupJid, memberJid) {
    return `${groupKey(accountId, groupJid)}\u0000${normalizeMemberIdentity(memberJid).value}`;
  }
  function messageKey(accountId, groupJid, messageId) {
    const id = text(messageId);
    if (!id || id.length > 300) throw new Error('messageId is required');
    return `${groupKey(accountId, groupJid)}\u0000${id}`;
  }
  function audit(accountId, groupJid, action, data = {}, outcome = 'accepted', reason = '') {
    audits.push({
      id: stableId('audit', `${validAccount(accountId)}|${validGroup(groupJid || 'audit@g.us')}|${action}|${audits.length}`),
      accountId: validAccount(accountId), groupJid: text(groupJid).toLocaleLowerCase(), action,
      outcome, reason, data, createdAt: clock(),
    });
  }
  function findCustomer(phone) {
    if (typeof crm.findByPhone === 'function') return crm.findByPhone(phone) || null;
    const matches = customers.filter(item => !item?.deleted && normalizePhone(item?.phone || item?.rawPhone) === phone);
    return matches.length === 1 ? matches[0] : matches.length > 1 ? { conflict: true, matches } : null;
  }
  function createCustomerForMember(accountId, groupJid, member) {
    if (!flagsEnabled(flags, 'GroupCrmAutoCreateEnabled') || typeof crm.createCustomer !== 'function') return null;
    if (!member.phone || member.phone.length < 8) return null;
    const existing = findCustomer(member.phone);
    if (existing?.conflict || existing) return existing;
    const created = crm.createCustomer({
      phone: member.phone,
      rawPhone: member.raw,
      source: '未分类，待绑定',
      channel: '未分类，待绑定',
      accountId,
      groupJid,
    });
    if (created) audit(accountId, groupJid, 'crm.create', { customerId: created.id, memberJid: member.value });
    return created || null;
  }

  function upsertGroup(input = {}) {
    assertEnabled(flags);
    const accountId = validAccount(input.accountId);
    const groupJid = validGroup(input.groupJid);
    const key = groupKey(accountId, groupJid);
    const previous = groups.get(key);
    const at = touch(input.updatedAt);
    const next = {
      id: text(previous?.id) || text(input.id) || stableId('group', key),
      accountId,
      groupJid,
      name: text(input.name || input.groupName || previous?.name),
      description: text(input.description ?? previous?.description),
      memberCount: Number.isFinite(Number(input.memberCount)) ? Math.max(0, Number(input.memberCount)) : Number(previous?.memberCount || 0),
      status: text(input.status || previous?.status) || 'active',
      lastSyncAt: text(input.lastSyncAt || previous?.lastSyncAt),
      createdAt: text(previous?.createdAt) || at,
      updatedAt: at,
    };
    groups.set(key, next);
    audit(accountId, groupJid, previous ? 'group.update' : 'group.create', { id: next.id, name: next.name });
    return { status: previous ? 'updated' : 'created', group: { ...next } };
  }

  function listGroups(accountId) {
    const scope = validAccount(accountId);
    return [...groups.values()].filter(item => item.accountId === scope).map(item => ({ ...item }));
  }

  function applyMemberEvent(input = {}) {
    assertEnabled(flags, 'GroupMemberSyncEnabled');
    const accountId = validAccount(input.accountId);
    const groupJid = validGroup(input.groupJid);
    const eventType = text(input.eventType || input.type).toLocaleLowerCase();
    if (!['joined', 'left', 'removed'].includes(eventType)) return { status: 'ignored', reason: 'unsupported-event-type' };
    if (eventType === 'joined' && !isConfirmedJoinEvent({ ...input, type: eventType })) return { status: 'ignored', reason: 'join-pending-or-unconfirmed' };
    const member = normalizeMemberIdentity(input.memberJid || input.memberId || input.memberPhone || input.phone);
    if (!member.value) return { status: 'ignored', reason: 'member-identity-missing' };
    const at = eventTime(input);
    const idempotencyKey = text(input.idempotencyKey) || eventIdempotencyKey({ ...input, accountId, groupJid, memberId: member.value, type: eventType, eventAt: at });
    if (events.has(idempotencyKey)) return { status: 'duplicate', event: { ...events.get(idempotencyKey) } };
    const relationKey = memberKey(accountId, groupJid, member.value);
    const existing = members.get(relationKey);
    if (existing?.lastEventAt && Date.parse(at) < Date.parse(existing.lastEventAt)) {
      const review = { ...existing, reviewReason: 'out-of-order', updatedAt: clock() };
      members.set(relationKey, review);
      events.set(idempotencyKey, { idempotencyKey, accountId, groupJid, memberJid: member.value, eventType, eventAt: at, status: 'review' });
      audit(accountId, groupJid, 'member.event', { memberJid: member.value }, 'review', 'out-of-order');
      return { status: 'review', reason: 'out-of-order', relation: { ...review } };
    }
    let customer = findCustomer(member.phone);
    if (customer?.conflict) {
      events.set(idempotencyKey, { idempotencyKey, accountId, groupJid, memberJid: member.value, eventType, eventAt: at, status: 'review' });
      audit(accountId, groupJid, 'crm.match', { memberJid: member.value }, 'review', 'multiple-customers');
      return { status: 'review', reason: 'multiple-customers', candidates: customer.matches };
    }
    if (!customer && eventType === 'joined') customer = createCustomerForMember(accountId, groupJid, member);
    const status = eventType === 'joined' ? 'active' : eventType === 'left' ? 'left' : 'removed';
    const next = {
      id: text(existing?.id) || stableId('member', relationKey), accountId, groupJid, memberJid: member.value,
      memberPhone: member.phone, customerId: text(customer?.id), status, firstSeenAt: text(existing?.firstSeenAt) || at,
      lastEventAt: at, lastEventType: eventType, lastEventKey: idempotencyKey, reviewReason: '', updatedAt: clock(),
    };
    members.set(relationKey, next);
    const event = { idempotencyKey, accountId, groupJid, memberJid: member.value, memberPhone: member.phone, eventType, eventAt: at, status: customer ? 'applied' : 'pending-crm' };
    events.set(idempotencyKey, event);
    audit(accountId, groupJid, 'member.event', { memberJid: member.value, customerId: next.customerId }, event.status === 'pending-crm' ? 'review' : 'accepted', event.status === 'pending-crm' ? 'unmatched-customer' : '');
    return { status: event.status, relation: { ...next }, event: { ...event }, customer: customer ? { ...customer } : null };
  }

  function listMembers(accountId, groupJid = '') {
    const scope = validAccount(accountId);
    const group = groupJid ? validGroup(groupJid) : '';
    return [...members.values()].filter(item => item.accountId === scope && (!group || item.groupJid === group)).map(item => ({ ...item }));
  }

  function upsertMessage(input = {}) {
    assertEnabled(flags, 'GroupMessageCollectionEnabled');
    const accountId = validAccount(input.accountId);
    const groupJid = validGroup(input.groupJid);
    const key = messageKey(accountId, groupJid, input.messageId);
    const previous = messages.get(key);
    if (previous) return { status: 'duplicate', message: { ...previous } };
    const at = touch(input.updatedAt);
    const processingStatus = text(input.processingStatus) || 'captured';
    if (!['captured', 'queued', 'analysed', 'failed', 'skipped'].includes(processingStatus)) throw new Error('invalid message processing status');
    const message = {
      id: text(input.id) || stableId('message', key), accountId, groupJid, messageId: text(input.messageId),
      senderJid: text(input.senderJid), senderPhone: normalizePhone(input.senderPhone || input.senderJid),
      sentAt: text(input.sentAt) || at, type: text(input.type || input.messageType) || 'text',
      processingStatus, sourceEvidence: text(input.sourceEvidence),
      bodyHash: text(input.bodyHash), createdAt: at, updatedAt: at,
    };
    messages.set(key, message);
    audit(accountId, groupJid, 'message.capture', { messageId: message.messageId });
    return { status: 'created', message: { ...message } };
  }

  function listMessages(accountId, groupJid = '') {
    const scope = validAccount(accountId);
    const group = groupJid ? validGroup(groupJid) : '';
    return [...messages.values()].filter(item => item.accountId === scope && (!group || item.groupJid === group)).map(item => ({ ...item }));
  }

  function recordReadEvidence(input = {}) {
    assertEnabled(flags, 'GroupReadEvidenceEnabled');
    const accountId = validAccount(input.accountId);
    const groupJid = validGroup(input.groupJid);
    const status = text(input.status).toLocaleLowerCase();
    if (!['unknown', 'delivered', 'read'].includes(status)) throw new Error('invalid read evidence status');
    if (status === 'read' && !text(input.evidence || input.evidenceRef || input.evidenceSource)) throw new Error('read evidence is required');
    const messageId = text(input.messageId);
    if (!messageId) throw new Error('messageId is required');
    const member = normalizeMemberIdentity(input.memberJid || input.memberId || input.memberPhone || '').value;
    const key = `${messageKey(accountId, groupJid, messageId)}\u0000${member}`;
    const previous = readEvidence.get(key);
    if (previous && rankRead(status) < rankRead(previous.status)) return { status: 'ignored', reason: 'read-evidence-regression', evidence: { ...previous } };
    const at = touch(input.observedAt);
    const evidenceValue = text(input.evidence || input.evidenceRef || input.evidenceSource);
    if (previous && rankRead(status) === rankRead(previous.status) && evidenceValue === previous.evidence) {
      return { status: 'duplicate', evidence: { ...previous } };
    }
    const next = {
      id: text(previous?.id) || stableId('read', key), accountId, groupJid, messageId,
      memberJid: member, status, evidence: evidenceValue, observedAt: at, updatedAt: clock(),
    };
    readEvidence.set(key, next);
    audit(accountId, groupJid, 'message.read-evidence', { messageId: next.messageId, memberJid: next.memberJid, status });
    return { status: previous ? 'updated' : 'created', evidence: { ...next } };
  }

  function listReadEvidence(accountId, groupJid = '') {
    const scope = validAccount(accountId);
    const group = groupJid ? validGroup(groupJid) : '';
    return [...readEvidence.values()].filter(item => item.accountId === scope && (!group || item.groupJid === group)).map(item => ({ ...item }));
  }

  function startSyncRun(input = {}) {
    assertEnabled(flags);
    const accountId = validAccount(input.accountId);
    const groupJid = validGroup(input.groupJid);
    const runId = text(input.runId) || stableId('run', `${accountId}|${groupJid}|${clock()}`);
    const key = `${accountId}\u0000${runId}`;
    const previous = syncRuns.get(key);
    if (previous) return { status: 'duplicate', run: { ...previous } };
    const kind = ['catalog', 'members', 'messages', 'full'].includes(text(input.kind)) ? text(input.kind) : 'full';
    const run = {
      id: runId, accountId, groupJid, kind, status: 'queued', checkpoint: text(input.checkpoint),
      itemCount: Math.max(0, Number(input.itemCount) || 0), retryCount: Math.max(0, Number(input.retryCount) || 0),
      errorMessage: '', startedAt: '', completedAt: '', createdAt: clock(), updatedAt: clock(),
    };
    syncRuns.set(key, run);
    audit(accountId, groupJid, 'sync.create', { runId, kind });
    return { status: 'created', run: { ...run } };
  }

  function updateSyncRun(input = {}) {
    assertEnabled(flags);
    const accountId = validAccount(input.accountId), runId = text(input.runId);
    if (!runId) throw new Error('runId is required');
    const key = `${accountId}\u0000${runId}`, previous = syncRuns.get(key);
    if (!previous) throw new Error('sync run not found');
    if (['completed', 'cancelled'].includes(previous.status)) return { status: 'ignored', reason: 'sync-run-closed', run: { ...previous } };
    const nextStatus = ['queued', 'running', 'completed', 'failed', 'cancelled'].includes(text(input.status)) ? text(input.status) : previous.status;
    const next = { ...previous, status: nextStatus, checkpoint: input.checkpoint == null ? previous.checkpoint : text(input.checkpoint), itemCount: input.itemCount == null ? previous.itemCount : Math.max(previous.itemCount, Math.max(0, Number(input.itemCount) || 0)), retryCount: input.retryCount == null ? previous.retryCount : Math.max(previous.retryCount, Math.max(0, Number(input.retryCount) || 0)), errorMessage: input.errorMessage == null ? previous.errorMessage : text(input.errorMessage), startedAt: input.startedAt == null ? previous.startedAt : text(input.startedAt), completedAt: input.completedAt == null ? previous.completedAt : text(input.completedAt), updatedAt: clock() };
    syncRuns.set(key, next);
    audit(accountId, previous.groupJid, 'sync.update', { runId, status: nextStatus, checkpoint: next.checkpoint });
    return { status: 'updated', run: { ...next } };
  }

  function listSyncRuns(accountId, groupJid = '') {
    const scope = validAccount(accountId), group = groupJid ? validGroup(groupJid) : '';
    return [...syncRuns.values()].filter(item => item.accountId === scope && (!group || item.groupJid === group)).map(item => ({ ...item }));
  }

  function recordSyncError(input = {}) {
    assertEnabled(flags);
    const accountId = validAccount(input.accountId);
    const groupJid = text(input.groupJid).toLocaleLowerCase();
    const runId = text(input.runId) || 'unscoped';
    const operation = text(input.operation) || 'unknown';
    const code = text(input.errorCode) || 'UNKNOWN';
    const status = ['open', 'retrying', 'resolved', 'ignored'].includes(text(input.status)) ? text(input.status) : 'open';
    const key = `${accountId}\u0000${runId}\u0000${operation}\u0000${code}`;
    const previous = syncErrors.get(key);
    const requestedRetry = Number.isFinite(Number(input.retryCount)) ? Math.max(0, Number(input.retryCount)) : 0;
    const error = { id: text(previous?.id) || stableId('error', key), accountId, groupJid, runId, operation, errorCode: code, errorMessage: text(input.errorMessage), retryCount: Math.max(requestedRetry, Number(previous?.retryCount || 0) + (previous ? 1 : 0)), status, updatedAt: clock() };
    syncErrors.set(key, error);
    audit(accountId, groupJid, 'sync.error', { runId, operation, errorCode: code }, 'error', error.errorMessage);
    return { status: previous ? 'updated' : 'created', error: { ...error } };
  }

  function listAudit(accountId, groupJid = '') {
    const scope = validAccount(accountId);
    const group = text(groupJid).toLocaleLowerCase();
    return audits.filter(item => item.accountId === scope && (!group || item.groupJid === group)).map(item => ({ ...item, data: { ...item.data } }));
  }

  function appendGroupAudit(input = {}) {
    assertEnabled(flags);
    const accountId = validAccount(input.accountId), groupJid = validGroup(input.groupJid);
    audit(accountId, groupJid, text(input.action) || 'unknown', input.data && typeof input.data === 'object' ? input.data : {}, text(input.outcome) || 'accepted', text(input.reason));
    return listAudit(accountId, groupJid).at(-1) || null;
  }

  function listGroupState(accountId, groupJid) {
    const scope = validAccount(accountId), group = validGroup(groupJid);
    return {
      accountId: scope,
      groupJid: group,
      group: listGroups(scope).find(item => item.groupJid === group) || null,
      members: listMembers(scope, group),
      messages: listMessages(scope, group),
      readEvidence: listReadEvidence(scope, group),
      syncRuns: listSyncRuns(scope, group),
      audit: listAudit(scope, group),
      errors: [...syncErrors.values()].filter(item => item.accountId === scope && item.groupJid === group).map(item => ({ ...item })),
    };
  }

  return Object.freeze({
    upsertGroup, listGroups, applyMemberEvent, listMembers, upsertMessage, upsertGroupMessage: upsertMessage, listMessages,
    recordReadEvidence, listReadEvidence, recordSyncError, listAudit, appendGroupAudit,
    startSyncRun, updateSyncRun, listSyncRuns, listGroupState,
  });
}

module.exports = Object.freeze({ createGroupManager });
