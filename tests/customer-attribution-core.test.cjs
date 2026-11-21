'use strict';
// V5.0 §12 / §19 customer 360 channel attribution and in-group evidence.
const assert = require('node:assert/strict');
const core = require('../resources/app/modules/customer-attribution-core.js');

const results = [];
function check(name, fn) {
  try { fn(); results.push(true); console.log('PASS ' + name); }
  catch (error) { results.push(false); console.log('FAIL ' + name + ' :: ' + error.message); }
}
const field = (customer, label) => Object.fromEntries(core.attributionFields(customer))[label];
const rel = (groupJid, status, groupName = '') => ({ groupJid, status, groupName });

check('every label is present and missing data says 未记录', () => {
  const fields = Object.fromEntries(core.attributionFields({ id: 'C1' }));
  for (const label of ['首次来源渠道', '首次来源群组', '当前渠道', '历史渠道', '在群状态', '群组证据', '当前所在群组', '来源账号', '负责助理']) {
    assert.ok(Object.hasOwn(fields, label), label);
  }
  assert.equal(fields['首次来源渠道'], '未记录');
  assert.equal(fields['当前渠道'], '未记录');
  assert.equal(fields['在群状态'], '待确认');
  assert.equal(fields['负责助理'], '未分配');
});
check('stored channels are deduplicated and keep their stored order', () => {
  const customer = { firstSourceChannel: '单导K', currentChannels: ['FB群粉', '单导K', 'FB群粉'], channelHistory: ['单导K'] };
  assert.equal(field(customer, '首次来源渠道'), '单导K');
  assert.equal(field(customer, '当前渠道'), 'FB群粉、单导K', 'stored order, duplicates removed');
  assert.equal(field(customer, '历史渠道'), '单导K');
});
check('a generic label is not presented as a business channel', () => {
  assert.equal(field({ firstSourceChannel: 'WhatsApp' }, '首次来源渠道'), '未记录');
  assert.equal(field({ currentChannels: ['未分配'] }, '当前渠道'), '未记录');
});
check('in-group state needs reliable evidence', () => {
  assert.equal(core.overallGroupState({ id: 'C1' }), '待确认');
  assert.equal(core.overallGroupState({ id: 'C1', groupStatus: '状态未知' }), '待确认');
  assert.equal(core.overallGroupState({ id: 'C1', groupStatus: '已退群', groupMemberships: [rel('a@g.us', '状态未知')] }), '待确认');
  assert.equal(core.overallGroupState({ id: 'C1', groupMemberships: [rel('a@g.us', '在群')] }), '在群');
  assert.equal(core.overallGroupState({ id: 'C1', groupMemberships: [rel('a@g.us', '已退群'), rel('b@g.us', '被移除')] }), '已退群');
});
check('group evidence counts confirmed, left and pending relations separately', () => {
  const customer = { groupMemberships: [rel('a@g.us', '在群', 'A-501群'), rel('b@g.us', '已退群', 'F-550群'), rel('c@g.us', '状态未知')] };
  assert.equal(field(customer, '群组证据'), '1 个群组在群 · 1 个已确认退群 · 1 个待确认');
  assert.equal(field(customer, '当前所在群组'), 'A-501群');
});
check('the first source group is shown by code, falling back to JID', () => {
  assert.equal(field({ firstSourceGroupCode: 'A-501', firstSourceGroupJid: 'a@g.us' }, '首次来源群组'), 'A-501');
  assert.equal(field({ firstSourceGroupJid: 'a@g.us' }, '首次来源群组'), 'a@g.us');
});
check('the owner falls back to 未分配 only when genuinely unassigned', () => {
  assert.equal(field({ assistant: '小王' }, '负责助理'), '小王');
  assert.equal(field({ assistant: '未分配' }, '负责助理'), '未分配');
  assert.equal(field({ assistant: 'WhatApp' }, '负责助理'), 'WhatApp', 'an odd but stored name is not erased');
});
check('malformed input never throws and still returns every label', () => {
  for (const customer of [null, undefined, 'x', 5, { groupMemberships: 'oops' }, { groupMemberships: [null, 3] }, { currentChannels: '单导K' }]) {
    const fields = core.attributionFields(customer);
    assert.equal(fields.length, 9);
    assert.ok(fields.every(([label, value]) => typeof label === 'string' && typeof value === 'string'));
  }
});
check('a single string channel is accepted like a list', () => {
  assert.equal(field({ currentChannels: '单导K' }, '当前渠道'), '单导K');
});

const failed = results.filter(ok => !ok).length;
console.log(`Customer attribution: ${results.length - failed}/${results.length}`);
if (failed) process.exit(1);
