const assert = require('node:assert/strict');
const core = require('../resources/app/modules/ws-crm-sync-core.js');

const analysis = {
  summary: '客户确认对产品感兴趣，要求今天发送报价。',
  intent: '高意向',
  intentScore: 92,
  urgency: '高',
  language: 'English',
  productInterest: ['A 方案'],
  budget: '5000 USD',
  contact: { name: 'Alice', phone: '+91 98765 43210', country: 'India', account: 'alice-wa' },
  profile: { origin: '展会', age: 34, occupation: '采购经理' },
  tags: ['高意向', '待报价'],
  customerStage: '意向客户',
  nextStep: '今天发送报价并确认预算',
  followupTime: '2026-11-08',
  confidence: 0.91,
};

const profile = core.deriveCustomerProfile(analysis, {
  id: 'conv-1',
  externalId: 'wa-1',
  title: 'Alice',
}, 'account-a');
assert.equal(profile.wsExternalId, 'wa-1');
assert.equal(profile.wsAccountId, 'account-a');
assert.equal(profile.conversationId, 'conv-1');
assert.equal(profile.phone, '+91 98765 43210');
assert.equal(profile.name, 'Alice');
assert.equal(profile.aiSummary, analysis.summary);
assert.equal(profile.origin, '展会');
assert.equal(profile.age, 34);
assert.equal(profile.occupation, '采购经理');
assert.deepEqual(profile.tags, ['高意向', '待报价']);

const plan = core.deriveFollowupPlan(analysis, { id: 'wsa-1' }, { id: 'conv-1', externalId: 'wa-1' }, 'account-a');
assert.equal(plan.nextDate, '2026-11-08');
assert.equal(plan.priority, 'high');
assert.match(plan.note, /今天发送报价/);
assert.equal(plan.dedupeKey, 'account-a:conv-1:wsa-1');
assert.equal(core.normalizeDate('2026年11月8日'), '2026-11-08');
assert.equal(core.normalizeDate('08/11/2026'), '2026-11-08');
assert.equal(core.normalizeDate('20261108'), '2026-11-08');
const quietPlan = core.deriveFollowupPlan({ summary: '客户暂未回复', noReply: { noReply: true, reason: '客户正在忙', suggestedAt: '2026-11-12' }, confidence: 0.9 }, { id: 'wsa-quiet' }, { id: 'conv-quiet' }, 'account-a');
assert.equal(quietPlan.shouldCreate, true);
assert.equal(quietPlan.nextDate, '2026-11-12');
assert.match(quietPlan.note, /客户正在忙/);
const noEvidencePlan = core.deriveFollowupPlan({ summary: '普通摘要', confidence: 0.9, followupStrategy: { shouldFollowUp: true, priorityScore: 100 } }, { id: 'wsa-no-evidence' }, { id: 'conv-no-evidence' }, 'account-a');
assert.equal(noEvidencePlan.shouldCreate, false, '没有资金/粘度/跟进理由证据时不得创建提醒');
assert.equal(noEvidencePlan.evidenceGate.passed, false);
assert.equal(noEvidencePlan.scoringWeights.investmentYears, 0, '投资年限只补档，不参与跟进优先级');

const lowConfidence = core.deriveCustomerProfile({ summary: '不确定', confidence: 0.2, contact: { phone: '+91 11111 11111' } }, { id: 'conv-2', externalId: 'wa-2' }, 'account-a');
assert.equal(lowConfidence.phone, '+91 11111 11111', '低置信度结果仍应提供给已有客户的安全补齐流程');
assert.equal(core.shouldAutoSync({ confidence: 0.2, contact: { phone: '+91 11111 11111' } }), true, '低置信度但有结构化客户线索时仍应进入自动同步');
assert.equal(core.shouldAutoSync({ confidence: 0.2 }), false);
assert.equal(core.shouldAutoSync({ confidence: 0.8 }), false, '缺少可验证客户字段的高置信度结果不能自动建档');
assert.equal(core.shouldAutoSync({ confidence: 0.8, intent: '高意向' }), true, '包含可追溯意向字段的结果可进入自动同步');
const phoneOnlyCustomer = { id: 'c-phone', phone: '1111111111' };
assert.equal(core.matchCustomerForAutoSync([phoneOnlyCustomer], { phone: '+91 11111 11111', confidence: 0.2 }).kind, 'new', '低置信度 AI 电话不得用于自动绑定客户');
assert.equal(core.matchCustomerForAutoSync([phoneOnlyCustomer], { phone: '+91 11111 11111', confidence: 0.9 }).kind, 'phone', '高置信度电话仍可匹配已有客户');
const factOnly = { confidence: 0.92, profileFacts: { preferred_name: { value: 'Asha', state: 'known', confidence: 0.9, evidence: '大家叫我 Asha' }, age: { value: 31, state: 'known', confidence: 0.9, evidence: '我今年31岁' }, occupation: { value: '采购经理', state: 'known', confidence: 0.9, evidence: '我做采购工作' } } };
assert.equal(core.shouldAutoSync(factOnly), true, '仅有结构化热聊事实也应触发自动同步');
const factProfile = core.deriveCustomerProfile(factOnly, { id: 'conv-fact', externalId: 'wa-fact' }, 'account-a');
assert.equal(factProfile.name, 'Asha');
assert.equal(factProfile.age, 31);
assert.equal(factProfile.occupation, '采购经理');
assert.equal(core.deriveCustomerProfile({ confidence: 0.9, intent: '高意向' }, { id: 'conv-phone-title', externalId: '919876543210', title: '+91 98765 43210' }, 'account-a').name, '未命名客户', '电话或 WS 标识不得当作客户姓名补入');
const existingCustomer = { id: 'c-existing', name: '人工确认姓名', phone: '9999999999', phase: '意向客户', tags: ['人工'] };
core.mergeCustomerProfileSafely(existingCustomer, { name: 'AI 猜测姓名', phone: '+91 98765 43210', customerStage: '高意向', aiSummary: '新摘要', tags: ['高意向'] });
assert.equal(existingCustomer.name, '人工确认姓名', '自动同步不得覆盖人工确认姓名');
assert.equal(existingCustomer.phone, '9999999999', '自动同步不得覆盖已有电话号码');
assert.equal(existingCustomer.aiSummary, '新摘要');
assert.deepEqual(existingCustomer.tags, ['人工', '高意向']);
const lockedCustomer = { id: 'c-locked', name: '人工姓名', intent: '人工阶段', manualLockedFields: ['intent', 'aiSummary'] };
core.mergeCustomerProfileSafely(lockedCustomer, { name: 'AI 名称', intent: '高意向', aiSummary: 'AI 摘要', occupation: '采购经理' });
assert.equal(lockedCustomer.intent, '人工阶段', 'AI must not overwrite manually locked fields');
assert.equal(lockedCustomer.aiSummary, undefined, 'locked empty AI fields remain untouched until manual confirmation');
assert.equal(lockedCustomer.occupation, '采购经理', 'unlocked empty fields may be filled');
const cumulativeCustomer = {
  id: 'c-cumulative',
  aiProfileCompleteness: 80,
  aiProfileKnownFields: ['age'],
  aiProfileMissingFields: ['gender'],
  aiProfileEvidence: { age: { value: 34, evidence: '我 34 岁' } },
};
core.mergeCustomerProfileSafely(cumulativeCustomer, core.deriveCustomerProfile({ confidence: 0.9, intent: '高意向', summary: '本次只有跟进策略' }, { id: 'conv-cumulative', externalId: 'wa-cumulative' }, 'account-a'));
assert.equal(cumulativeCustomer.aiProfileCompleteness, 80, '新一次分析缺少档案事实时完整度不得回退');
assert.deepEqual(cumulativeCustomer.aiProfileKnownFields, ['age']);
assert.equal(cumulativeCustomer.aiProfileEvidence.age.value, 34, '新分析不得清空已积累证据');
core.mergeCustomerProfileSafely(cumulativeCustomer, core.deriveCustomerProfile({ confidence: 0.9, profileFacts: { gender: { value: '女', state: 'known', confidence: 0.9, evidence: '我是女性' } } }, { id: 'conv-cumulative', externalId: 'wa-cumulative' }, 'account-a'));
assert.deepEqual(cumulativeCustomer.aiProfileKnownFields.sort(), ['age', 'gender']);
assert.ok(cumulativeCustomer.aiProfileEvidence.age && cumulativeCustomer.aiProfileEvidence.gender, '不同分析证据应累积合并');
const accountScopedCustomer = { id: 'c-account', account: 'default', wsAccountId: 'default', wsAccountIds: ['default'], wsExternalIds: ['wa-existing'], wsConversationIds: ['conv-existing'] };
assert.equal(core.matchCustomerForAutoSync([accountScopedCustomer], { wsAccountId: 'default', wsExternalId: 'wa-new', conversationId: 'conv-new', phone: '' }).kind, 'new', '不同 WS 会话不能仅因共用同一个登录账号而合并');
const explicitCustomer = { id: 'c-explicit', name: 'Explicit' };
assert.equal(core.matchCustomerForAutoSync([explicitCustomer], { customerId: 'c-explicit', wsExternalId: 'wa-other', phone: '9876543210' }).kind, 'explicit-id', '显式客户编号优先于其他身份');

console.log('ws-crm-sync-core: pass');
