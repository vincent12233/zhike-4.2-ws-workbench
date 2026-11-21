'use strict';
// V5.0 §9 identity conflicts and possible duplicates.
const assert = require('node:assert/strict');
const core = require('../resources/app/modules/customer-identity-conflicts-core.js');

const results = [];
function check(name, fn) {
  try { fn(); results.push(true); console.log('PASS ' + name); }
  catch (error) { results.push(false); console.log('FAIL ' + name + ' :: ' + error.message); }
}
const scan = customers => core.scanIdentityConflicts(customers);

check('the same reliable WhatsApp identity on two customers is a conflict', () => {
  const result = scan([
    { id: 'C1', name: 'Ravi', wsExternalId: '919800000001@c.us' },
    { id: 'C2', name: 'Ravi S', wsExternalIds: ['919800000001@c.us'] },
  ]);
  assert.equal(result.identityConflicts.length, 1);
  assert.equal(result.identityConflicts[0].identity, '919800000001@c.us');
  assert.deepEqual(result.identityConflicts[0].customers.map(c => c.id), ['C1', 'C2']);
  assert.equal(result.summary.identityConflicts, 1);
});
check('different identities are not a conflict', () => {
  const result = scan([
    { id: 'C1', wsExternalId: '919800000001@c.us' },
    { id: 'C2', wsExternalId: '919800000002@c.us' },
  ]);
  assert.equal(result.identityConflicts.length, 0);
});
check('a shared phone is flagged as a possible duplicate', () => {
  const result = scan([
    { id: 'C1', phone: '+91 98000 00001' },
    { id: 'C2', rawPhone: '9800000001' },
  ]);
  assert.equal(result.duplicatePhoneGroups.length, 1);
  assert.equal(result.duplicatePhoneGroups[0].phone, '9800000001');
  assert.equal(result.summary.duplicatePhoneGroups, 1);
});
check('a shared name alone is never a duplicate or a conflict', () => {
  const result = scan([
    { id: 'C1', name: 'Ravi', phone: '9800000001' },
    { id: 'C2', name: 'Ravi', phone: '9800000002' },
    { id: 'C3', name: 'Ravi' },
  ]);
  assert.equal(result.duplicatePhoneGroups.length, 0);
  assert.equal(result.identityConflicts.length, 0);
  assert.equal(result.summary.pendingConfirmation, 0);
});
check('a placeholder identity is not evidence', () => {
  const result = scan([
    { id: 'C1', wsExternalId: 'unknown' },
    { id: 'C2', wsExternalId: 'unknown' },
    { id: 'C3', wsExternalId: 'anonymous' },
  ]);
  assert.equal(result.identityConflicts.length, 0);
});
check('a bare phone-like ws id counts, a name-like id does not', () => {
  assert.deepEqual(core.reliableIdentities({ wsExternalId: '919800000001' }), ['919800000001']);
  assert.deepEqual(core.reliableIdentities({ wsExternalId: 'Ravi Kumar' }), []);
  assert.deepEqual(core.reliableIdentities({ wsExternalId: '919800000001@S.WHATSAPP.NET' }), ['919800000001@s.whatsapp.net']);
});
check('deleted customers and repeated ids are ignored', () => {
  const result = scan([
    { id: 'C1', phone: '9800000001' },
    { id: 'C2', phone: '9800000001', deleted: true },
    { id: 'C1', phone: '9800000001' },
  ]);
  assert.equal(result.summary.customers, 1);
  assert.equal(result.duplicatePhoneGroups.length, 0);
});
check('a shared VIP number is reported separately from identity', () => {
  const result = scan([{ id: 'C1', vipNumber: 'v-1' }, { id: 'C2', vipCode: 'V-1' }]);
  assert.equal(result.vipDuplicateGroups.length, 1);
  assert.equal(result.identityConflicts.length, 0);
});
check('a stored number that cannot be standardised is listed for review', () => {
  const result = scan([{ id: 'C1', phone: '123' }, { id: 'C2', phone: '' }, { id: 'C3' }]);
  assert.deepEqual(result.invalid.map(item => item.id), ['C1'], 'a missing number is not an invalid one');
});
check('nothing is merged, deleted or mutated', () => {
  const customers = [{ id: 'C1', phone: '9800000001' }, { id: 'C2', phone: '9800000001' }];
  const before = JSON.stringify(customers);
  scan(customers);
  assert.equal(JSON.stringify(customers), before);
});
check('malformed input never throws', () => {
  for (const customers of [null, undefined, 'x', 5, [null, 3, {}], { length: 2 }]) {
    const result = scan(customers);
    for (const key of ['duplicates', 'vipDuplicates', 'invalid', 'identityConflicts']) assert.ok(Array.isArray(result[key]), key);
  }
});
check('summary counts every pending confirmation type', () => {
  const result = scan([
    { id: 'C1', phone: '9800000001' }, { id: 'C2', phone: '9800000001' },
    { id: 'C3', vipNumber: 'V' }, { id: 'C4', vipNumber: 'V' },
    { id: 'C5', wsExternalId: '919800000009@c.us' }, { id: 'C6', wsExternalId: '919800000009@c.us' },
  ]);
  assert.equal(result.summary.pendingConfirmation, 3);
});

const failed = results.filter(ok => !ok).length;
console.log(`Identity conflicts: ${results.length - failed}/${results.length}`);
if (failed) process.exit(1);
