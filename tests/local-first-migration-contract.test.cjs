'use strict';

const assert = require('node:assert/strict');
const { createMigrationPlan, normalizeStatePayload } = require('../resources/app/modules/local-first-migration.js');

const local = normalizeStatePayload({
  customers: [{ id: 'c1', rawPhone: '+91 99999 11111', name: '本机姓名', source: '单导' }],
  tickets: [{ id: 't-buy', customerId: 'c1', product: 'AAA', direction: '买入', buyDate: '2026-01-01' }],
});
const docker = normalizeStatePayload({
  customers: [{ id: 'c1', rawPhone: '919999911111', name: 'Docker姓名', age: 31 }, { id: 'c2', rawPhone: '919999922222', name: '新增客户' }],
  tickets: [{ id: 't-sell', customerId: 'c1', product: 'AAA', direction: '卖出', sellDate: '2026-02-01' }],
});

const plan = createMigrationPlan({ localState: local, dockerState: docker });
assert.equal(plan.customers.length, 2, 'migration keeps new Docker customer without duplicating local customer');
assert.equal(plan.customers.find(row => row.id === 'c1').name, '本机姓名', 'local non-empty profile wins by default');
assert.equal(plan.customers.find(row => row.id === 'c1').age, 31, 'Docker fills an empty local profile field');
assert.equal(plan.tickets.length, 2, 'buy and sell business records remain separate');
assert.equal(plan.conflicts.length, 1, 'conflicting non-empty fields are reported, not overwritten silently');
assert.equal(plan.conflicts[0].field, 'name');
assert.equal(plan.cancelled, false);

const cancelled = createMigrationPlan({ localState: local, dockerState: docker, cancelled: true });
assert.equal(cancelled.cancelled, true);
assert.deepEqual(cancelled.customers, []);
assert.deepEqual(cancelled.tickets, []);

console.log('local-first migration contract: preserves local data, fills empty fields, separates business records and reports conflicts');
