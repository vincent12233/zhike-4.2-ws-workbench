'use strict';
// V5.0 §16 CRM fill rules for ordinary WS AI results, against the real merge
// code used by /api/ws/crm-sync (ws-crm-sync-core then customer-governance).
const assert = require('node:assert/strict');
const gov = require('../resources/app/modules/customer-governance-core.js');
const sync = require('../resources/app/modules/ws-crm-sync-core.js');

const results = [];
function check(name, fn) {
  try { fn(); results.push(true); console.log('PASS ' + name); }
  catch (error) { results.push(false); console.log('FAIL ' + name + ' :: ' + error.message); }
}
function profileFor(analysis) {
  const ref = { id: 'conv1', externalId: '919800000001@c.us', title: '+91 98000 00001', customerId: '', analysisId: analysis.analysisId };
  const derived = sync.deriveCustomerProfile(analysis, ref, 'acc');
  const normalized = gov.normalizeAiProfile(analysis, ref, 'acc');
  return { ...derived, ...Object.fromEntries(Object.entries(normalized).filter(([, v]) => v !== '' && v != null && (!Array.isArray(v) || v.length))) };
}
// Same order as the server: ws-crm-sync merge, then governance merge.
function merge(customer, profile) {
  const copy = JSON.parse(JSON.stringify(customer));
  sync.mergeCustomerProfileSafely(copy, profile);
  const result = gov.mergeAiProfileSafely(copy, profile);
  return { customer: copy, ...result };
}
const analysis = {
  confidence: 0.9, analysisId: 'A1', summary: '客户是工程师，想了解科技股。',
  contact: { occupation: '工程师' },
  profileFacts: { occupation: { value: '工程师', evidence: '我是工程师', confidence: 0.9 } },
};
const inGroup = {
  id: 'C1', name: 'Ravi', phone: '9800000001', source: '单导K', channel: '单导K', assistant: '小王',
  firstSourceChannel: '单导K', currentChannels: ['单导K'], groupStatus: '在群', status: '在群', autoRegistered: true,
  groupMemberships: [{ accountId: 'd', groupJid: 'g1@g.us', status: '在群' }],
};

check('an in-group customer is filled without a false channel/owner conflict', () => {
  const { customer, conflicts } = merge(inGroup, profileFor(analysis));
  assert.deepEqual(conflicts, []);
  assert.equal(customer.occupation, '工程师');
});
check('AI never overwrites the group channel, owner, membership or in-group status', () => {
  const { customer } = merge(inGroup, profileFor(analysis));
  for (const key of ['source', 'channel', 'assistant', 'firstSourceChannel', 'groupStatus', 'status']) assert.deepEqual(customer[key], inGroup[key], key);
  assert.deepEqual(customer.currentChannels, ['单导K']);
  assert.deepEqual(customer.groupMemberships, inGroup.groupMemberships);
});
check('AI never fills an empty channel or owner with a placeholder', () => {
  const { customer } = merge({ id: 'C2', name: 'Asha', phone: '9800000002', source: '', channel: '', assistant: '' }, profileFor(analysis));
  assert.equal(customer.source, '');
  assert.equal(customer.channel, '');
  assert.equal(customer.assistant, '');
  assert.equal(customer.occupation, '工程师', 'real facts are still filled');
});
check('an existing value that differs is a conflict, not an overwrite', () => {
  const { customer, conflicts } = merge({ ...inGroup, occupation: '医生' }, profileFor(analysis));
  assert.equal(customer.occupation, '医生');
  assert.ok(conflicts.some(item => item.field === 'occupation'));
});
check('a manually locked field is never changed', () => {
  const { customer, conflicts } = merge({ ...inGroup, occupation: '', manualLockedFields: ['occupation'] }, profileFor(analysis));
  assert.equal(customer.occupation, '');
  assert.ok(conflicts.some(item => item.field === 'occupation' && item.locked));
});
check('re-running the same analysis changes nothing the second time', () => {
  const first = merge(inGroup, profileFor(analysis));
  const second = merge(first.customer, profileFor(analysis));
  assert.deepEqual(second.conflicts, []);
  assert.equal(second.customer.occupation, '工程师');
  assert.equal(second.evidenceRows.length, 0, 'evidence is not duplicated');
});

const dynamicAnalysis = (id, intent, summary) => ({ confidence: 0.9, analysisId: id, summary, intent, contact: { intent }, profile: { summary } });
const withTime = (profile, sourceMessageAt) => ({ ...profile, sourceMessageAt, model: 'test-model' });
check('a newer analysis updates AI-managed fields and records message time and model', () => {
  const first = merge(inGroup, withTime(profileFor(dynamicAnalysis('T1', '观望', '客户在观望')), '2026-11-20T10:00:00.000Z'));
  assert.equal(first.customer.intent, '观望');
  const second = merge(first.customer, withTime(profileFor(dynamicAnalysis('T2', '有意向', '客户表示有意向')), '2026-11-21T10:00:00.000Z'));
  assert.equal(second.customer.intent, '有意向');
  assert.equal(second.customer.aiProfile.sourceMessageAt, '2026-11-21T10:00:00.000Z');
});
check('an analysis of older messages never overwrites values from newer messages', () => {
  const newer = merge(inGroup, withTime(profileFor(dynamicAnalysis('N1', '有意向', '客户表示有意向')), '2026-11-21T10:00:00.000Z'));
  const older = merge(newer.customer, withTime(profileFor(dynamicAnalysis('O1', '观望', '客户在观望')), '2026-11-19T10:00:00.000Z'));
  assert.equal(older.customer.intent, '有意向', 'older messages analysed later do not win');
  assert.ok(older.staleFields.includes('intent'));
  assert.deepEqual(older.conflicts, [], 'stale is not a conflict');
  assert.equal(older.customer.aiProfile.intent, '有意向', 'the AI snapshot is not rolled back either');
  assert.equal(older.customer.aiProfile.sourceMessageAt, '2026-11-21T10:00:00.000Z', 'the recorded message time never moves backwards');
});
check('an unknown message time does not block an update', () => {
  const newer = merge(inGroup, withTime(profileFor(dynamicAnalysis('K1', '有意向', 'a')), '2026-11-21T10:00:00.000Z'));
  const unknown = merge(newer.customer, withTime(profileFor(dynamicAnalysis('K2', '强烈意向', 'b')), ''));
  assert.equal(unknown.customer.intent, '强烈意向');
});
check('field sources record message time, model and account', () => {
  const { customer } = merge(inGroup, withTime(profileFor(analysis), '2026-11-21T09:00:00.000Z'));
  const source = customer.aiFieldSources.occupation;
  assert.equal(source.messageAt, '2026-11-21T09:00:00.000Z');
  assert.equal(source.model, 'test-model');
  assert.equal(source.accountId, 'acc');
  assert.ok(source.updatedAt, 'analysis time is kept separately');
});

const failed = results.filter(ok => !ok).length;
console.log(`WS AI CRM fill rules: ${results.length - failed}/${results.length}`);
if (failed) process.exit(1);
