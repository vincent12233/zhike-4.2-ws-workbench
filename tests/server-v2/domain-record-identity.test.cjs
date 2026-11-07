'use strict';

const assert = require('node:assert/strict');
const domain = require('../../server/reference/domain/domain-compat.cjs');

const buyA = { customerId: 'C1', product: 'AAPL', direction: '买入', buyDate: '2026-01-02' };
const buyB = { customerId: 'C1', product: 'TSLA', direction: '买入', buyDate: '2026-01-02' };
const sellA = { customerId: 'C1', product: 'AAPL', direction: '卖出', sellDate: '2026-02-02' };
assert.notEqual(domain.businessRecordKey(buyA), domain.businessRecordKey(buyB));
assert.notEqual(domain.businessRecordKey(buyA), domain.businessRecordKey(sellA));
assert.equal(domain.expandBusinessRecord({ ...buyA, product: 'AAPL, TSLA' }).length, 2);

assert.equal(domain.normalizePhone('+91 96115 71004'), '919611571004');
assert.equal(domain.resolveIdentity({ wsContactId: 'wa:123', phone: '+8613800000001' }).key, 'ws:wa:123');
assert.equal(domain.resolveIdentity({ phone: '+8613800000001' }).key, 'phone:8613800000001');
assert.equal(domain.resolveIdentity({ accountId: 'acct', sessionId: 'session' }).key, 'account:acct');

const patch = domain.mergeCustomerFields(
  { name: '已有姓名', phone: '8613800000001', country: '' },
  { name: 'AI猜测姓名', country: '印度', age: 31 },
  { onlyFillEmpty: true },
);
assert.deepEqual(patch, { country: '印度', age: 31 });

console.log('domain identity and business record separation pass');
