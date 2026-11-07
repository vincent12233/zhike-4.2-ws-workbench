'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'resources', 'app', 'modules', 'smart-import.js'), 'utf8');
const sandbox = { window: {}, console };
vm.runInNewContext(source, sandbox, { filename: 'smart-import.js' });
const api = sandbox.window.ZhikeSmartImport;

assert.equal(api.normalizeSource('单导群组'), '单导');
assert.equal(api.normalizeSource('单导群组数据'), '单导');
assert.equal(api.normalizeSource('私聊群组'), '单导');
assert.equal(api.normalizeSource('群粉群组'), '群粉');
assert.equal(api.normalizeSource('', '单导群组'), '单导');
assert.equal(api.normalizeSource('', '微信群'), '群粉');
assert.equal(api.normalizeSource('', '群组'), '');

const singleGroup = api.parseNaturalLine('张三 9876543210 单导群组 登记日期:2026-11-01');
assert.equal(singleGroup.source, '单导');
assert.equal(singleGroup.registered, '2026-11-01');
const groupFan = api.parseNaturalLine('李四 9876543211 微信群 登记日期:2026-11-01');
assert.equal(groupFan.source, '群粉');

assert.equal(api.date('2026年11月5日'), '2026-11-05');
assert.equal(api.date('20261106'), '2026-11-06');
assert.equal(api.date('2026-11-06 13:20'), '2026-11-06');
assert.equal(api.date('06/11/2026'), '2026-11-06');
assert.equal(api.looksLikePhone('9876543210'), true);
assert.equal(api.looksLikePhone('20261106'), false);

const headers = ['客户姓名', '联系人号码', '投顾来源', '客户状态', '入群时间', '购买股票'];
const rows = [
  ['王五', '9876543212', '单导群组', '已进群', '2026/11/05', 'ABC'],
  ['赵六', '9876543213', '微信群', '未进群', '2026/11/06', 'XYZ'],
];
const inferred = api.inferHeaderMapping(headers, rows);
assert.equal(inferred.name, 0);
assert.equal(inferred.phone, 1);
assert.equal(inferred.source, 2);
assert.equal(inferred.status, 3);
assert.equal(inferred.registered, 4);
assert.equal(inferred.product, 5);

const shifted = [['知客客户导入（请勿修改）'], headers, ...rows];
const detected = api.detectHeaderRow(shifted);
assert.equal(detected.index, 1);
assert.equal(detected.mapping.phone, 1);

const natural = api.parseNaturalLine('客户：周七，WhatsApp：+91 98765 43214，来源=单导群组，登记日期=2026年11月6日，状态=已进群');
assert.equal(natural.phone, '9876543214');
assert.equal(natural.source, '单导');
assert.equal(natural.status, '已进群');
assert.equal(natural.registered, '2026-11-06');

const dateOnly = api.parseNaturalLine('客户：周八，登记日期=2026-11-06，渠道=群粉');
assert.equal(dateOnly.phone, '');
assert.equal(dateOnly.registered, '2026-11-06');
assert.equal(dateOnly.source, '群粉');

const reordered = api.inferHeaderMapping(['登记日期', '客户姓名', '客户状态', '联系人号码', '投顾来源'], [
  ['2026-11-07', '周九', '已进群', '9876543215', '单导群组'],
]);
assert.equal(reordered.registered, 0);
assert.equal(reordered.name, 1);
assert.equal(reordered.status, 2);
assert.equal(reordered.phone, 3);
assert.equal(reordered.source, 4);

const dateLast = api.inferHeaderMapping(['客户姓名', '联系人号码', '投顾来源', '客户状态', '登记日期'], [
  ['周十', '9876543216', '单导群组', '未进群', '2026-11-08'],
]);
assert.equal(dateLast.name, 0);
assert.equal(dateLast.phone, 1);
assert.equal(dateLast.source, 2);
assert.equal(dateLast.status, 3);
assert.equal(dateLast.registered, 4);

const mixedHeaders = ['跟票日期', '金额', '客户号码', '股票代码', '方向', '记录类型', '下次跟进'];
const mixedRows = [['2026-11-09', '', '9876543219', 'AAPL', '买入', '跟票', '2026-11-12'], ['2026-11-10', '1500', '9876543220', '', '', '入金', '2026-11-15']];
const mixedMapping = api.inferHeaderMapping(mixedHeaders, mixedRows);
assert.equal(mixedMapping.followDate, 0);
assert.equal(mixedMapping.amount, 1);
assert.equal(mixedMapping.product, 3);
assert.equal(mixedMapping.direction, 4);
assert.equal(api.inferRecordType({ recordType: '跟票', product: 'AAPL', direction: '买入', amount: '' }), 'ticket');
assert.equal(api.inferRecordType({ recordType: '入金', product: '', direction: '', amount: '1500' }), 'deposit');
const customerInterestMapping = api.inferHeaderMapping(['客户姓名', '联系人号码', '产品兴趣', '登记日期'], [
  ['李四', '9876543221', 'AAPL、ETF', '2026-11-12'],
]);
assert.equal(customerInterestMapping.product, undefined, '产品兴趣不应被识别为跟票股票代码');
assert.equal(api.inferRecordType({ recordType: '', product: '', direction: '', amount: '' }), 'customer');
assert.equal(api.date('2026年11月12日'), '2026-11-12');

const unorderedNatural = api.parseNaturalLine('06/11/2026 单导 已进群 周十一 9876543217');
assert.equal(unorderedNatural.registered, '2026-11-06');
assert.equal(unorderedNatural.phone, '9876543217');
assert.equal(unorderedNatural.name, '周十一');
assert.equal(unorderedNatural.source, '单导');
assert.equal(unorderedNatural.status, '已进群');
assert.equal(unorderedNatural.dateOrigin, '识别');

const dateAtEnd = api.parseNaturalLine('9876543218 周十二 群粉 未进群 2026.11.07');
assert.equal(dateAtEnd.registered, '2026-11-07');
assert.equal(dateAtEnd.phone, '9876543218');

const vipNatural = api.parseNaturalLine('VIP编号:VIP-001 周十三 9876543222 单导 登记日期:2026-11-08');
assert.equal(vipNatural.vipNumber, 'VIP-001');
assert.equal(vipNatural.phone, '9876543222');

const vipHeaders = api.inferHeaderMapping(['客户姓名', 'VIP编号', '手机号码', '登记日期'], [
  ['周十三', 'VIP-001', '9876543222', '2026-11-08'],
]);
assert.equal(vipHeaders.vipNumber, 1);

const tradeDates = api.inferHeaderMapping(['客户号码', '股票代码', '方向', '买入日期', '卖出日期'], [
  ['9876543219', 'AAPL', '买入', '2026-11-01', ''],
]);
assert.equal(tradeDates.buyDate, 3);
assert.equal(tradeDates.sellDate, 4);

console.log('smart import classification: explicit single-group and group-fan sources normalize correctly');
