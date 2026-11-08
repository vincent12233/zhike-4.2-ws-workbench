const assert = require('node:assert/strict');
const core = require('../resources/app/modules/customer-governance-core.js');
const wsCore = require('../resources/app/modules/ws-crm-sync-core.js');

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
assert.ok(normalized.evidence.length >= 10);
assert.ok(normalized.evidence.some(item => item.field === 'phone'), '缺少 phone 字段的自动证据');
assert.ok(normalized.evidence.some(item => item.field === 'productInterest'), '缺少 productInterest 字段的自动证据');

const customer = { id: 'C1', name: '人工姓名', phone: '9876543210', origin: '老客户转介绍', age: '', occupation: '', tags: ['VIP'], deleted: false };
const merged = core.mergeAiProfileSafely(customer, normalized);
assert.equal(merged.customer.name, '人工姓名');
assert.equal(merged.customer.origin, '老客户转介绍');
assert.equal(merged.customer.age, 36);
assert.equal(merged.customer.occupation, '采购经理');
assert.ok(merged.changedFields.includes('age'));
assert.ok(merged.changedFields.includes('occupation'));
assert.ok(merged.conflicts.some(item => item.field === 'origin'));
assert.ok(merged.evidenceRows.length >= 10);
assert.ok(merged.customer.aiFieldSources?.age, '缺少 AI 字段来源索引');

const duplicateEvidence = core.mergeAiProfileSafely(merged.customer, normalized);
assert.equal(duplicateEvidence.evidenceRows.length, 0, '同一分析证据不应重复写入');

assert.equal(core.shouldAutoSoftDelete({ confidence: 0.9, deletionSignal: '明确拒绝联系' }), true);
assert.equal(core.shouldAutoSoftDelete({ confidence: 0.84, deletionSignal: '明确拒绝联系' }), false);
assert.equal(core.shouldAutoSoftDelete({ confidence: 0.99, deletionSignal: '客户感兴趣' }), false);

const deletedMatch = wsCore.matchCustomerForAutoSync([
  { id: 'C2', deleted: true, wsExternalId: 'wa-deleted', phone: '9876543212' },
], { wsExternalId: 'wa-deleted' });
assert.equal(deletedMatch.customer.id, 'C2', '已移入回收站的 WS 客户不能再次自动建成重复客户');

const audit = core.buildGovernanceAction('C1', 'update', { age: '' }, { age: 36 }, { analysisId: 'a1', reason: 'AI 补全年龄', confidence: 0.92 });
assert.equal(audit.customerId, 'C1');
assert.equal(audit.action, 'update');
assert.equal(audit.analysisId, 'a1');
assert.equal(audit.confidence, 0.92);

console.log('customer governance core: profile normalization, protected fields, evidence dedupe, soft-delete threshold passed');
const lowFact = core.normalizeAiProfile({ confidence: 0.9, profileFacts: { age: { value: 44, confidence: 0.2, evidence: '我44岁' }, holdings: { value: [], confidence: 0.9, evidence: '' } } }, { id: 'c2' }, 'a2');
assert.equal(lowFact.age, '');
assert.equal(lowFact.investment_years, '');
assert.equal(lowFact.holdings, '');
const conflictCustomer = { preferred_name: '人工称呼' };
const conflict = core.mergeAiProfileSafely(conflictCustomer, { preferred_name: 'AI称呼', evidence: [] });
assert.equal(conflict.customer.preferred_name, '人工称呼');
assert.equal(conflict.conflicts.some(item => item.field === 'preferred_name'), true);
const sensitive = core.normalizeAiProfile({ confidence: 0.9, profileFacts: { family_context: { value: '密码 token-abc', confidence: 0.9, evidence: '密码 token-abc' } } }, { id: 'c3' }, 'a3');
assert.equal(JSON.stringify(sensitive.evidence).includes('token-abc'), false);
const leakProfile = core.normalizeAiProfile({ confidence: 0.9, profileFacts: { family_context: { value: 'password: hunter2 银行卡号 1234 5678', confidence: 0.9, evidence: 'password: hunter2 银行卡号 1234 5678' } } }, { id: 'c4' }, 'a4');
assert.equal(JSON.stringify(leakProfile.evidence).includes('hunter2'), false);
assert.equal(JSON.stringify(leakProfile.evidence).includes('1234'), false);
