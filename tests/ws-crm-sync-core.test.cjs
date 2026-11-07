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
assert.deepEqual(profile.tags, ['高意向', '待报价']);

const plan = core.deriveFollowupPlan(analysis, { id: 'wsa-1' }, { id: 'conv-1', externalId: 'wa-1' }, 'account-a');
assert.equal(plan.nextDate, '2026-11-08');
assert.equal(plan.priority, 'high');
assert.match(plan.note, /今天发送报价/);
assert.equal(plan.dedupeKey, 'account-a:conv-1:wsa-1');

const lowConfidence = core.deriveCustomerProfile({ summary: '不确定', confidence: 0.2, contact: { phone: '+91 11111 11111' } }, { id: 'conv-2', externalId: 'wa-2' }, 'account-a');
assert.equal(lowConfidence.phone, '', '低置信度不能自动写入联系方式');
assert.equal(core.shouldAutoSync({ confidence: 0.2 }), false);
assert.equal(core.shouldAutoSync({ confidence: 0.8 }), true);
const existingCustomer = { id: 'c-existing', name: '人工确认姓名', phone: '9999999999', phase: '意向客户', tags: ['人工'] };
core.mergeCustomerProfileSafely(existingCustomer, { name: 'AI 猜测姓名', phone: '+91 98765 43210', customerStage: '高意向', aiSummary: '新摘要', tags: ['高意向'] });
assert.equal(existingCustomer.name, '人工确认姓名', '自动同步不得覆盖人工确认姓名');
assert.equal(existingCustomer.phone, '9999999999', '自动同步不得覆盖已有电话号码');
assert.equal(existingCustomer.aiSummary, '新摘要');
assert.deepEqual(existingCustomer.tags, ['人工', '高意向']);
const accountScopedCustomer = { id: 'c-account', account: 'default', wsAccountId: 'default', wsAccountIds: ['default'], wsExternalIds: ['wa-existing'], wsConversationIds: ['conv-existing'] };
assert.equal(core.matchCustomerForAutoSync([accountScopedCustomer], { wsAccountId: 'default', wsExternalId: 'wa-new', conversationId: 'conv-new', phone: '' }).kind, 'new', '不同 WS 会话不能仅因共用同一个登录账号而合并');

console.log('ws-crm-sync-core: pass');
