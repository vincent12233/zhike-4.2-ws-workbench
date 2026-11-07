'use strict';

const assert = require('node:assert/strict');
const domain = require('../../server/reference/domain/domain-compat.cjs');

const headers = ['登记日期', '客户名称', '买卖方向', '股票代码', '下次跟进日期', '渠道', '状态', '号码'];
const rows = [['2026/10/31', '张三', '买入', 'AAPL', '2026-11-10', '微信群', '已进群', '+86 13800000001']];
const classified = domain.classifyImportRows(headers, rows, { context: '混合业务' });
assert.equal(classified.length, 1);
assert.equal(classified[0].recordType, 'ticket');
assert.equal(classified[0].registeredDate, '2026-10-31');
assert.equal(classified[0].nextFollowupDate, '2026-11-10');
assert.equal(classified[0].source, '群粉');
assert.equal(classified[0].status, '已进群');
assert.equal(classified[0].product, 'AAPL');
assert.equal(classified[0].direction, '买入');
assert.equal(classified[0].phone, '8613800000001');

const reordered = domain.classifyImportRows(
  ['股票代码', '号码', '状态', '下次跟进日期', '渠道', '客户名称', '买卖方向', '登记日期'],
  [['TSLA', '8613800000001', '未进', '2026-12-01', '单导', '张三', '卖出', '2026-09-09']],
);
assert.equal(reordered[0].recordType, 'ticket');
assert.equal(reordered[0].registeredDate, '2026-09-09');
assert.equal(reordered[0].nextFollowupDate, '2026-12-01');
assert.equal(reordered[0].source, '单导');
assert.equal(reordered[0].status, '未进群');
assert.equal(reordered[0].direction, '卖出');

const mixed = domain.classifyImportRows([
  '号码', '金额', '币种', '业务日期', '登记日期', '下次跟进日期', '业务类型', '渠道', '状态', '姓名',
], [['8613800000001', '1000', 'USD', '2026-10-01', '2026-09-01', '2026-10-05', '入金', '单导', '已进群', '李四']]);
assert.equal(mixed[0].recordType, 'deposit');
assert.equal(mixed[0].businessDate, '2026-10-01');
assert.equal(mixed[0].registeredDate, '2026-09-01');
assert.equal(mixed[0].nextFollowupDate, '2026-10-05');

console.log('smart mixed import classification and date separation pass');
