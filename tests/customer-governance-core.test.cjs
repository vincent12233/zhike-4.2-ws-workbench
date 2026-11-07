const assert = require('node:assert/strict');
const core = require('../resources/app/modules/customer-governance-core.js');

const analysis = {
  confidence: 0.92,
  contact: { name: '张三', phone: '+91 98765 43210', country: '印度', language: '中文' },
  profile: { origin: '展会名片', age: 36, occupation: '采购经理', productInterest: ['AAPL'], budget: '10000 INR' },
  summary: '客户来自展会，希望了解 AAPL。',
  evidence: [
    { field: 'origin', value: '展会名片', text: '我在展会上拿到你的名片' },
    { field: 'age', value: 36, text: '我今年 36 岁' },
    { field: 'occupation', value: '采购经理', text: '我的工作是采购经理' },
  ],
};

const normalized = core.normalizeAiProfile(analysis, { id: 'conv-1', externalId: 'wa-1', title: '张三' }, 'a1');
assert.equal(normalized.name, '张三');
assert.equal(normalized.phone, '9876543210');
assert.equal(normalized.origin, '展会名片');
assert.equal(normalized.age, 36);
assert.equal(normalized.occupation, '采购经理');
assert.equal(normalized.source, 'WhatsApp');
assert.equal(normalized.evidence.length, 4);

const customer = { id: 'C1', name: '人工姓名', phone: '9876543210', origin: '老客户转介绍', age: '', occupation: '', tags: ['VIP'], deleted: false };
const merged = core.mergeAiProfileSafely(customer, normalized);
assert.equal(merged.customer.name, '人工姓名');
assert.equal(merged.customer.origin, '老客户转介绍');
assert.equal(merged.customer.age, 36);
assert.equal(merged.customer.occupation, '采购经理');
assert.ok(merged.changedFields.includes('age'));
assert.ok(merged.changedFields.includes('occupation'));
assert.ok(merged.conflicts.some(item => item.field === 'origin'));
assert.equal(merged.evidenceRows.length, 4);

const duplicateEvidence = core.mergeAiProfileSafely(merged.customer, normalized);
assert.equal(duplicateEvidence.evidenceRows.length, 0, '同一分析证据不应重复写入');

assert.equal(core.shouldAutoSoftDelete({ confidence: 0.9, deletionSignal: '明确拒绝联系' }), true);
assert.equal(core.shouldAutoSoftDelete({ confidence: 0.84, deletionSignal: '明确拒绝联系' }), false);
assert.equal(core.shouldAutoSoftDelete({ confidence: 0.99, deletionSignal: '客户感兴趣' }), false);

const audit = core.buildGovernanceAction('C1', 'update', { age: '' }, { age: 36 }, { analysisId: 'a1', reason: 'AI 补全年龄', confidence: 0.92 });
assert.equal(audit.customerId, 'C1');
assert.equal(audit.action, 'update');
assert.equal(audit.analysisId, 'a1');
assert.equal(audit.confidence, 0.92);

console.log('customer governance core: profile normalization, protected fields, evidence dedupe, soft-delete threshold passed');
