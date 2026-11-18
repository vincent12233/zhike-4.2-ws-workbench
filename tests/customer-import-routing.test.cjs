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

// Exercise the actual submit handler with an existing, isolated customer.
// A rejected spreadsheet row must not leak into the independent ticket ledger
// during the handler's second pass, while a valid row in the same file does.
async function testRejectedBusinessRowsStayRejected() {
  const start = appSource.indexOf('  async function commitCsvImport(){');
  const end = appSource.indexOf('\n  function exportImportIssues()', start);
  assert.ok(start >= 0 && end > start, 'locate the production import handler');
  const customer = { id: 'C-isolated', name: '隔离客户', phone: '9876543210', rawPhone: '9876543210', source: '单导', channel: '单导', assistant: '未分配', group: '—', registered: '2026-11-01', deleted: false };
  const dateSource = appSource.match(/^  const isValidDateKey=.*$/m)?.[0];
  const normalizeDateSource = appSource.match(/^  function normalizeImportedDate\(value\).*$/m)?.[0];
  assert.ok(dateSource && normalizeDateSource, 'locate the production date normalizer');
  const dateSandbox = { Date };
  vm.runInNewContext(`${dateSource}\n${normalizeDateSource}\nthis.toDate=normalizeImportedDate;`, dateSandbox);
  const toDate = dateSandbox.toDate;
  assert.equal(toDate('2026-02-30'), '', 'a nonexistent calendar date must not roll into March');
  assert.equal(toDate('2026-02-30 10:00'), '', 'invalid date with a space-separated time stays rejected');
  assert.equal(toDate('2026/02/30 10:00'), '', 'invalid slash date with time stays rejected');
  assert.equal(toDate('2026-02-30T10:00:00'), '', 'invalid ISO date with time stays rejected');
  assert.equal(toDate('31/02/2026'), '', 'an impossible legacy day/month date stays rejected');
  assert.equal(toDate('2026-11-13'), '2026-11-13');
  assert.equal(toDate('2026-11-13 10:00'), '2026-11-13', 'valid local date-time remains supported');
  assert.equal(toDate('2026年11月6日'), '2026-11-06', 'Chinese calendar format remains supported');
  assert.equal(toDate('13/11/2026'), '2026-11-13', 'legacy day/month/year remains supported');
  assert.equal(toDate('20261106'), '2026-11-06', 'compact export date remains supported');
  assert.match(toDate('46332'), /^\d{4}-\d{2}-\d{2}$/, 'Excel serial date remains supported');
  assert.equal(toDate('46332.5'), toDate('46332'), 'Excel date-time serial uses its calendar day');
  assert.equal(toDate('2958466'), '', 'Excel serial beyond the supported range is rejected');
  assert.equal(toDate('2958465.5'), '', 'fractional Excel serial beyond the supported range is rejected');
  const headers = ['客户号码', '记录类型', '股票代码', '买卖方向', '登记日期', '业务日期', '渠道'];
  const mapping = api.inferHeaderMapping(headers, [
    ['9876543210', '跟票', 'AAPL', '买入', '2026-02-30', '2026-11-13', '单导'],
    ['9876543210', '跟票', 'NVDA', '买入', '2026-11-12', '2026-02-30', '单导'],
    ['9876543210', '跟票', 'MSFT', '买入', '2026-11-13', '2026-11-13', '单导'],
  ]);
  const batch = { headers, mapping, rows: [headers,
    ['9876543210', '跟票', 'AAPL', '买入', '2026-02-30', '2026-11-13', '单导'],
    ['9876543210', '跟票', 'NVDA', '买入', '2026-11-12', '2026-02-30', '单导'],
    ['9876543210', '跟票', 'MSFT', '买入', '2026-11-13', '2026-11-13', '单导'],
  ], filename: '隔离跟票.csv' };
  const state = { settings: { importProfiles: [] }, customers: [customer], tickets: [], deposits: [], registrations: [], followups: [], importIssues: [], batchOperations: [], activities: [], pendingCsv: batch };
  const messages = [];
  const sandbox = {
    window: { ZhikeSmartImport: { ...api, rememberMappingProfile: null } },
    state, structuredClone, console, setTimeout,
    sources: ['单导'], groupFanSources: ['群粉'], statuses: ['未进群', '在群'], qualifications: [],
    csvFields: ['name', 'phone', 'source', 'status', 'registered', 'recordType', 'product', 'direction', 'amount', 'currency', 'followDate', 'buyDate', 'sellDate', 'nextFollow', 'businessNote'].map(key => [key, key]),
    knownIntakePhones: () => new Map([[customer.phone, customer]]), knownIntakeVipNumbers: () => new Map(),
    customerPhoneKeys: row => [row.phone], linkedPhone: value => String(value || '').replace(/\D/g, ''), vipKey: value => String(value || ''),
    normalizeImportedDate: toDate, importSourceCatalog: () => ({ sources: ['单导'], groupFanSources: ['群粉'], aliases: {} }),
    normalizeBusinessSource: source => source, isGroupFanSource: () => false, localDateOffset: () => '2026-11-15',
    businessRecordSignature: (record, kind) => [kind, record.customerId, record.product, record.direction, record.buyDate, record.sellDate, record.date].join('|'),
    ticketDirectionKey: value => value, normalizeTicketRecord: value => value,
    syncBusinessRuleState: () => {}, activity: text => state.activities.push({ text }), flushStateWrites: async () => {},
    closeModal: () => {}, render: () => {}, toast: text => messages.push(text), persist: () => {},
  };
  vm.runInNewContext(`${appSource.slice(start, end)}\nthis.commitCsvImport=commitCsvImport;`, sandbox, { filename: 'commitCsvImport.js' });
  await sandbox.commitCsvImport();
  assert.equal(state.importIssues.length, 2, 'invalid registration and business dates stay in review');
  assert.equal(state.importIssues[0].row, 2);
  assert.equal(state.importIssues[1].row, 3);
  assert.deepEqual(Array.from(state.tickets, ticket => ticket.product), ['MSFT'], 'only the accepted row creates a ticket');
  assert.equal(state.batchOperations[0].ticketCount, 1);
  assert.ok(messages.some(message => message.includes('跟票 1 条')));
  state.pendingCsv = batch;
  await sandbox.commitCsvImport();
  assert.deepEqual(Array.from(state.tickets, ticket => ticket.product), ['MSFT'], 'reimport does not duplicate the accepted ticket');
  const failedBatch = { ...batch, filename: '隔离保存失败.csv', rows: [headers, ['9876543210', '跟票', 'GOOG', '买入', '2026-11-14', '2026-11-14', '单导']] };
  state.pendingCsv = failedBatch;
  let stagedAtSave = [];
  sandbox.flushStateWrites = async () => { stagedAtSave = state.tickets.map(ticket => ticket.product); throw new Error('injected storage failure'); };
  await sandbox.commitCsvImport();
  assert.ok(stagedAtSave.includes('GOOG'), 'the valid GOOG row reached the save stage before the injected failure');
  assert.deepEqual(Array.from(state.tickets, ticket => ticket.product), ['MSFT'], 'save failure must roll back the newly staged business row');
  assert.equal(state.pendingCsv, failedBatch, 'save failure keeps the import draft for retry');
  assert.ok(messages.some(message => message.includes('批量导入未能保存')));
}

testRejectedBusinessRowsStayRejected().then(
  () => console.log('customer import submit: rejected rows, valid rows, reimport and save-failure rollback pass'),
  error => { console.error(error); process.exitCode = 1; },
);
