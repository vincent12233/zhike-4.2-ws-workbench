'use strict';

const { normalizeMonitorStatusHistoryEvent } = require('./business-rule-core.js');

// Pure rules for the fixed WS group-monitor seat. Native collectors and the
// server own I/O; this module normalizes identities and builds an auditable
// per-account/per-group/customer projection.

const text = value => String(value == null ? '' : value).normalize('NFKC').trim();
const withoutWhatsAppPrefix = value => value.replace(/^whatsapp:/i, '').trim();
const isBusinessScopedId = value => /^[a-z]{2}\.(?:ENT\.)?[a-z0-9]{1,128}$/i.test(value);

function normalizePhone(value) {
  const normalized = withoutWhatsAppPrefix(text(value));
  if (isBusinessScopedId(normalized)) return '';
  let digits = normalized.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^91\d{10}$/.test(digits)) digits = digits.slice(2);
  return digits;
}

function normalizeMemberIdentity(value) {
  let raw = '';
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    raw = text(value.memberId || value.memberJid || value.participantId || value.jid || value.externalId || value.phone || value.id);
  } else raw = text(value);
  const original = raw;
  raw = withoutWhatsAppPrefix(raw);
  if (isBusinessScopedId(raw)) return { kind: 'opaque', value: raw, phone: '', raw: original };
  const at = raw.lastIndexOf('@');
  if (at > 0) {
    let local = raw.slice(0, at).trim().toLocaleLowerCase();
    const domain = raw.slice(at + 1).trim().toLocaleLowerCase();
    if (domain === 's.whatsapp.net' || domain === 'c.us') {
      local = local.split(':', 1)[0];
      const phone = normalizePhone(local);
      if (phone && phone.length >= 8 && phone.length <= 15) return { kind: 'phone', value: phone, phone, raw: original };
    }
    return { kind: domain === 'g.us' ? 'group' : 'jid', value: `${local}@${domain}`, phone: '', raw: original };
  }
  const phone = normalizePhone(raw);
  if (phone && phone.length >= 8 && phone.length <= 15) return { kind: 'phone', value: phone, phone, raw: original };
  const valueKey = raw.toLocaleLowerCase().replace(/\s+/g, '');
  return { kind: valueKey ? 'jid' : 'unknown', value: valueKey, phone: '', raw: original };
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}

function eventIdempotencyKey(event = {}) {
  const accountId = text(event.accountId || event.account_id);
  const groupJid = normalizeMemberIdentity(event.groupJid || event.group_id || event.groupId).value;
  const member = normalizeMemberIdentity(event.memberId || event.memberJid || event.participantId || event.member || event.phone);
  const type = text(event.type || event.eventType).toLocaleLowerCase();
  const sourceEventId = text(event.sourceEventId || event.source_event_id || event.externalEventId || event.id);
  const eventAt = text(event.eventAt || event.event_at || event.observedAt || event.observed_at);
  const raw = [accountId, groupJid, member.value, type, sourceEventId, eventAt].join('|');
  return `wsg-${stableHash(raw)}-${stableHash(raw.split('|').slice(0, 4).join('|'))}`;
}

function candidateExternalIds(customer) {
  const values = [];
  for (const key of ['wsExternalId', 'wsParticipantId', 'wsContactId']) if (text(customer?.[key])) values.push(text(customer[key]));
  for (const key of ['wsExternalIds', 'wsParticipantIds', 'wsContactIds']) if (Array.isArray(customer?.[key])) values.push(...customer[key].map(text));
  return new Set(values.filter(Boolean).map(value => normalizeMemberIdentity(value).value || value.toLocaleLowerCase()));
}

function candidatePhones(customer) {
  const values = [customer?.phone, customer?.rawPhone];
  for (const key of ['phones', 'phoneNumbers', 'legacyPhones']) if (Array.isArray(customer?.[key])) values.push(...customer[key]);
  return new Set(values.map(normalizePhone).filter(Boolean));
}

function mappingMatches(mapping, event, member, context = {}) {
  if (!mapping || typeof mapping !== 'object') return false;
  const account = text(event.accountId || event.account_id || context.accountId);
  const group = normalizeMemberIdentity(event.groupJid || event.group_id || event.groupId || context.groupJid).value;
  const mappingAccount = text(mapping.accountId || mapping.account_id);
  const mappingGroup = normalizeMemberIdentity(mapping.groupJid || mapping.group_id || mapping.groupId).value;
  if (member.kind === 'opaque' && (!account || !group || mappingAccount !== account || mappingGroup !== group)) return false;
  if (mappingAccount && account && mappingAccount !== account) return false;
  if (mappingGroup && group && mappingGroup !== group) return false;
  const mappingMember = normalizeMemberIdentity(mapping.memberId || mapping.memberJid || mapping.participantId || mapping.externalId || mapping.phone);
  return Boolean(mappingMember.value && member.value && mappingMember.value === member.value)
    || Boolean(mapping.phone && member.phone && normalizePhone(mapping.phone) === member.phone);
}

function resolveMembershipIdentity(event = {}, customers = [], mappings = [], options = {}) {
  const rows = (Array.isArray(customers) ? customers : []).filter(item => item && typeof item === 'object' && item.deleted !== true);
  const context = options && typeof options === 'object' ? options : {};
  const member = normalizeMemberIdentity(event.memberId || event.memberJid || event.participantId || event.member || event.phone);
  const unique = (kind, candidates, confidence) => {
    if (candidates.length === 1) return { status: 'matched', kind, customer: candidates[0], candidates, confidence };
    if (candidates.length > 1) return { status: 'ambiguous', kind, customer: null, candidates, confidence: 0 };
    return null;
  };
  // Legacy CRM identifiers have no business-portfolio scope for opaque IDs.
  if (member.kind !== 'opaque') {
    if (member.value) {
      const resolved = unique('participant-id', rows.filter(customer => candidateExternalIds(customer).has(member.value)), 1);
      if (resolved) return resolved;
    }
    const phone = member.phone || normalizePhone(event.phone || event.memberPhone || event.member_phone);
    if (phone) {
      const resolved = unique('phone', rows.filter(customer => candidatePhones(customer).has(phone)), 0.95);
      if (resolved) return resolved;
    }
  }
  const list = Array.isArray(mappings) ? mappings : (Array.isArray(mappings?.items) ? mappings.items : (Array.isArray(mappings?.mappings) ? mappings.mappings : []));
  const matches = list.filter(mapping => mappingMatches(mapping, event, member, context));
  const ids = [...new Set(matches.map(item => text(item.customerId || item.customer_id)).filter(Boolean))];
  if (ids.length > 1) return { status: 'ambiguous', kind: 'manual-mapping', customer: null, candidates: rows.filter(item => ids.includes(text(item.id))), confidence: 0 };
  if (ids.length === 1) {
    const customer = rows.find(item => text(item.id) === ids[0]);
    if (customer) return { status: 'matched', kind: 'manual-mapping', customer, candidates: [customer], confidence: 1 };
  }
  return { status: 'unmatched', kind: 'unmatched', customer: null, candidates: [], confidence: 0 };
}

function relationshipStatus(type) {
  return type === 'joined' ? '在群' : type === 'removed' ? '被移除' : type === 'left' ? '已退群' : '状态未知';
}

function eventTime(event, options = {}) {
  const value = text(event.eventAt || event.event_at || event.observedAt || event.observed_at || options.now);
  return value || new Date().toISOString();
}

// A WhatsApp group can expose a join request before the member is actually in
// the group.  Those rows must never create or update a customer relationship.
// Native collectors normally emit `joined` only after approval, but keeping the
// guard here makes the ingest contract safe for restored queues and future
// collectors too.
function isConfirmedJoinEvent(event = {}) {
  const type = text(event.type || event.eventType).toLocaleLowerCase();
  if (type !== 'joined') return false;
  if (event.pending === true || event.joinRequest === true || event.approvalPending === true || event.requiresApproval === true) return false;
  const state = text(event.approvalStatus || event.requestStatus || event.joinStatus || event.membershipStatus || event.reviewStatus || event.state || event.eventState).toLocaleLowerCase();
  const evidence = text(event.body || event.text || event.message || event.preview || event.label).toLocaleLowerCase();
  if (/(?:pending|requested|requested to join|request to join|join request|join approval|approval[_ -]?pending|审核中|待审核|待批准|加入申请|申请中|等待批准|审批中)/i.test(state)) return false;
  if (/(?:pending|requested|requested to join|request to join|join request|join approval|approval[_ -]?pending|审核中|待审核|待批准|加入申请|申请中|等待批准|审批中)/i.test(evidence)) return false;
  return true;
}

function applyMembershipProjection(profile = {}, target = {}, event = {}, customer = null, options = {}) {
  const type = text(event.type || event.eventType).toLocaleLowerCase();
  if (!['joined', 'left', 'removed'].includes(type)) return { status: 'ignored', reason: 'unsupported-event-type', relation: null };
  if (type === 'joined' && !isConfirmedJoinEvent(event)) return { status: 'ignored', reason: 'join-pending-or-unconfirmed', relation: null };
  const accountId = text(event.accountId || event.account_id || profile.accountId || profile.account_id);
  const groupJid = normalizeMemberIdentity(event.groupJid || event.group_id || event.groupId || target.groupJid || target.group_id).value;
  const member = normalizeMemberIdentity(event.memberId || event.memberJid || event.participantId || event.member || event.phone);
  const at = eventTime(event, options);
  const confidence = Math.max(0, Math.min(1, Number(event.confidence ?? event.identityConfidence ?? 0)));
  const existing = options.existingRelation || options.relation || null;
  const key = text(event.idempotencyKey) || eventIdempotencyKey({ ...event, accountId, groupJid, memberId: member.value, eventAt: at });
  const baseRelation = {
    id: text(existing?.id) || `membership-${stableHash([accountId, groupJid, text(customer?.id), member.value].join('|'))}`,
    accountId,
    profileId: text(profile.id || profile.profileId),
    targetId: text(target.id || target.targetId),
    groupJid,
    groupName: text(target.groupName || target.group_name || target.name),
    sourceId: text(target.sourceId || target.source_id),
    customerId: text(customer?.id || existing?.customerId),
    memberJid: member.value,
    memberPhone: member.phone,
    status: existing?.status || '状态未知',
    locked: Boolean(existing?.locked || existing?.manualLocked),
    confidence: Number(existing?.confidence || 0),
    firstJoinedAt: text(existing?.firstJoinedAt),
    lastEventAt: text(existing?.lastEventAt),
    lastEventId: text(existing?.lastEventId),
    lastEventKey: text(existing?.lastEventKey),
    updatedAt: text(existing?.updatedAt),
    reviewReason: text(existing?.reviewReason),
  };
  const eventId = text(event.id);
  // An absent event id is not evidence of a duplicate. Native preview rows
  // can legitimately omit it; the idempotency key remains the replay guard.
  if (existing && ((existing.lastEventKey && existing.lastEventKey === key)
    || (eventId && existing.lastEventId && existing.lastEventId === eventId))) return { status: 'duplicate', relation: { ...existing }, idempotencyKey: key };
  if (baseRelation.locked) return { status: 'review', relation: { ...baseRelation, reviewReason: 'manual-lock' }, reviewReason: 'manual-lock', idempotencyKey: key };
  if (!customer || !text(customer.id)) return { status: 'pending', relation: { ...baseRelation, customerId: '', status: '未关联客户', reviewReason: 'unmatched-customer' }, reviewReason: 'unmatched-customer', idempotencyKey: key };
  const threshold = Number.isFinite(Number(options.confidenceThreshold)) ? Number(options.confidenceThreshold) : 0.6;
  if (confidence < threshold) return { status: 'review', relation: { ...baseRelation, reviewReason: 'low-confidence' }, reviewReason: 'low-confidence', idempotencyKey: key };
  if (baseRelation.lastEventAt && Date.parse(at) < Date.parse(baseRelation.lastEventAt)) return { status: 'review', relation: { ...baseRelation, reviewReason: 'out-of-order' }, reviewReason: 'out-of-order', idempotencyKey: key };
  const nextStatus = relationshipStatus(type);
  const relation = {
    ...baseRelation,
    customerId: text(customer.id),
    status: nextStatus,
    confidence,
    firstJoinedAt: baseRelation.firstJoinedAt || (type === 'joined' ? at : ''),
    lastEventAt: at,
    lastEventId: text(event.id),
    lastEventKey: key,
    updatedAt: text(options.now) || new Date().toISOString(),
    reviewReason: '',
  };
  return {
    status: 'applied',
    relation,
    idempotencyKey: key,
    statusHistoryEvent: normalizeMonitorStatusHistoryEvent({
      id: text(event.id) || key,
      type,
      status: nextStatus,
      from: baseRelation.status,
      group: relation.groupName || groupJid,
      source: text(options.sourceLabel),
      accountId,
      groupJid,
      sourceId: relation.sourceId,
      memberJid: member.value,
      customerId: text(customer.id),
      date: at.slice(0, 10),
      at,
      confidence,
      origin: 'ws-group-monitor',
      locked: false,
    }),
    customerPatch: { customerId: text(customer.id), groupMembership: relation },
  };
}

module.exports = Object.freeze({ normalizeMemberIdentity, eventIdempotencyKey, resolveMembershipIdentity, applyMembershipProjection, isConfirmedJoinEvent });
