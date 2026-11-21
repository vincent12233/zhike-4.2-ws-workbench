'use strict';
// V5.0 §28 dedicated-WS 在群客户 table: columns, stored values and honest blanks.
const assert = require('node:assert/strict');
const pages = require('../resources/app/modules/ws-business-pages.js');

const results = [];
function check(name, fn) {
  try { fn(); results.push(true); console.log('PASS ' + name); }
  catch (error) { results.push(false); console.log('FAIL ' + name + ' :: ' + error.message); }
}
const accountId = 'dedicated-1';
const conversations = [
  { id: 'conv-1', accountId, customerId: 'C1' },
  { id: 'conv-foreign', accountId: 'other', customerId: 'C9' },
];
const full = {
  id: 'C1', name: 'Ravi', phone: '9800000001', firstSourceChannel: '单导K',
  currentChannels: ['单导K', 'FB群粉'], assistant: '小王', phase: '意向客户', qualification: 'A',
  groupStatus: '在群', profileCompleteness: 72, lastFollow: '2026-11-20', due: '2026-11-25',
  groupMemberships: [
    { groupJid: 'a@g.us', groupName: 'A-501群', status: '在群' },
    { groupJid: 'b@g.us', groupName: 'B群', status: '已退群' },
  ],
};

check('rows carry the §28 fields from stored values only', () => {
  const rows = pages.customerRows([full], conversations, accountId);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.firstChannel, '单导K');
  assert.deepEqual(row.currentChannels, ['单导K', 'FB群粉']);
  assert.deepEqual(row.groups, ['A-501群'], 'only currently in-group relations are listed');
  assert.equal(row.groupStatus, '在群');
  assert.equal(row.qualification, 'A');
  assert.equal(row.completeness, 72);
  assert.equal(row.lastChat, '2026-11-20');
  assert.equal(row.nextFollow, '2026-11-25');
});
check('a customer with no links, a deleted record or a foreign account is excluded', () => {
  const rows = pages.customerRows([
    full,
    { id: 'C2', name: 'No Link' },
    { id: 'C9', name: 'Foreign', deleted: true },
    { id: 'C10', name: 'Same Name As Ravi' },
  ], conversations, accountId);
  assert.deepEqual(rows.map(row => row.id), ['C1']);
});
check('a missing account scope returns no rows', () => {
  assert.deepEqual(pages.customerRows([full], conversations, ''), []);
});
check('unknown values stay unknown instead of being invented', () => {
  const row = pages.customerRows([{ id: 'C3', name: 'Bare' }], [{ id: 'c3', accountId, customerId: 'C3' }], accountId)[0];
  assert.equal(row.firstChannel, '');
  assert.deepEqual(row.currentChannels, []);
  assert.deepEqual(row.groups, []);
  assert.equal(row.completeness, null);
  assert.equal(row.nextFollow, '');
});
check('the table renders every §28 column', () => {
  const html = pages.renderCustomers(pages.customerRows([full], conversations, accountId), { page: 1 });
  for (const title of ['客户', '手机号', '首次渠道', '当前渠道', '所在群组', '在群状态', '负责助理', '客户阶段', '资质评级', '资料完整度', '最近聊天', '下次跟进', '操作']) {
    assert.ok(html.includes(`<th>${title}</th>`), title);
  }
});
check('the row shows stored values and a real completeness percentage', () => {
  const html = pages.renderCustomers(pages.customerRows([full], conversations, accountId), { page: 1 });
  for (const value of ['单导K', 'FB群粉', 'A-501群', '在群', '小王', '意向客户', '72%', '2026-11-20', '2026-11-25']) {
    assert.ok(html.includes(value), value);
  }
});
check('missing values render as 未提供 and an unknown completeness as —', () => {
  const rows = pages.customerRows([{ id: 'C3', name: 'Bare' }], [{ id: 'c3', accountId, customerId: 'C3' }], accountId);
  const html = pages.renderCustomers(rows, { page: 1 });
  assert.match(html, /未提供/);
  assert.match(html, /<td class="ws-col-nowrap">—<\/td>/);
});
check('the empty table states it rather than showing fake rows', () => {
  const html = pages.renderCustomers([], { page: 1 });
  assert.match(html, /当前账号没有明确关联的匹配客户/);
  assert.match(html, /colspan="13"/);
});
check('the detail panel repeats the same stored fields', () => {
  const rows = pages.customerRows([full], conversations, accountId);
  const html = pages.renderCustomers(rows, { page: 1, detailId: 'C1' });
  for (const label of ['首次渠道', '当前渠道', '所在群组', '在群状态', '资质评级', '资料完整度', '下次跟进']) {
    assert.ok(html.includes(label), label);
  }
});
check('everything rendered is escaped', () => {
  const row = { id: 'C4', name: '<img src=x>', firstSourceChannel: '<b>', currentChannels: ['<i>'], due: '<script>', groupMemberships: [{ groupJid: 'g@g.us', groupName: '<u>', status: '在群' }] };
  const html = pages.renderCustomers(pages.customerRows([row], [{ id: 'c4', accountId, customerId: 'C4' }], accountId), { page: 1 });
  assert.doesNotMatch(html, /<img src=x>|<script>|<b>|<i>|<u>/);
  assert.match(html, /&lt;b&gt;/);
});

const failed = results.filter(ok => !ok).length;
console.log(`In-group customer table: ${results.length - failed}/${results.length}`);
if (failed) process.exit(1);
