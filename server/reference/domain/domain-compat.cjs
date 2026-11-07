'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const repo = path.resolve(__dirname, '..', '..', '..');
const ticket = require(path.join(repo, 'resources', 'app', 'modules', 'ticket-record-core.js'));

function loadSmartImport() {
  const window = {};
  const source = fs.readFileSync(path.join(repo, 'resources', 'app', 'modules', 'smart-import.js'), 'utf8');
  vm.runInNewContext(source, { window, Date, String, Number, RegExp, Math, Set, Object, Array });
  return window.ZhikeSmartImport;
}

const smart = loadSmartImport();

function clean(value) { return String(value ?? '').normalize('NFKC').trim(); }

function normalizePhone(value) {
  return clean(value).replace(/\D/g, '');
}

function resolveIdentity(input = {}) {
  const wsId = clean(input.wsContactId || input.whatsappContactId || input.waId || input.remoteJid || input.contactId);
  if (wsId) return { kind: 'ws', value: wsId, key: `ws:${wsId}` };
  const phone = normalizePhone(input.phone || input.phoneNormalized || input.phoneRaw || input.number);
  if (phone) return { kind: 'phone', value: phone, key: `phone:${phone}` };
  const account = clean(input.accountId || input.wsAccountId || input.account);
  if (account) return { kind: 'account', value: account, key: `account:${account}` };
  const session = clean(input.sessionId || input.conversationId || input.chatId);
  if (session) return { kind: 'session', value: session, key: `session:${session}` };
  const seed = JSON.stringify({ name: clean(input.name), source: clean(input.source) });
  return { kind: 'unknown', value: seed, key: `unknown:${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16)}` };
}

function ownerKey(record = {}) {
  return clean(record.customerId || record.customer || record.phone || record.phoneNormalized || record.wsContactId || record.conversationId).toLocaleLowerCase();
}

function inferRecordType(record = {}, context = '') {
  return smart.inferRecordType(record, context);
}

function businessRecordKey(record = {}) {
  const normalized = normalizeBusinessRecord(record);
  if (normalized.recordType === 'ticket') return ticket.ticketRecordKey(normalized);
  const owner = ownerKey(normalized);
  if (normalized.recordType === 'deposit') {
    return [owner, normalized.businessDate || normalized.date || '', clean(normalized.amount), clean(normalized.currency).toLocaleLowerCase(), clean(normalized.note || normalized.businessNote).toLocaleLowerCase()].join('|deposit|');
  }
  const stable = normalized.id || normalized.externalId || normalized.registeredDate || normalized.nextFollowupDate || normalized.note || JSON.stringify(normalized);
  return [owner, normalized.recordType, clean(stable).toLocaleLowerCase()].join('|');
}

function normalizeBusinessRecord(record = {}) {
  const next = { ...record };
  next.recordType = inferRecordType(next, next.context || '');
  next.phone = normalizePhone(next.phone || next.phoneNormalized || next.number);
  next.source = smart.normalizeSource(next.source || next.channel || next.leadSource || '', next.page || next.sourcePage || '', next.fallbackSource || '');
  next.status = smart.normalizeValue(next.status || next.groupStatus || '', 'status');
  next.registeredDate = smart.date(next.registeredDate || next.registeredAt || next.registrationDate || next.registered || '');
  next.nextFollowupDate = smart.date(next.nextFollowupDate || next.due || next.followupDate || '');
  next.businessDate = smart.date(next.businessDate || next.transactionDate || next.followDate || '');
  if (next.recordType === 'ticket') {
    const normalized = ticket.normalizeTicketRecord(next);
    return { ...next, ...normalized, product: normalized.product, direction: normalized.direction };
  }
  return next;
}

function expandBusinessRecord(record = {}) {
  const normalized = normalizeBusinessRecord(record);
  if (normalized.recordType === 'ticket') return ticket.expandTicketRecord(normalized).map(item => ({ ...item, recordType: 'ticket' }));
  return [normalized];
}

function mergeCustomerFields(existing = {}, incoming = {}, options = {}) {
  const onlyFillEmpty = options.onlyFillEmpty !== false;
  const patch = {};
  for (const [key, value] of Object.entries(incoming || {})) {
    if (value === undefined || value === null || clean(value) === '') continue;
    const current = existing?.[key];
    if (onlyFillEmpty && current !== undefined && current !== null && clean(current) !== '') continue;
    if (!onlyFillEmpty && JSON.stringify(current) === JSON.stringify(value)) continue;
    patch[key] = value;
  }
  return patch;
}

function toObjectRow(headers, row) {
  if (!Array.isArray(row)) return { ...row };
  const result = {};
  headers.forEach((header, index) => { result[header] = row[index]; });
  return result;
}

function classifyImportRows(headers = [], rows = [], options = {}) {
  let resolvedHeaders = Array.isArray(headers) ? headers.map(clean) : [];
  let resolvedRows = Array.isArray(rows) ? rows : [];
  if (!resolvedRows.length && Array.isArray(headers) && Array.isArray(headers[0]) && headers.length > 1) {
    const detected = smart.detectHeaderRow(headers, options);
    resolvedHeaders = detected.headers;
    resolvedRows = headers.slice(detected.index + 1);
  }
  if (!resolvedHeaders.length && resolvedRows.length && !Array.isArray(resolvedRows[0])) resolvedHeaders = Object.keys(resolvedRows[0]);
  const sampleRows = resolvedRows.slice(0, 30);
  const mapping = smart.inferHeaderMapping(resolvedHeaders, sampleRows, options);
  const valueAt = (row, field) => {
    const index = mapping[field];
    if (index === undefined || index === null) return '';
    return Array.isArray(row) ? row[index] : row[resolvedHeaders[index]];
  };
  return resolvedRows.map((row) => {
    const objectRow = toObjectRow(resolvedHeaders, row);
    const base = { ...objectRow, context: options.context || '' };
    const result = {
      ...base,
      name: clean(valueAt(row, 'name')),
      vipNumber: clean(valueAt(row, 'vipNumber')),
      phone: normalizePhone(valueAt(row, 'phone')),
      source: smart.normalizeSource(valueAt(row, 'source'), valueAt(row, 'page'), options.fallbackSource || ''),
      status: smart.normalizeValue(valueAt(row, 'status'), 'status'),
      group: clean(valueAt(row, 'group')),
      registeredDate: smart.date(valueAt(row, 'registered')),
      nextFollowupDate: smart.date(valueAt(row, 'due')),
      businessDate: smart.date(valueAt(row, 'followDate')),
      product: clean(valueAt(row, 'product')),
      direction: clean(valueAt(row, 'direction')) ? ticket.normalizeDirection(valueAt(row, 'direction')) : '',
      amount: clean(valueAt(row, 'amount')),
      currency: clean(valueAt(row, 'currency')).toUpperCase(),
      note: clean(valueAt(row, 'note') || valueAt(row, 'businessNote')),
    };
    result.recordType = inferRecordType(result, options.context || '');
    return normalizeBusinessRecord(result);
  });
}

module.exports = {
  normalizePhone,
  resolveIdentity,
  inferRecordType,
  businessRecordKey,
  normalizeBusinessRecord,
  expandBusinessRecord,
  mergeCustomerFields,
  classifyImportRows,
};
