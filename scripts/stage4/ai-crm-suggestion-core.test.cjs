'use strict';
const assert = require('node:assert/strict');
const core = require('../../resources/app/modules/ai-crm-suggestion-core.js');

const customer = { id: 'C1', name: '张三', occupation: '', manualLockedFields: [], aiLockedFields: [] };
const candidate = core.validateCandidate({ customerId: 'C1', fieldName: 'occupation', candidateValue: '工程师', sourceEvidence: '我是一名工程师', confidence: 0.91 });
const preview = core.preview(customer, candidate);
assert.equal(preview.decision, 'approved');
assert.equal(preview.existingValue, '');
const applied = core.approve(customer, candidate);
assert.equal(applied.applied, true);
assert.equal(applied.customer.occupation, '工程师');
assert.equal(customer.occupation, '', 'preview/approve must not mutate source customer');
const locked = core.preview({ ...customer, manualLockedFields: ['occupation'] }, candidate);
assert.equal(locked.decision, 'conflict');
const occupied = core.preview({ ...customer, occupation: '医生' }, candidate);
assert.equal(occupied.decision, 'conflict');
assert.equal(core.reject(candidate, '不确定').verificationStatus, 'rejected');
assert.throws(() => core.validateCandidate({ customerId: '', fieldName: 'occupation', candidateValue: 'x', sourceEvidence: 'x' }), /客户/);
assert.throws(() => core.validateCandidate({ customerId: 'C1', fieldName: 'occupation', candidateValue: 'x' }), /证据/);
const rows = core.buildCandidates({
  confidence: 0.88,
  profileFacts: { occupation: { value: '工程师', evidence: '我是一名工程师', confidence: 0.88 } },
  evidence: [{ field: 'budget', value: '10000', text: '预算一万' }],
}, { customerId: 'C1' });
assert.equal(rows.length, 2);
assert.equal(rows[0].fieldName, 'occupation');
assert.equal(rows[1].fieldName, 'budget');
console.log('ai crm suggestion core: PASS');
