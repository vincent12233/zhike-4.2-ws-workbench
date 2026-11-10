'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');

const ARRAY_FIELDS = [
  'customers', 'tickets', 'deposits', 'registrations', 'followups',
  'activities', 'batchOperations', 'messages', 'wsMessages', 'aiAnalyses',
];

function normalizePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.replace(/^91(?=\d{10}$)/, '');
}

function normalizeStatePayload(input) {
  const source = input && typeof input === 'object' ? input : {};
  const output = {};
  for (const field of ARRAY_FIELDS) output[field] = Array.isArray(source[field]) ? source[field].filter(row => row && typeof row === 'object').map(row => ({ ...row })) : [];
  output.version = source.version ?? 0;
  output.schemaVersion = source.schemaVersion ?? 0;
  return output;
}

function identity(row) {
  if (!row || typeof row !== 'object') return '';
  if (row.id != null && String(row.id).trim()) return `id:${String(row.id).trim()}`;
  const phone = normalizePhone(row.phone ?? row.rawPhone ?? row.contact);
  if (phone) return `phone:${phone}`;
  const session = row.accountId ?? row.conversationKey ?? row.sessionId ?? row.externalId;
  return session == null || !String(session).trim() ? '' : `session:${String(session).trim()}`;
}

function businessIdentity(row) {
  if (!row || typeof row !== 'object') return '';
  if (row.id != null && String(row.id).trim()) return `id:${String(row.id).trim()}`;
  const ref = row.tradeRef ?? row.externalRef ?? row.businessKey;
  if (ref != null && String(ref).trim()) return `ref:${String(ref).trim()}`;
  return [row.customerId, row.phone, row.product, row.direction, row.buyDate, row.sellDate, row.date, row.amount]
    .map(value => String(value ?? '').trim().toLocaleLowerCase())
    .join('|');
}

function mergeRecord(localRow, incomingRow, conflicts, sourceName) {
  const merged = { ...localRow };
  for (const [field, incoming] of Object.entries(incomingRow || {})) {
    if (incoming === undefined || incoming === null || String(incoming).trim() === '') continue;
    const existing = merged[field];
    if (existing === undefined || existing === null || String(existing).trim() === '') {
      merged[field] = incoming;
    } else if ((field === 'phone' || field === 'rawPhone' || field === 'contact')
      ? normalizePhone(existing) !== normalizePhone(incoming)
      : String(existing) !== String(incoming)) {
      conflicts.push({ identity: identity(localRow), field, local: existing, incoming, source: sourceName });
    }
  }
  return merged;
}

function mergeEntityArray(localRows, incomingRows, conflicts, field) {
  const merged = [...localRows];
  const index = new Map();
  for (const [position, row] of merged.entries()) {
    const key = field === 'customers' ? identity(row) : businessIdentity(row);
    if (key) index.set(key, position);
  }
  for (const row of incomingRows) {
    const key = field === 'customers' ? identity(row) : businessIdentity(row);
    if (!key || !index.has(key)) {
      merged.push({ ...row });
      if (key) index.set(key, merged.length - 1);
      continue;
    }
    const position = index.get(key);
    merged[position] = mergeRecord(merged[position], row, conflicts, field);
  }
  return merged;
}

function createMigrationPlan({ localState, dockerState, cancelled = false } = {}) {
  if (cancelled) return { cancelled: true, customers: [], tickets: [], conflicts: [], counts: {} };
  const local = normalizeStatePayload(localState);
  const docker = normalizeStatePayload(dockerState);
  const conflicts = [];
  const customers = mergeEntityArray(local.customers, docker.customers, conflicts, 'customers');
  const tickets = mergeEntityArray(local.tickets, docker.tickets, conflicts, 'tickets');
  const deposits = mergeEntityArray(local.deposits, docker.deposits, conflicts, 'deposits');
  return {
    cancelled: false,
    customers,
    tickets,
    deposits,
    conflicts,
    counts: { customers: customers.length, tickets: tickets.length, deposits: deposits.length },
  };
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function createBackupManifest(filePaths) {
  const files = (Array.isArray(filePaths) ? filePaths : []).filter(filePath => fs.existsSync(filePath)).map(filePath => {
    const stat = fs.statSync(filePath);
    return { path: filePath, bytes: stat.size, sha256: sha256File(filePath) };
  });
  return { createdAt: new Date().toISOString(), files };
}

module.exports = {
  normalizePhone,
  normalizeStatePayload,
  createMigrationPlan,
  createBackupManifest,
  sha256File,
};
