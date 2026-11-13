'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'resources', 'app', 'modules', 'smart-import.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'resources', 'app', 'app.js'), 'utf8');
const sandbox = { window: {}, console };
vm.runInNewContext(source, sandbox, { filename: 'smart-import.js' });
const api = sandbox.window.ZhikeSmartImport;

// Unknown or ambiguous channel evidence must remain reviewable instead of
// silently falling back to the generic single-lead channel.
assert.equal(typeof api.resolveImportSource, 'function', 'smart import exposes a channel review resolver');
const unresolvedSource = api.resolveImportSource({}, '', '', '', {});
assert.equal(unresolvedSource.source, '');
assert.equal(unresolvedSource.needsReview, true);
assert.equal(unresolvedSource.reason, 'missing');
const ambiguousSource = api.resolveImportSource({
  source: '群粉',
  sourceConfidence: 0.55,
  sourceCandidates: ['群粉', 'WhatsApp群粉'],
  sourceAmbiguous: true,
}, '', '', '', {});
assert.equal(ambiguousSource.needsReview, true);
assert.equal(ambiguousSource.reason, 'ambiguous');
const explicitSource = api.resolveImportSource({ source: 'Facebook广告', sourceConfidence: 1 }, 'Facebook广告', '', '', {});
assert.equal(explicitSource.source, 'Facebook广告');
assert.equal(explicitSource.needsReview, false);
// A user-selected fallback is explicit: only a truly missing channel may use
// it.  The importer must never silently choose the generic single-lead bucket.
const configuredDefault = api.resolveImportSource({}, '', '', '', {
  groupFanSources: ['群粉', 'WhatsApp群粉'],
  sources: ['单导', 'Facebook广告'],
}, 'WhatsApp群粉');
assert.equal(configuredDefault.source, 'WhatsApp群粉');
assert.equal(configuredDefault.defaultApplied, true);
assert.equal(configuredDefault.needsReview, false);
const configuredCustomDefault = api.resolveImportSource({}, '', '', '', {
  groupFanSources: ['群粉'],
  sources: ['单导', 'Facebook广告'],
}, 'Facebook广告');
assert.equal(configuredCustomDefault.source, 'Facebook广告', '显式选择的自定义渠道不能被“广告”关键词折叠为单导');
assert.equal(configuredCustomDefault.defaultApplied, true);
const lowConfidenceWithDefault = api.resolveImportSource({
  source: '群粉',
  sourceConfidence: 0.5,
  sourceCandidates: ['群粉'],
}, '', '', '', {
  groupFanSources: ['群粉', 'WhatsApp群粉'],
}, 'WhatsApp群粉');
assert.equal(lowConfidenceWithDefault.source, '群粉');
assert.equal(lowConfidenceWithDefault.defaultApplied, false);
assert.equal(lowConfidenceWithDefault.needsReview, true, '显式默认值不得覆盖低置信度候选');
assert.match(appSource, /resolveImportSource\?\.\(rowRoute,raw\.source/);
assert.doesNotMatch(appSource, /sourceFallback=rowRoute\.source\|\|fileSource\|\|window\.ZhikeSmartImport\?\.sourceSignal\?\.\(raw\.page\)\|\|\(\/群粉\//, 'unknown channel rows must not silently default to single lead');
assert.match(appSource, /channelCandidates:sourceReview\.candidates/);
assert.match(appSource, /channelReview=\/\^渠道无法\//);
assert.match(appSource, /channelReview&&!values\.source/);
assert.match(appSource, /data-csv-default-source/, '导入预览必须提供显式的未识别渠道处理选择');
assert.match(appSource, /defaultSource/, '显式渠道默认值必须从预览传入提交流程');
assert.match(appSource, /不会自动默认为单导/, '界面必须明确告知未知渠道不会静默归入单导');

const customerHeaders = ['客户姓名', '手机号码', '渠道', '状态', '登记日期', '跟票', '入金', '产品兴趣'];
const customerRows = Array.from({ length: 163 }, (_, index) => [
  `客户${index + 1}`,
  `98765${String(index + 1).padStart(5, '0')}`,
  '单导',
  '未进群',
  '2026-11-01',
  '否',
  '否',
  'AAPL、ETF',
]);
const customerMapping = api.inferHeaderMapping(customerHeaders, customerRows.slice(0, 5));
assert.equal(api.inferImportMode(customerHeaders, customerRows, customerMapping, 'mixed'), 'customer', '客户中心导出即使带跟票/入金派生列也应保持客户模式');
const customerTypes = customerRows.map((row) => api.classifyImportRow({
  name: row[0],
  phone: row[1],
  source: row[2],
  status: row[3],
  registered: row[4],
  ticketFlag: row[5],
  depositFlag: row[6],
  productInterest: row[7],
}, { target: 'customer' }).type);
assert.equal(customerTypes.length, 163);
assert.equal(customerTypes.filter((type) => type === 'ticket').length, 0, '客户-only 批次不得生成跟票');
assert.equal(customerTypes.filter((type) => type === 'deposit').length, 0, '客户-only 批次不得生成入金');
const customerSummary = api.summarizeImportBatch({
  headers: customerHeaders,
  rows: [customerHeaders, ...customerRows],
  mapping: customerMapping,
});
assert.equal(customerSummary.mode, 'customer');
assert.equal(customerSummary.customerRows, 163);
assert.equal(customerSummary.ticketRows, 0);
assert.equal(customerSummary.depositRows, 0);

const existingCustomer = {
  id: 'C-existing',
  name: '已有姓名',
  phone: '9876543210',
  source: '单导',
  occupation: '',
  country: '',
  registered: '2026-10-01',
  ticket: false,
  deposit: false,
  amount: 0,
};
const mergeResult = api.mergeCustomerFields(existingCustomer, {
  name: '新文件姓名',
  phone: '9876543210',
  source: '群粉',
  occupation: '工程师',
  country: '印度',
  registered: '2026-11-02',
  ticket: true,
  amount: 1200,
});
assert.notEqual(existingCustomer.touched, true, 'automatic import enrichment must not masquerade as a manual edit');
assert.ok(existingCustomer.importUpdatedAt, 'automatic import enrichment records its own update timestamp');
assert.deepEqual(Array.from(mergeResult.changedFields).sort(), ['amount', 'country', 'occupation', 'ticket'].sort(), '已有客户只补空字段并追加业务事实，不覆盖姓名、渠道和历史登记日期');
assert.equal(existingCustomer.name, '已有姓名');
assert.equal(existingCustomer.source, '单导');
assert.equal(existingCustomer.registered, '2026-10-01');
assert.equal(existingCustomer.occupation, '工程师');
assert.equal(existingCustomer.ticket, true);
assert.equal(existingCustomer.amount, 1200);

const duplicateImportBatch = {
  headers: customerHeaders,
  rows: [customerHeaders, customerRows[0], customerRows[0]],
  mapping: customerMapping,
};
assert.equal(api.summarizeImportBatch(duplicateImportBatch).mode, 'customer');
assert.equal(api.shouldWriteBusinessRow(customerRows[0], customerMapping, 'customer', customerHeaders), false, '重复客户资料行仍不能生成业务明细');

const ticketHeaders = ['客户号码', '股票代码', '买卖方向', '买入日期'];
const ticketRows = [['9876543210', 'AAPL', '买入', '2026-11-01']];
const ticketMapping = api.inferHeaderMapping(ticketHeaders, ticketRows);
assert.notEqual(api.inferImportMode(ticketHeaders, ticketRows, ticketMapping), 'customer', '带真实股票业务字段的文件应进入业务分流模式');
assert.equal(api.classifyImportRow({ phone: '9876543210', product: 'AAPL', direction: '买入', buyDate: '2026-11-01' }, { target: 'mixed' }).type, 'ticket');
assert.equal(api.inferImportMode(ticketHeaders, ticketRows, { ...ticketMapping, recordTypeHint: 'customer' }), 'ticket', 'AI 错误的 customer 提示不得覆盖真实股票业务字段');

const depositHeaders = ['客户号码', '入金金额', '币种', '入金日期'];
const depositRows = [['9876543210', '1500', 'INR', '2026-11-02']];
const depositMapping = api.inferHeaderMapping(depositHeaders, depositRows);
assert.notEqual(api.inferImportMode(depositHeaders, depositRows, depositMapping), 'customer', '带真实金额业务字段的文件应进入业务分流模式');
assert.equal(api.classifyImportRow({ phone: '9876543210', amount: '1500', currency: 'INR', followDate: '2026-11-02' }, { target: 'mixed' }).type, 'deposit');

console.log('customer import routing: 163 customer rows stay customer-only while explicit business rows remain routable');
