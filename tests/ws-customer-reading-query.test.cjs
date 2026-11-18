'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations } = require('../resources/app/migration-runner.cjs');
const { queryCustomerGroupReading, exportCustomerGroupReadingCsv } = require('../resources/app/modules/ws-customer-reading-query.cjs');

const now = '2026-11-17T10:00:00.000Z';
const readAt = '2026-11-17T10:03:00.000Z';
const verifiedAt = '2026-11-17T10:04:00.000Z';
const message = { accountId: 'reading-a', groupJid: 'group-a@g.us', messageId: 'shared-msg' };
const nextMessage = { ...message, messageId: 'second-msg' };
const otherGroup = { ...message, groupJid: 'group-b@g.us' };
const otherAccount = { ...message, accountId: 'reading-b' };
const empty = { ...message, groupJid: 'group-empty@g.us' };
const large = { ...message, groupJid: 'group-large@g.us' };
const malicious = { ...message, groupJid: 'group-csv@g.us', messageId: '=MALICIOUS()' };
const number = '1234567890123';
const alias = number + ':2@c.us';
const opaque = 'US.Ab123Cd';
const sameDigits = 'US.' + number;
let db;
let temp;
let counter = 0;

const select = (...messages) => ({ messages });
const args = scope => [scope.accountId, scope.groupJid, scope.messageId];
const accountA = { authorize: (scope, action) => scope.accountId === message.accountId && (action === 'query' || action === 'export') };
const trusted = {
  ...accountA,
  verifyReadEvidence: row => row.accountId === message.accountId &&
    row.evidenceRef === 'proof-' + row.groupJid + ':' + row.messageId + ':' + row.storedMemberId ?
    { source: 'test-verifier', readAt, verifiedAt } : null,
};

function populate(write) {
  const insertAccount = write.prepare('INSERT INTO ws_accounts(id, display_name, created_at, updated_at) VALUES (?,?,?,?)');
  for (const id of [message.accountId, otherAccount.accountId]) insertAccount.run(id, id, now, now);

  const insertCustomer = write.prepare('INSERT INTO customers(id, name, phone_normalized, deleted, data_json) VALUES (?,?,?,?,?)');
  insertCustomer.run('crm-shared', '客户甲', number, 0, '{}');
  insertCustomer.run('crm-other', '客户乙', '', 0, '{}');
  insertCustomer.run('crm-deleted', '已删除', '', 1, '{}');
  insertCustomer.run('crm-csv', ' \u200b=SUM(1,2)\r\n"文本"', '00123456789', 0, '{}');
  insertCustomer.run('crm-conflict', '待核实', '88888888888', 0, '{}');
  write.prepare('INSERT INTO crm_identity_conflicts(id, canonical_phone, created_at, updated_at) VALUES (?,?,?,?)')
    .run('open-phone-conflict', '88888888888', now, now);

  const insertMessage = write.prepare('INSERT INTO ws_group_messages(id, account_id, group_jid, message_id, sent_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?)');
  for (const scope of [message, nextMessage, otherGroup, otherAccount, empty, large, malicious]) {
    insertMessage.run('message-' + (++counter), ...args(scope), now, now, now);
  }

  const insertRelation = write.prepare(`INSERT INTO customer_group_memberships(
    id, account_id, group_jid, member_jid, customer_id, status, confidence, manual_locked, review_reason, data_json, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const relate = (scope, member, customer, {status = '在群', confidence = 1, locked = 0, review = '', data = '{}'} = {}) => {
    insertRelation.run('rel-' + (++counter), scope.accountId, scope.groupJid, member, customer, status, confidence, locked, review, data, now, now);
  };
  relate(message, number, 'crm-shared');
  relate(message, 'also-same@lid', 'crm-shared', {locked: 1, review: 'manual-lock'});
  relate(message, opaque, 'crm-other');
  relate(message, 'deleted@lid', 'crm-deleted');
  relate(message, 'pending@lid', 'crm-other', {status: '未关联客户'});
  relate(message, 'low-confidence@lid', 'crm-other', {confidence: 0.3});
  relate(message, 'mock@lid', 'crm-other', {data: '{"origin":"stage3-isolated-mock"}'});
  relate(message, 'out-of-order@lid', 'crm-other', {review: 'out-of-order'});
  relate(message, 'conflict@lid', 'crm-conflict');
  relate(message, '99999999999', 'crm-shared');
  relate(message, '99999999999@c.us', 'crm-other');
  relate(otherGroup, 'cross-group@lid', 'crm-shared', {status: '已退群'});
  relate(otherAccount, opaque, 'crm-other');
  relate(malicious, 'csv@lid', 'crm-csv');

  const insertMember = write.prepare('INSERT INTO ws_group_members(id, account_id, group_jid, member_jid, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)');
  for (const [member, status] of [[alias, 'active'], ['no-receipt@lid', 'active'], ['pending@lid', 'unknown'], ['former@lid', 'left'], ['123', 'active']]) {
    insertMember.run('member-' + (++counter), message.accountId, message.groupJid, member, status, now, now);
  }

  const insertEvidence = write.prepare(`INSERT INTO ws_group_read_evidence(
    id, account_id, group_jid, message_id, member_jid, status, evidence_source, evidence_ref, observed_at, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const proof = (scope, member, status, valid = true) => {
    const ref = valid ? 'proof-' + scope.groupJid + ':' + scope.messageId + ':' + member : 'caller-asserted';
    insertEvidence.run('ev-' + (++counter), ...args(scope), member, status, 'untrusted-label', ref, now, now, now);
  };
  proof(message, alias, 'read');
  proof(message, number, 'delivered');
  proof(message, 'also-same@lid', 'read');
  proof(message, opaque, 'read', false);
  proof(message, opaque.toLowerCase(), 'read');
  proof(message, sameDigits, 'read');
  proof(message, 'deleted@lid', 'read');
  proof(message, 'conflict@lid', 'read');
  proof(message, '', 'read');
  proof(message, 'member-' + number, 'read');
  proof(nextMessage, alias, 'delivered');
  proof(otherGroup, 'cross-group@lid', 'read');
  proof(otherAccount, opaque, 'read');
  proof(malicious, 'csv@lid', 'read');
  // Existing 023 does not enforce a message FK.
  proof({ ...message, messageId: 'orphan' }, opaque, 'read');

  write.prepare(`WITH RECURSIVE series(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM series WHERE n < 10001)
    INSERT INTO ws_group_members(id, account_id, group_jid, member_jid, status, created_at, updated_at)
    SELECT 'large-id-' || n, ?, ?, n || '@lid', 'active', ?, ? FROM series`).run(large.accountId, large.groupJid, now, now);
}

before(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-customer-reading-'));
  const filename = path.join(temp, 'reading-fixtures.sqlite');
  const write = new DatabaseSync(filename);
  try {
    const migrationDir = path.join(__dirname, '..', 'resources', 'app', 'migrations');
    runMigrations({ db: write, migrationDir, manifestPath: path.join(migrationDir, 'manifest.json'),
      lockPath: path.join(temp, 'migration.lock'), backup: false });
    assert.equal(write.prepare('PRAGMA user_version').get().user_version, 25);
    populate(write);
  } finally {
    write.close();
  }
  db = new DatabaseSync(filename, {readOnly: true});
});

after(() => {
  db?.close();
  if (temp) fs.rmSync(temp, {recursive: true, force: true});
});

test('explicit authorization is checked for every scope before any database access', () => {
  const untouched = {
    prepare: () => assert.fail('No DB read without authorization'),
    exec: () => assert.fail('No DB operation without authorization'),
  };
  const denied = { code: 'READING_ACCESS_DENIED' };
  assert.throws(() => queryCustomerGroupReading(untouched, select(message)), denied);
  assert.throws(() => queryCustomerGroupReading(untouched, select(message, otherAccount), accountA), denied);
  assert.throws(() => queryCustomerGroupReading(untouched, select(message), {authorize: async () => true}), denied);
  assert.throws(() => queryCustomerGroupReading(untouched, select(message), {authorize: () => Promise.reject(new Error('invalid policy'))}), denied);
  assert.throws(() => exportCustomerGroupReadingCsv(untouched, select(message), {authorize: (_, action) => action === 'query'}), denied);
  assert.throws(() => queryCustomerGroupReading(untouched, select(message, message), accountA), {code: 'READING_SCOPE_INVALID'});
  assert.throws(() => queryCustomerGroupReading(untouched, select({ ...message, messageId: '' }), accountA), {code: 'READING_SCOPE_INVALID'});
  assert.throws(() => queryCustomerGroupReading(db, select({ ...message, messageId: 'orphan' }), accountA),
    {code: 'READING_MESSAGE_UNAVAILABLE'});
  assert.equal(db.isTransaction, false);
});

test('023 read markers, delivered and absent receipts default to Unknown', () => {
  const report = queryCustomerGroupReading(db, select(message), accountA);
  assert.equal(report.coverage.receiptAuthority, 'unavailable');
  assert.equal(report.summary.confirmedReadMessageMemberPairs, 0);
  assert.equal(report.summary.confirmedUnreadMessageMemberPairs, null);
  assert.equal(report.summary.unknownMessageMemberPairs, report.total);
  assert.ok(report.rows.every(row => row.status === 'unknown' && row.readAt === null && row.source === null));
  assert.ok(report.rows.some(row => row.memberId === 'no-receipt@lid'));
  assert.ok(!report.rows.some(row => row.memberId === 'former@lid'));
  assert.equal(report.rows.find(row => row.memberId === sameDigits).memberBasis, 'message-evidence-record');
  assert.equal(report.messages[0].currentRosterObservedMembers + report.messages[0].evidenceOnlyObservedMembers,
    report.messages[0].observedMembers);
  assert.deepEqual(report.messages[0].readRate, {numerator: 0, denominator: null, value: null});
  assert.equal(report.messages[0].invalidEvidenceRows, 2);
  assert.equal(report.messages[0].invalidRosterRows, 1);
  assert.equal(queryCustomerGroupReading(db, {...select(message), status: 'unread'}, accountA).total, 0);
  const noRoster = queryCustomerGroupReading(db, select(empty), accountA);
  assert.equal(noRoster.total, 0);
  assert.equal(noRoster.messages[0].rosterCoverage, 'unavailable');
  assert.equal(noRoster.messages[0].readRate.denominator, null);
});

test('attestation requires exact evidence, reliable identity and independent verification timestamps', () => {
  const report = queryCustomerGroupReading(db, select(message), trusted);
  const byMember = new Map(report.rows.map(row => [row.memberId, row]));
  const row = byMember.get(number);
  assert.equal(byMember.has(alias), false);
  assert.deepEqual([row.customer.id, row.status, row.readAt, row.verifiedAt, row.source],
    ['crm-shared', 'read', readAt, verifiedAt, 'test-verifier']);
  assert.equal(byMember.get('also-same@lid').status, 'read');
  assert.deepEqual([byMember.get(opaque).customer.id, byMember.get(opaque).status], ['crm-other', 'unknown']);
  for (const memberId of [sameDigits, opaque.toLowerCase(), 'deleted@lid', 'pending@lid', 'low-confidence@lid',
    'mock@lid', 'out-of-order@lid', 'conflict@lid', '99999999999']) {
    const rejected = byMember.get(memberId);
    assert.deepEqual([rejected.customer, rejected.status, rejected.readAt], [null, 'unknown', null]);
  }
  assert.equal(report.messages[0].lastVerifiedAt, verifiedAt);
  assert.equal(report.messages[0].confirmedReadMembers, 2);
  assert.deepEqual(report.messages[0].readRate, {numerator: 2, denominator: null, value: null});
  assert.equal(JSON.stringify(report).includes('proof-'), false);
  assert.equal(JSON.stringify(report).includes('untrusted-label'), false);

  for (const evidence of [
    {source: 'fixture', verifiedAt: now, readAt},
    {source: 'fixture', verifiedAt, readAt: '2026-11-17T09:00:00.000Z'},
    {source: 'fixture', verifiedAt, readAt: 'yesterday'},
    {source: 'fixture', verifiedAt: '2027-03-05T10:00:00.000Z', readAt: '2027-02-30T10:00:00.000Z'},
    {source: 'fixture'},
    {readAt, verifiedAt},
  ]) {
    const invalid = queryCustomerGroupReading(db, select(message), {...accountA, verifyReadEvidence: () => evidence});
    assert.equal(invalid.summary.confirmedReadMessageMemberPairs, 0);
  }
  const asyncVerifier = queryCustomerGroupReading(db, select(message), {
    ...accountA, verifyReadEvidence: () => Promise.reject(new Error('invalid verifier')),
  });
  assert.equal(asyncVerifier.summary.confirmedReadMessageMemberPairs, 0);
});

test('account, group and message keys remain independent, with CRM deduplication across groups', () => {
  const report = queryCustomerGroupReading(db, {...select(message, otherGroup, nextMessage), customerId: 'crm-shared'}, trusted);
  assert.equal(report.summary.distinctConfirmedReadCustomers, 1);
  assert.equal(report.summary.confirmedReadMessageMemberPairs, 3);
  assert.equal(report.rows.find(row => row.messageId === nextMessage.messageId && row.memberId === number).status, 'unknown');
  assert.equal(report.rows.find(row => row.groupJid === otherGroup.groupJid).status, 'read');
  assert.equal(report.messages.length, 3);

  const customerOnly = queryCustomerGroupReading(db, {...select(message, otherGroup, nextMessage), view: 'customers', customerId: 'crm-shared'}, trusted);
  assert.equal(customerOnly.total, 1);
  assert.deepEqual(customerOnly.rows[0], {
    customer: {id: 'crm-shared', name: '客户甲', phone: number},
    observedMessages: 3, readMessages: 2, unknownMessages: 1, lastVerifiedAt: verifiedAt,
  });

  const other = queryCustomerGroupReading(db, select(otherAccount), {...trusted, authorize: () => true});
  assert.equal(other.total, 1);
  assert.equal(other.rows[0].accountId, otherAccount.accountId);
  assert.equal(other.rows[0].status, 'unknown');
});

test('overlapping member exclusion aliases count once and apply only to their selected message', () => {
  const report = queryCustomerGroupReading(db, select(
    { ...message, excludedMemberIds: [number, alias, number, 'missing@lid'] },
    nextMessage, otherGroup,
  ), trusted);
  const first = report.messages.find(row => row.messageId === message.messageId && row.groupJid === message.groupJid);
  assert.equal(first.excludedObservedMembers, 1);
  assert.equal(first.observedMembers, first.eligibleObservedMembers + 1);
  assert.equal(report.summary.excludedObservedMessageMemberPairs, 1);
  assert.equal(report.rows.some(row => row.messageId === message.messageId && row.memberId === number), false);
  assert.equal(report.rows.some(row => row.messageId === nextMessage.messageId && row.memberId === number), true);
  assert.equal(report.rows.some(row => row.groupJid === otherGroup.groupJid && row.status === 'read'), true);
  assert.throws(() => queryCustomerGroupReading(db, select({ ...message, excludedMemberIds: ['invalid'] }), trusted),
    {code: 'READING_EXCLUSIONS_INVALID'});
});

test('bounded pagination and CSV share detail filters and escape spreadsheet formula cells', () => {
  const input = {...select(otherGroup, message, malicious), status: 'read'};
  const pageOne = queryCustomerGroupReading(db, {...input, limit: 1}, trusted);
  const pageTwo = queryCustomerGroupReading(db, {...input, offset: pageOne.nextOffset, limit: 20}, trusted);
  assert.equal(pageOne.total, 4);
  assert.equal(pageTwo.nextOffset, null);
  assert.equal(pageTwo.total, pageOne.total);
  const rows = [...pageOne.rows, ...pageTwo.rows];
  assert.equal(new Set(rows.map(row => JSON.stringify([row.groupJid, row.messageId, row.memberId]))).size, 4);
  const report = exportCustomerGroupReadingCsv(db, {...input, limit: 1}, trusted);
  assert.equal(report.rowCount, pageOne.total);
  assert.ok(report.csv.startsWith('\uFEFF"accountId",'));
  assert.ok(report.csv.includes("\"'=MALICIOUS()\""));
  assert.ok(report.csv.includes("\"' \u200b=SUM(1,2)\r\n\"\"文本\"\"\""));
  assert.ok(report.csv.includes("\"'00123456789\""));
  assert.ok(report.csv.includes('"test-verifier"'));
  assert.ok(report.csv.includes(verifiedAt));
  assert.equal(report.csv.includes('no-receipt@lid'), false);
  assert.equal(exportCustomerGroupReadingCsv(db, {...input, search: '客户甲'}, trusted).rowCount, 3);
  assert.equal(exportCustomerGroupReadingCsv(db, {...input, search: '00123456789'}, trusted).rowCount, 1);
  assert.throws(() => queryCustomerGroupReading(db, {...input, limit: 201}, trusted), {code: 'READING_PAGE_INVALID'});
});

test('scope bounds fail explicitly and nested read operations preserve caller transactions', () => {
  assert.throws(() => queryCustomerGroupReading(db, select(large), accountA), {code: 'READING_RANGE_TOO_LARGE'});
  assert.equal(db.isTransaction, false);
  db.exec('BEGIN');
  try {
    const report = queryCustomerGroupReading(db, select(message), accountA);
    assert.ok(report.total > 0);
    assert.equal(db.isTransaction, true);
    assert.throws(() => queryCustomerGroupReading(db, select(message), {...trusted, verifyReadEvidence() { throw new Error('verifier failed'); }}),
      /verifier failed/);
    assert.equal(db.isTransaction, true);
  } finally {
    db.exec('ROLLBACK');
  }
});
