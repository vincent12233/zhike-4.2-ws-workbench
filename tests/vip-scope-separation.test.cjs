'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const scope = require(path.join(root, 'resources', 'app', 'modules', 'ws-scope.js'));

const customers = [
  { id: 'c-vip', vipNumber: 'VIP-001', group: 'g-1', deleted: false },
  { id: 'c-normal', vipNumber: '', group: 'g-2', deleted: false },
  { id: 'c-deleted', vipNumber: 'VIP-002', group: 'g-3', deleted: true },
];

assert.equal(scope.countVipCustomers(customers), 1, 'VIP 管理只统计客户主档中的 VIP 编号');

const bindings = scope.normalizeWsGroupBindings({
  wsGroupAllowlist: [
    { accountId: 'account-1', groupJid: '120@g.us', groupName: '重点群组' },
    { accountId: 'account-2', groupJid: 'other@g.us' },
  ],
  vipCustomers: [{ vipNumber: 'VIP-999', groupJid: 'must-not-leak@g.us' }],
  customers,
}, 'account-1');
assert.deepEqual(bindings.map(item => item.groupJid), ['120@g.us'], '群组监控只读取独立的 WS 群组绑定');
assert.equal(bindings.some(item => item.groupJid === 'must-not-leak@g.us'), false, '客户 VIP 数据不会变成群组监控绑定');

const legacyBindings = scope.normalizeWsGroupBindings({ wsVipGroupAllowlist: ['legacy@g.us'] }, 'default');
assert.deepEqual(legacyBindings.map(item => item.groupJid), ['legacy@g.us'], '旧版 WS 群组绑定仅作为兼容输入');

assert.equal(scope.countVipCustomers([{ id: 'c', vipNumber: '', groupMemberships: [{ groupJid: '120@g.us' }] }]), 0, '群组关系不会生成 VIP 客户');
console.log('VIP scope separation: customer VIP and WS group monitoring remain independent');
