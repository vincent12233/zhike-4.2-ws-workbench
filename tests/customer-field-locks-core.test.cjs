'use strict';
// V5.0 §16/§19 manual field locks.
const assert = require('node:assert/strict');
const locks = require('../resources/app/modules/customer-field-locks-core.js');

const results = [];
function check(name, fn) {
  try { fn(); results.push(true); console.log('PASS ' + name); }
  catch (error) { results.push(false); console.log('FAIL ' + name + ' :: ' + error.message); }
}

check('locking a field records it and reports the new state', () => {
  const customer = { id: 'C1' };
  const result = locks.toggleLock(customer, 'occupation');
  assert.equal(result.changed, true);
  assert.equal(result.locked, true);
  assert.deepEqual(customer.manualLockedFields, ['occupation']);
  assert.equal(locks.isLocked(customer, 'occupation'), true);
});
check('toggling again unlocks it', () => {
  const customer = { manualLockedFields: ['occupation', 'name'] };
  const result = locks.toggleLock(customer, 'occupation');
  assert.equal(result.locked, false);
  assert.deepEqual(customer.manualLockedFields, ['name']);
  assert.equal(locks.isLocked(customer, 'occupation'), false);
});
check('unknown fields are ignored and never stored', () => {
  const customer = { id: 'C1' };
  for (const field of ['id', 'wsExternalId', 'groupStatus', 'groupMemberships', '__proto__', 'constructor']) {
    const result = locks.toggleLock(customer, field);
    assert.equal(result.changed, false, field);
    assert.equal(result.locked, false, field);
  }
  assert.deepEqual(locks.normalizeLockedFields(customer), []);
  assert.equal(customer.manualLockedFields, undefined, 'an ignored field never creates a lock list');
});
check('stored locks are normalized and de-duplicated', () => {
  const customer = { manualLockedFields: ['name', 'name', ' occupation ', '', 'nonsense', 'phone'] };
  assert.deepEqual(locks.normalizeLockedFields(customer), ['name', 'occupation', 'phone']);
});
check('the summary lists the human labels', () => {
  const summary = locks.lockSummary({ manualLockedFields: ['name', 'investment_preferences'] });
  assert.equal(summary.count, 2);
  assert.deepEqual(summary.labels, ['姓名', '投资偏好']);
});
check('identity and relationship evidence is deliberately not lockable', () => {
  const keys = locks.LOCKABLE_FIELDS.map(item => item.key);
  for (const forbidden of ['id', 'wsExternalId', 'wsExternalIds', 'groupStatus', 'groupMemberships', 'firstSourceChannel', 'currentChannels']) {
    assert.equal(keys.includes(forbidden), false, forbidden);
  }
});
check('malformed customers never throw', () => {
  for (const customer of [null, undefined, 'x', 5, { manualLockedFields: 'name' }, { manualLockedFields: [null, 3] }]) {
    const summary = locks.lockSummary(customer);
    assert.ok(Array.isArray(summary.fields));
    assert.equal(typeof summary.count, 'number');
    const result = locks.toggleLock(customer, 'name');
    assert.equal(typeof result.changed, 'boolean');
  }
});
check('locking does not touch any other customer field', () => {
  const customer = { id: 'C1', name: 'Ravi', phone: '9800000001', manualLockedFields: ['name'] };
  const before = JSON.stringify(customer);
  locks.toggleLock(customer, 'phone');
  const after = JSON.parse(JSON.stringify(customer));
  assert.equal(after.name, 'Ravi');
  assert.equal(after.phone, '9800000001');
  assert.equal(after.id, 'C1');
  assert.notEqual(JSON.stringify(after), before, 'only the lock list changed');
  assert.deepEqual(after.manualLockedFields.sort(), ['name', 'phone']);
});

const failed = results.filter(ok => !ok).length;
console.log(`Customer field locks: ${results.length - failed}/${results.length}`);
if (failed) process.exit(1);
