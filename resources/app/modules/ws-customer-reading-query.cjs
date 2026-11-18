'use strict';

const { types } = require('node:util');
const { normalizeMemberIdentity } = require('./ws-group-monitor-core.js');

const MAX_MESSAGES = 25;
const MAX_ROWS = 10000;
const MAX_PAGE = 200;
const DEFAULT_PAGE = 50;
const MAX_CSV_BYTES = 16 * 1024 * 1024;

function readingError(code, message) {
  return Object.assign(new Error(message), { code });
}

function field(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength &&
    value === value.trim() && !/[\p{Cc}\p{Cf}]/u.test(value);
}

function callPolicy(callback, ...args) {
  if (typeof callback !== 'function' || types.isAsyncFunction(callback)) return null;
  const result = callback(...args);
  if (!types.isPromise(result)) return result;
  // The query cannot wait inside this SQLite transaction. A mistakenly
  // returned Promise cannot authorize or attest a row.
  Promise.prototype.catch.call(result, () => {});
  return null;
}

function memberKey(value) {
  if (!field(value, 240)) return '';
  const id = value.replace(/^whatsapp:/i, '');
  if (!/^(?:[a-z]{2}\.(?:ENT\.)?[a-z0-9]{1,128}|[a-z0-9._:-]+@lid|[0-9]+(?::[0-9]+)?@(?:s\.whatsapp\.net|c\.us)|\+?[0-9][0-9 ().-]*)$/i.test(id)) return '';
  const identity = normalizeMemberIdentity(id);
  if (identity.kind === 'opaque' || identity.kind === 'phone' || /@lid$/i.test(id)) return identity.value;
  return '';
}

function scopeKey(parts) {
  return JSON.stringify(parts);
}

function messageScopes(input, authorize, action) {
  if (!Array.isArray(input) || !input.length || input.length > MAX_MESSAGES) {
    throw readingError('READING_SCOPE_INVALID', 'Select between 1 and 25 explicit messages.');
  }
  const scopes = new Map();
  let exclusionInputCount = 0;
  for (const item of input) {
    const { accountId, groupJid, messageId, excludedMemberIds = [] } = item || {};
    if (!field(accountId, 120) || !field(groupJid, 240) || !/^[a-z0-9._-]+@g\.us$/.test(groupJid) || !field(messageId, 300)) {
      throw readingError('READING_SCOPE_INVALID', 'Each message requires its exact account, group and message IDs.');
    }
    const key = scopeKey([accountId, groupJid, messageId]);
    if (scopes.has(key)) throw readingError('READING_SCOPE_INVALID', 'Message selections must be unique.');
    if (!Array.isArray(excludedMemberIds) || (exclusionInputCount += excludedMemberIds.length) > MAX_ROWS) {
      throw readingError('READING_EXCLUSIONS_INVALID', 'Invalid or excessive message exclusions.');
    }
    const excluded = new Set();
    for (const value of excludedMemberIds) {
      const member = memberKey(value);
      if (!member) throw readingError('READING_EXCLUSIONS_INVALID', 'Exclusions require stable member IDs.');
      excluded.add(member);
    }
    const message = Object.freeze({ accountId, groupJid, messageId });
    scopes.set(key, { message, excluded });
  }
  for (const { message } of scopes.values()) {
    if (callPolicy(authorize, message, action) !== true) {
      throw readingError('READING_ACCESS_DENIED', 'Reading data is unavailable for the requested scope.');
    }
  }
  return [...scopes.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, scope]) => scope);
}

function time(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const date = value.slice(0, 10);
  const calendarDay = Date.parse(date + 'T00:00:00Z');
  if (!Number.isFinite(calendarDay) || new Date(calendarDay).toISOString().slice(0, 10) !== date || value.slice(11, 13) === '24') return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function prepareReading(db) {
  return {
    message: db.prepare('SELECT sent_at FROM ws_group_messages WHERE account_id=? AND group_jid=? AND message_id=?'),
    roster: db.prepare("SELECT member_jid FROM ws_group_members WHERE account_id=? AND group_jid=? AND status IN ('active','unknown') LIMIT ?"),
    relations: db.prepare(`SELECT relation.member_jid, relation.status, relation.review_reason, relation.manual_locked,
      relation.confidence, relation.data_json, customer.id AS customer_id, customer.name, customer.phone_normalized
      FROM customer_group_memberships AS relation
      LEFT JOIN customers AS customer ON customer.id=relation.customer_id AND customer.deleted=0
        AND NOT EXISTS (SELECT 1 FROM crm_identity_conflicts AS conflict
          WHERE customer.phone_normalized<>'' AND conflict.canonical_phone=customer.phone_normalized AND conflict.status='open')
      WHERE relation.account_id=? AND relation.group_jid=? LIMIT ?`),
    evidence: db.prepare(`SELECT id, member_jid, status, evidence_source, evidence_ref, observed_at
      FROM ws_group_read_evidence WHERE account_id=? AND group_jid=? AND message_id=? ORDER BY member_jid LIMIT ?`),
  };
}

function visibleCustomer(relation) {
  if (!relation.customer_id || !['在群', '已退群', '被移除'].includes(relation.status) ||
    (relation.review_reason && !(relation.manual_locked && relation.review_reason === 'manual-lock')) ||
    (!relation.manual_locked && relation.confidence < 0.6)) return null;
  try {
    if (JSON.parse(relation.data_json)?.origin === 'stage3-isolated-mock') return null;
  } catch {
    return null;
  }
  return { id: relation.customer_id, name: relation.name, phone: relation.phone_normalized };
}

function groupObservation(select, accountId, groupJid, bounded) {
  const members = new Set();
  const relations = new Map();
  let invalidRosterRows = 0;
  for (const row of bounded(select.roster, accountId, groupJid)) {
    const member = memberKey(row.member_jid);
    if (member) members.add(member);
    else invalidRosterRows++;
  }
  for (const relation of bounded(select.relations, accountId, groupJid)) {
    const member = memberKey(relation.member_jid);
    if (!member) {
      if (relation.status === '在群') invalidRosterRows++;
      continue;
    }
    if (relation.status === '在群') members.add(member);
    const customer = visibleCustomer(relation);
    if (!relations.has(member)) relations.set(member, customer);
    else if (relations.get(member)?.id !== customer?.id) relations.set(member, null);
  }
  return { members, relations, invalidRosterRows };
}

function verifyRead(row, message, sentAt, memberId, customer, verifyReadEvidence) {
  if (row.status !== 'read' || !customer || !field(row.evidence_ref, 1000) || !field(row.evidence_source, 1000) ||
    typeof verifyReadEvidence !== 'function') return null;
  // The isolated writer accepted caller-provided strings in both evidence columns.
  // Only an independent, server-owned verifier can attest the exact stored row.
  const attestation = callPolicy(verifyReadEvidence, Object.freeze({
    ...message, memberId, storedMemberId: row.member_jid, customerId: customer.id, evidenceId: row.id,
    claimedSource: row.evidence_source, evidenceRef: row.evidence_ref, claimedObservedAt: row.observed_at,
  }));
  const verifiedAt = time(attestation?.verifiedAt);
  const readAt = time(attestation?.readAt);
  if (!field(attestation?.source, 120) || !verifiedAt ||
    (attestation.readAt != null && !readAt) ||
    (readAt && (readAt > verifiedAt || (sentAt && readAt < sentAt)))) return null;
  return { source: attestation.source, readAt, verifiedAt };
}

function readingCoverage(observed, mapped, read, excluded, verifiedAt) {
  return {
    eligibleObservedMembers: observed, excludedObservedMembers: excluded,
    mappedObservedMembers: mapped, unmappedObservedMembers: observed - mapped,
    confirmedReadMembers: read, unknownMembers: observed - read, confirmedUnreadMembers: null,
    readRate: { numerator: read, denominator: null, value: null },
    identityCoverage: 'current-ledger',
    lastVerifiedAt: verifiedAt,
  };
}

function messageObservation(scope, sentAt, select, group, policy, bounded) {
  const { message, excluded } = scope;
  const ids = [message.accountId, message.groupJid, message.messageId];
  const members = new Set(group.members);
  const attestations = new Map();
  let invalidEvidenceRows = 0;
  for (const row of bounded(select.evidence, ...ids)) {
    const member = memberKey(row.member_jid);
    if (!member) {
      invalidEvidenceRows++;
      continue;
    }
    members.add(member);
    if (excluded.has(member)) continue;
    const result = verifyRead(row, message, sentAt, member, group.relations.get(member), policy.verifyReadEvidence);
    const prior = attestations.get(member);
    if (result && (!prior || result.verifiedAt > prior.verifiedAt)) attestations.set(member, result);
  }

  let excludedCount = 0;
  let mapped = 0;
  let read = 0;
  let lastVerifiedAt = null;
  const rows = [];
  for (const memberId of [...members].sort()) {
    if (excluded.has(memberId)) {
      excludedCount++;
      continue;
    }
    const customer = group.relations.get(memberId) || null;
    const result = attestations.get(memberId);
    if (customer) mapped++;
    if (result) {
      read++;
      if (!lastVerifiedAt || result.verifiedAt > lastVerifiedAt) lastVerifiedAt = result.verifiedAt;
    }
    rows.push({
      ...message, sentAt, memberId, customer,
      memberBasis: group.members.has(memberId) ? 'current-group-record' : 'message-evidence-record',
      status: result ? 'read' : 'unknown', readAt: result?.readAt ?? null,
      verifiedAt: result?.verifiedAt ?? null, source: result?.source ?? null,
    });
  }
  return {
    rows,
    summary: {
      ...message, sentAt, observedMembers: rows.length + excludedCount,
      ...readingCoverage(rows.length, mapped, read, excludedCount, lastVerifiedAt),
      rosterCoverage: group.members.size ? 'partial-current-observations' : 'unavailable',
      currentRosterObservedMembers: group.members.size,
      evidenceOnlyObservedMembers: members.size - group.members.size,
      exclusionCoverage: excluded.size ? 'explicit-member-ids' : 'no-explicit-exclusions',
      invalidRosterRows: group.invalidRosterRows, invalidEvidenceRows,
    },
  };
}

function summarizeCustomers(rows) {
  const customers = new Map();
  for (const row of rows) {
    if (!row.customer) continue;
    let result = customers.get(row.customer.id);
    if (!result) {
      result = { customer: row.customer, messageStatuses: new Map(), lastVerifiedAt: null };
      customers.set(row.customer.id, result);
    }
    const key = scopeKey([row.accountId, row.groupJid, row.messageId]);
    if (row.status === 'read' || !result.messageStatuses.has(key)) result.messageStatuses.set(key, row.status);
    if (row.verifiedAt && (!result.lastVerifiedAt || row.verifiedAt > result.lastVerifiedAt)) result.lastVerifiedAt = row.verifiedAt;
  }
  return [...customers.values()].map(({ customer, messageStatuses, lastVerifiedAt }) => {
    const observedMessages = messageStatuses.size;
    const readMessages = [...messageStatuses.values()].filter(status => status === 'read').length;
    return { customer, observedMessages, readMessages, unknownMessages: observedMessages - readMessages, lastVerifiedAt };
  }).sort((a, b) => a.customer.id < b.customer.id ? -1 : a.customer.id > b.customer.id ? 1 : 0);
}

function filters(input) {
  const { customerId, search = '', status, view = 'details' } = input;
  if ((customerId != null && !field(customerId, 160)) || typeof search !== 'string' || search.length > 160 ||
    (status != null && !['read', 'unknown', 'unread'].includes(status)) || !['details', 'customers'].includes(view)) {
    throw readingError('READING_FILTER_INVALID', 'Invalid reading report filters.');
  }
  const term = search.trim().toLowerCase();
  return {
    view,
    includes: row => (customerId == null || row.customer?.id === customerId) &&
      (status == null || row.status === status) &&
      (!term || Boolean(row.customer && (row.customer.name.toLowerCase().includes(term) || row.customer.phone.includes(term)))),
  };
}

function projectReading(db, input, policy, action) {
  const filter = filters(input);
  const scopes = messageScopes(input.messages, policy.authorize, action);
  let remaining = MAX_ROWS;
  const bounded = (statement, ...params) => {
    const records = statement.all(...params, remaining + 1);
    remaining -= records.length;
    if (remaining < 0) throw readingError('READING_RANGE_TOO_LARGE', 'Narrow the message or group scope.');
    return records;
  };
  // The caller can already own a transaction. A savepoint gives standalone
  // query and export a consistent read without committing an outer transaction.
  db.exec('SAVEPOINT customer_reading_query');
  try {
    const select = prepareReading(db);
    const groups = new Map();
    const messages = [];
    const rows = [];
    for (const scope of scopes) {
      const { accountId, groupJid, messageId } = scope.message;
      const captured = select.message.get(accountId, groupJid, messageId);
      if (!captured) throw readingError('READING_MESSAGE_UNAVAILABLE', 'A selected message has no captured record in its scope.');
      const key = scopeKey([accountId, groupJid]);
      if (!groups.has(key)) groups.set(key, groupObservation(select, accountId, groupJid, bounded));
      const observation = messageObservation(scope, time(captured.sent_at), select, groups.get(key), policy, bounded);
      if (rows.length + observation.rows.length > MAX_ROWS) throw readingError('READING_RANGE_TOO_LARGE', 'Narrow the message or group scope.');
      messages.push(observation.summary);
      for (const row of observation.rows) rows.push(row);
    }
    const customers = summarizeCustomers(rows);
    const matching = rows.filter(filter.includes);
    const result = {
      matches: filter.view === 'details' ? matching : summarizeCustomers(matching),
      messages,
      summary: {
        observedMessageMemberPairs: messages.reduce((count, item) => count + item.observedMembers, 0),
        eligibleObservedMessageMemberPairs: rows.length,
        excludedObservedMessageMemberPairs: messages.reduce((count, item) => count + item.excludedObservedMembers, 0),
        confirmedReadMessageMemberPairs: rows.filter(row => row.status === 'read').length,
        unknownMessageMemberPairs: rows.filter(row => row.status === 'unknown').length,
        confirmedUnreadMessageMemberPairs: null,
        distinctMappedCustomers: customers.length,
        distinctConfirmedReadCustomers: customers.filter(row => row.readMessages > 0).length,
      },
      coverage: {
        selectedMessageBasis: 'explicit-selection-of-captured-rows',
        snapshot: 'live',
        receiptAuthority: typeof policy.verifyReadEvidence === 'function' && !types.isAsyncFunction(policy.verifyReadEvidence)
          ? 'external-attestation-required-per-row' : 'unavailable',
        confirmedUnread: 'unavailable',
        readRate: 'unavailable-without-message-roster-and-exclusion-version',
      },
    };
    db.exec('RELEASE customer_reading_query');
    return result;
  } catch (error) {
    db.exec('ROLLBACK TO customer_reading_query');
    db.exec('RELEASE customer_reading_query');
    throw error;
  }
}

function queryCustomerGroupReading(db, input, policy = {}) {
  const { offset = 0, limit = DEFAULT_PAGE } = input;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_ROWS || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE) {
    throw readingError('READING_PAGE_INVALID', 'Invalid reading report page bounds.');
  }
  const { matches, ...report } = projectReading(db, input, policy, 'query');
  const rows = matches.slice(offset, offset + limit);
  return { ...report, rows, total: matches.length, nextOffset: offset + rows.length < matches.length ? offset + rows.length : null };
}

function csvCell(value, preserveDigits = false) {
  const text = String(value ?? '');
  const formula = /^[\p{White_Space}\p{Cc}\p{Cf}]*[=+\-@＝＋－＠]/u.test(text) || /^[\p{Z}\p{Cf}]*[\t\r\n]/u.test(text);
  const safe = formula || (preserveDigits && /^\d+$/.test(text)) ? "'" + text : text;
  return '"' + safe.replace(/"/g, '""') + '"';
}

function exportCustomerGroupReadingCsv(db, input, policy = {}) {
  const { matches } = projectReading(db, { ...input, view: 'details' }, policy, 'export');
  const headers = ['accountId', 'groupJid', 'messageId', 'sentAt', 'memberId', 'customerId', 'customerName',
    'phone', 'status', 'readAt', 'verifiedAt', 'source', 'memberBasis'];
  const lines = [headers.map(value => csvCell(value)).join(',')];
  let bytes = 3 + Buffer.byteLength(lines[0]) + 2;
  for (const row of matches) {
    const values = [row.accountId, row.groupJid, row.messageId, row.sentAt, row.memberId, row.customer?.id,
      row.customer?.name, row.customer?.phone, row.status, row.readAt, row.verifiedAt, row.source, row.memberBasis];
    const line = values.map((value, index) => csvCell(value, index === 4 || index === 7)).join(',');
    bytes += Buffer.byteLength(line) + 2;
    if (bytes > MAX_CSV_BYTES) throw readingError('READING_EXPORT_TOO_LARGE', 'Narrow the export scope.');
    lines.push(line);
  }
  return { rowCount: matches.length, csv: '\uFEFF' + lines.join('\r\n') + '\r\n' };
}

module.exports = Object.freeze({ queryCustomerGroupReading, exportCustomerGroupReadingCsv });
