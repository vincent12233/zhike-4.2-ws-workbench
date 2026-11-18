'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'resources', 'app', 'modules', 'smart-import.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'resources', 'app', 'app.js'), 'utf8');
const sandbox = { window: {}, console };
vm.runInNewContext(source, sandbox, { filename: 'smart-import.js' });
const api = sandbox.window.ZhikeSmartImport;

assert.equal(api.detectImportDomain(['手机位置', '编号', '号码', '所属角色', '接码渠道']), 'phone-registry');
assert.equal(api.detectImportDomain(['客户姓名', '手机号码', '渠道']), 'customer-business');
const phoneRegistryDecision = api.explainImportDecision(['多开手机1', 'A-1', '9876543210', '客服', '接码1'], { phone: 2 }, ['手机位置', '编号', '号码', '所属角色', '接码渠道']);
assert.equal(phoneRegistryDecision.target, 'phone-registry');
assert.equal(phoneRegistryDecision.aiRequired, false);
assert.match(phoneRegistryDecision.reasons.join('；'), /不调用 AI/);

assert.equal(api.canonicalImportField('due'), 'nextFollow');
assert.equal(api.canonicalImportField('下次跟进日期'), 'nextFollow');
assert.equal(api.canonicalImportField('trade_ref'), 'tradeRef');
assert.deepEqual(JSON.parse(JSON.stringify(api.classifyImportRow({ phone: '9876543210', product: 'AAPL', direction: '买入' }))), { type: 'ticket', confidence: 1, reasons: ['product', 'direction'] });
assert.deepEqual(JSON.parse(JSON.stringify(api.classifyImportRow({ phone: '9876543210', amount: '1000', currency: 'INR' }))), { type: 'deposit', confidence: 1, reasons: ['amount', 'currency'] });
assert.equal(api.classifyImportRow({ name: '只有姓名' }).confidence < 0.8, true);
assert.equal(typeof api.looksLikeCustomerExport, 'function', 'customer export boundary is exposed for AI mapping guard');
assert.equal(api.looksLikeCustomerExport(['客户姓名', '手机号码', '渠道', '进群状态', '跟票', '入金', '入金金额']), true);
assert.equal(api.looksLikeCustomerExport(['客户号码', '股票代码', '买卖方向', '买入日期']), false);
assert.match(appSource, /客户中心的“跟票\/入金\/热聊\/VIP\/是否股民\/最后跟进\/下次跟进\/入金金额”是客户属性或汇总值/, 'AI import prompt explains customer-derived columns');
assert.match(appSource, /rawParsed\?\.mapping&&typeof rawParsed\.mapping==='object'/, 'AI import accepts structured mapping envelope');
assert.match(appSource, /typeof index==='string'&&\/\^\\d\+\$\/.test\(index\.trim\(\)\)/, 'AI import accepts numeric column indexes returned as strings');

assert.equal(api.normalizeSource('单导群组'), '单导');
assert.equal(api.normalizeSource('单导群组数据'), '单导');
assert.equal(api.normalizeSource('私聊群组'), '单导');
assert.equal(api.normalizeSource('群粉群组'), '群粉');
assert.equal(api.normalizeSource('', '单导群组'), '单导');
assert.equal(api.normalizeSource('', '微信群'), '群粉');
assert.equal(api.normalizeSource('', '群组'), '');

const mixedChannelHeaders = ['客户姓名', '手机号码', '备注'];
const mixedChannelMapping = { name: 0, phone: 1, note: 2 };
const mixedSingle = api.inferRowClassification(['甲', '9876543230', '来源：单导群组'], mixedChannelMapping, mixedChannelHeaders, { filename: '客户汇总.csv' });
const mixedGroup = api.inferRowClassification(['乙', '9876543231', '来自微信群'], mixedChannelMapping, mixedChannelHeaders, { filename: '客户汇总.csv' });
assert.equal(mixedSingle.source, '单导', '未映射渠道列时应从该行文本识别单导');
assert.equal(mixedGroup.source, '群粉', '同一文件的另一行应独立识别群粉');

const explicitMixedChannel = api.inferRowClassification(['丙', '9876543232', '微信群', '已退群'], { name: 0, phone: 1, source: 2, status: 3 }, ['客户姓名', '手机号码', '渠道', '状态'], { filename: '混合.csv' });
assert.equal(explicitMixedChannel.source, '群粉');
assert.equal(explicitMixedChannel.status, '已退群');
const explicitCustomChannel = api.inferRowClassification(['丁', '9876543233', 'Facebook Ads'], { name: 0, phone: 1, source: 2 }, ['客户姓名', '手机号码', '渠道'], { filename: '混合.csv' });
assert.equal(explicitCustomChannel.source, 'Facebook Ads', '明确渠道列中的自定义渠道应原样保留');
const labelledCustomChannel = api.inferRowClassification(['戊', '9876543234', '客户来源：YouTube Ads；状态：未进群'], { name: 0, phone: 1, note: 2 }, ['客户姓名', '手机号码', '备注'], { filename: '混合.csv' });
assert.equal(labelledCustomChannel.source, 'YouTube Ads', '备注中的明确渠道标签也应识别自定义渠道');
assert.equal(labelledCustomChannel.sourceOrigin, '行标签');

// Configured group-fan subchannels must be recognized even when the source
// column is absent and the value only appears in a free-text note.  The
// classifier receives the option catalog from the settings page; it must
// preserve the configured value instead of collapsing it to generic "群粉".
const configuredChannels = {
  groupFanSources: ['群粉', 'WhatsApp群粉', 'Telegram群粉'],
  sources: ['单导', 'Facebook广告'],
  aliases: { whatsapp群: 'WhatsApp群粉', tg群: 'Telegram群粉' },
};
const configuredWhatsApp = api.inferRowClassification(
  ['己', '9876543235', '客户来自 WhatsApp群，本周新加'],
  { name: 0, phone: 1, note: 2 },
  ['客户姓名', '手机号码', '备注'],
  { filename: '客户汇总.csv', aliases: configuredChannels },
);
assert.equal(configuredWhatsApp.source, 'WhatsApp群粉', '设置中的群粉子渠道应从行文本识别');
assert.equal(configuredWhatsApp.sourceConfidence >= 0.8, true);
assert.equal(JSON.stringify(configuredWhatsApp.sourceCandidates), JSON.stringify(['WhatsApp群粉']));
const configuredTelegram = api.inferRowClassification(
  ['庚', '9876543236', '来源=tg群'],
  { name: 0, phone: 1, note: 2 },
  ['客户姓名', '手机号码', '备注'],
  { filename: '客户汇总.csv', aliases: configuredChannels },
);
assert.equal(configuredTelegram.source, 'Telegram群粉', '自定义渠道别名应映射到设置中的目标渠道');
assert.equal(api.parseNaturalLine('9876543239 周庚 WhatsApp群粉 登记日期:2026-11-09', configuredChannels).source, 'WhatsApp群粉');
assert.equal(api.sourceSignal('Facebook广告投放_2026.csv', configuredChannels), 'Facebook广告', '文件名中的自定义渠道应优先于通用广告关键词');
assert.equal(api.sourceSignal('WhatsApp群粉_新增客户', configuredChannels), 'WhatsApp群粉', '页面或文件名中的群粉子渠道应保留设置中的具体类型');
assert.equal(api.normalizeSource('', 'Facebook广告落地页', '', configuredChannels), 'Facebook广告', '页面信号应使用设置中的自定义渠道');

// A mixed file must classify each row independently when every row uses a
// different configured channel; no file-level fallback may overwrite it.
const perRowConfigured = [
  api.inferRowClassification(['辛', '9876543237', 'Facebook广告'], { name: 0, phone: 1, note: 2 }, ['客户姓名', '手机号码', '备注'], { aliases: configuredChannels }),
  api.inferRowClassification(['壬', '9876543238', 'WhatsApp群粉'], { name: 0, phone: 1, note: 2 }, ['客户姓名', '手机号码', '备注'], { aliases: configuredChannels }),
];
assert.deepEqual(perRowConfigured.map(row => row.source), ['Facebook广告', 'WhatsApp群粉']);

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
const typedBusinessHeaders = ['客户号码', '记录类型', '业务日期', '金额', '股票代码', '买卖方向'];
const typedBusinessRows = [
  ['9876543250', '跟票', '2026-11-13', '800', 'AAPL', '买入'],
  ['9876543251', '入金', '2026-11-14', '1500', '', ''],
];
const typedBusinessMapping = api.inferHeaderMapping(typedBusinessHeaders, typedBusinessRows);
const typedBusinessSummary = api.summarizeImportBatch({
  headers: typedBusinessHeaders,
  rows: [typedBusinessHeaders, ...typedBusinessRows],
  mapping: typedBusinessMapping,
});
assert.equal(typedBusinessSummary.mode, 'mixed');
assert.equal(typedBusinessSummary.ticketRows, 1, 'a typed deposit row must not also appear as a ticket in preview');
assert.equal(typedBusinessSummary.depositRows, 1, 'a typed ticket with purchase amount must not also appear as a deposit');
const customerInterestMapping = api.inferHeaderMapping(['客户姓名', '联系人号码', '产品兴趣', '登记日期'], [
  ['李四', '9876543221', 'AAPL、ETF', '2026-11-12'],
]);
assert.equal(customerInterestMapping.product, undefined, '产品兴趣不应被识别为跟票股票代码');
const customerProfileMapping = api.inferHeaderMapping(['客户姓名', '手机号码', '热聊', '是否股民', '跟票', '入金', '入金金额', '最后跟进'], [
  ['李四', '9876543221', '是', '是', '否', '是', '1250', '2026-11-10'],
]);
assert.equal(customerProfileMapping.hot, 2, '客户导出应识别热聊字段');
assert.equal(customerProfileMapping.investor, 3, '客户导出应识别股民字段');
assert.equal(customerProfileMapping.ticketFlag, 4, '客户导出应识别跟票汇总字段');
assert.equal(customerProfileMapping.depositFlag, 5, '客户导出应识别入金汇总字段');
assert.equal(customerProfileMapping.lastFollow, 7, '客户导出应识别最后跟进日期');
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

// Regression: a customer-center export can carry derived business columns,
// but it must not fan out one synthetic ticket/deposit per customer. The
// batch-level customer hint and row-level blank business fields together
// define a customer-only import.
const customerExportMapping = {
  name: 0,
  phone: 2,
  source: 3,
  status: 6,
  registered: 16,
  amount: 15,
  recordTypeHint: 'customer',
};
const customerExportRows = [['客户姓名', '原始号码', '标准号码', '渠道', '页面分类', '跟进助理', '进群状态', '客户阶段', '资质评级', '热聊', 'VIP编号', '是否股民', '群编号', '跟票', '入金', '入金金额', '登记时间', '最后跟进', '下次跟进日期', '备注']];
for (let i = 0; i < 163; i += 1) {
  customerExportRows.push(['客户' + (i + 1), '+91 98765' + String(10000 + i).slice(-5), '98765' + String(10000 + i).slice(-5), '单导', '', '', '未进群', '新客户', '待评估', '否', '', '否', '—', '是', '是', '1250', '2026-11-01', '', '2026-11-02', '']);
}
const customerExportBatch = { rows: customerExportRows, mapping: customerExportMapping };
assert.equal(typeof api.importBatchMode, 'function', 'smart import exposes a batch target resolver');
assert.equal(typeof api.shouldWriteBusinessRow, 'function', 'smart import exposes a business-row write guard');
assert.equal(api.importBatchMode(customerExportBatch), 'customer');
const customerBusinessRows = customerExportRows.slice(1).filter(row => api.shouldWriteBusinessRow(row, customerExportMapping, api.importBatchMode(customerExportBatch), customerExportRows[0]));
assert.equal(customerBusinessRows.length, 0, '163 customer rows must create no derived business records');
assert.deepEqual(
  customerExportRows.slice(1).reduce((counts, row) => {
    if (api.shouldWriteBusinessRow(row, customerExportMapping, api.importBatchMode(customerExportBatch), customerExportRows[0])) counts.business += 1;
    else counts.customer += 1;
    return counts;
  }, { customer: 0, business: 0 }),
  { customer: 163, business: 0 },
);
const customerExportBatchWithoutAiHint = {
  rows: customerExportRows,
  headers: customerExportRows[0],
  mapping: { ...customerExportMapping, recordTypeHint: undefined },
};
delete customerExportBatchWithoutAiHint.mapping.recordTypeHint;
assert.equal(api.importBatchMode(customerExportBatchWithoutAiHint), 'customer', 'derived ticket/deposit columns do not change customer-center target');
assert.equal(
  customerExportRows.slice(1).filter(row => api.shouldWriteBusinessRow(row, customerExportBatchWithoutAiHint.mapping, api.importBatchMode(customerExportBatchWithoutAiHint), customerExportRows[0])).length,
  0,
);
const ticketBatch = {
  rows: [['客户号码', '记录类型', '股票代码', '方向'], ['9876543999', '跟票', 'AAPL', '买入']],
  mapping: { phone: 0, recordType: 1, product: 2, direction: 3 },
};
assert.equal(api.importBatchMode(ticketBatch), 'ticket');
assert.equal(api.shouldWriteBusinessRow(ticketBatch.rows[1], ticketBatch.mapping, 'ticket', ticketBatch.rows[0]), true);
const dateOnlyTicketBatch = {
  rows: [['客户号码', '跟票日期'], ['9876543997', '2026-11-01']],
  mapping: { phone: 0, followDate: 1 },
};
assert.equal(api.importBatchMode(dateOnlyTicketBatch), 'ticket');
assert.equal(api.shouldWriteBusinessRow(dateOnlyTicketBatch.rows[1], dateOnlyTicketBatch.mapping, 'ticket', dateOnlyTicketBatch.rows[0]), true);
assert.equal(api.classifyImportRow({ phone: '9876543997', followDate: '2026-11-01' }, { target: 'ticket' }).type, 'ticket');
assert.match(appSource, /classifyImportRow\?\.\(\{recordType:rawType,product,direction,amount:amountRaw,currency:[\s\S]{0,180}\},\{target:batchMode\}\)/, 'mixed import second pass keeps the resolved batch target');
assert.match(appSource, /type:'智能批量导入'[s\S]{0,220}ticketCount:newTickets\.length/, 'smart import writes a route/count audit record');
assert.equal(typeof api.mergeCustomerFields, 'function', 'smart import exposes safe customer merge for existing phone matches');
assert.match(appSource, /mergeCustomerFields\?\.\(customer,incoming\)/, 'batch import fills missing customer fields instead of dropping existing-phone rows');
assert.match(appSource, /updatedCount:updated[\s\S]{0,100}matchedCount:matched/, 'batch audit records new, updated and matched row counts');
assert.match(appSource, /inferRowClassification\?\.\(row,batch\.mapping/, 'batch import resolves channel/status per row');
assert.match(appSource, /exposeImportSourceCatalog/, 'settings option catalog is exposed to import classifier');
assert.match(appSource, /aliases:importSourceCatalog\(\)/, 'all import paths receive the live settings source catalog');
assert.match(appSource, /sourceSignal\?\.\(batch\.filename,importSourceCatalog\(\)\)/, 'filename channel signals receive the live settings source catalog');
assert.match(appSource, /detectImportDomain\?\.\(headers\)==='phone-registry'/, 'phone registry sheets are separated before AI mapping');
assert.match(appSource, /decisionPolicy:'local-rules-first-ai-advisory'/, 'import batches keep explainable local-first decisions');
assert.match(appSource, /catalog=\[\.\.\.groupFanSources,\.\.\.sources\]/, 'custom source options are preserved before generic keyword fallback');
assert.match(appSource, /sourceHistory=\[\.\.\.new Set/, 'explicit imported channels can correct stale automatic classification while keeping history');
assert.match(appSource, /manualLockedFields[\s\S]{0,180}sourceLocked/, 'explicit manual source locks remain authoritative during channel correction');
assert.doesNotMatch(appSource, /else if\(knownPhones\.has\(phone\)\)reason='文件内重复或与现有客户重复'/, 'existing phone rows are not silently discarded');
assert.match(appSource, /sourceTypes:Object\.keys\(summary\)/, 'group management derives channel tabs from actual customer channels');
assert.doesNotMatch(appSource, /const source=isGroupFanSource\(customer\.source\)\?customer\.source:'单导'/, 'custom channels are not collapsed into the single-lead bucket');
const depositBatch = {
  rows: [['客户号码', '记录类型', '金额'], ['9876543998', '入金', '1500']],
  mapping: { phone: 0, recordType: 1, amount: 2 },
};
assert.equal(api.importBatchMode(depositBatch), 'deposit');
assert.equal(api.shouldWriteBusinessRow(depositBatch.rows[1], depositBatch.mapping, 'deposit', depositBatch.rows[0]), true);

const registrationBatch = {
  rows: [['客户号码', '记录类型', '业务日期', '业务备注'], ['9876543996', '报名', '2026-11-03', '确认报名']],
  mapping: { phone: 0, recordType: 1, followDate: 2, businessNote: 3 },
};
assert.equal(api.importBatchMode(registrationBatch), 'registration', 'explicit registration rows must route to the independent registration ledger');
assert.equal(api.shouldWriteBusinessRow(registrationBatch.rows[1], registrationBatch.mapping, 'registration', registrationBatch.rows[0]), true);
assert.equal(api.classifyImportRow({ recordType: '报名' }, { target: 'registration' }).type, 'registration');

const followupBatch = {
  rows: [['客户号码', '记录类型', '业务日期', '下次跟进', '业务备注'], ['9876543995', '跟进', '2026-11-04', '2026-11-08', '已电话沟通']],
  mapping: { phone: 0, recordType: 1, followDate: 2, nextFollow: 3, businessNote: 4 },
};
assert.equal(api.importBatchMode(followupBatch), 'followup', 'explicit follow-up rows must route to the independent follow-up ledger');
assert.equal(api.shouldWriteBusinessRow(followupBatch.rows[1], followupBatch.mapping, 'followup', followupBatch.rows[0]), true);
assert.equal(api.classifyImportRow({ recordType: '跟进' }, { target: 'followup' }).type, 'followup');

const newestFirst = api.latestFollowSummary(
  { lastFollow: '2026-11-10', due: '2026-11-15' },
  { date: '2026-10-01', nextDate: '2026-10-05' },
);
assert.equal(newestFirst.lastFollow, '2026-11-10', 'an older imported follow-up cannot move the last-follow summary backwards');
assert.equal(newestFirst.due, '2026-11-15', 'an older imported follow-up cannot replace the current due date');
assert.equal(newestFirst.accepted, false);
const newestLast = api.latestFollowSummary(
  { lastFollow: '2026-10-01', due: '2026-10-05' },
  { date: '2026-11-10', nextDate: '2026-11-15' },
);
assert.equal(newestLast.lastFollow, '2026-11-10', 'the newest imported follow-up owns the customer summary regardless of file order');
assert.equal(newestLast.due, '2026-11-15');
assert.equal(newestLast.accepted, true);
const sameDay = api.latestFollowSummary({ lastFollow: '2026-11-10', due: '2026-11-15' }, { date: '2026-11-10', nextDate: '2026-11-12' });
assert.equal(sameDay.lastFollow, '2026-11-10');
assert.equal(sameDay.due, '2026-11-15', 'same-day imports deterministically keep the furthest next-follow date');
assert.equal(sameDay.accepted, true);
assert.equal(api.shouldReviewSource({ needsReview: true }, { existingCustomer: true, recordType: 'ticket' }), false, 'a uniquely matched ticket row inherits the customer source');
assert.equal(api.shouldReviewSource({ needsReview: true }, { existingCustomer: true, recordType: 'registration' }), false, 'a uniquely matched registration row inherits the customer source');
assert.equal(api.shouldReviewSource({ needsReview: true }, { existingCustomer: false, recordType: 'ticket' }), true, 'a new business customer still requires a reliable source');
assert.equal(api.shouldReviewSource({ needsReview: true }, { existingCustomer: true, recordType: 'customer' }), true, 'customer-profile rows do not silently inherit a missing source');

console.log('smart import classification: explicit single-group and group-fan sources normalize correctly');
