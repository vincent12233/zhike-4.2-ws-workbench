'use strict';
// V5.0 §14/§19 investment profile in the customer 360.
const assert = require('node:assert/strict');
const core = require('../resources/app/modules/customer-investment-profile-core.js');

const results = [];
function check(name, fn) {
  try { fn(); results.push(true); console.log('PASS ' + name); }
  catch (error) { results.push(false); console.log('FAIL ' + name + ' :: ' + error.message); }
}
const field = (customer, label) => Object.fromEntries(core.investmentFields(customer))[label];

check('an empty customer shows every label with 未记录', () => {
  const fields = Object.fromEntries(core.investmentFields({}));
  for (const label of ['是否股民', '投资经验', '投资偏好', '关注股票', '关注产品', '明确持仓', '客户需求', '意向评分', '情绪', 'WhatsApp 身份', 'AI 字段来源']) {
    assert.equal(fields[label], '未记录', label);
  }
});
check('stored investment values are shown, lists are joined', () => {
  const customer = {
    investor: true, investment_years: '5年', investment_preferences: ['科技股', '短线'],
    holdings: ['AAPL', 'TSLA'], intent: '想了解开户', intentScore: 82, emotion: '积极',
  };
  assert.equal(field(customer, '是否股民'), '是');
  assert.equal(field(customer, '投资经验'), '5年');
  assert.equal(field(customer, '投资偏好'), '科技股、短线');
  assert.equal(field(customer, '明确持仓'), 'AAPL、TSLA');
  assert.equal(field(customer, '客户需求'), '想了解开户');
  assert.equal(field(customer, '意向评分'), '82/100');
  assert.equal(field(customer, '情绪'), '积极');
});
check('AI-extracted values fill only when the record has no own value', () => {
  const customer = { aiProfile: { investment_years: '3年', holdings: ['MSFT'], intent: '想看看' } };
  assert.equal(field(customer, '投资经验'), '3年');
  assert.equal(field(customer, '明确持仓'), 'MSFT');
  assert.equal(field(customer, '客户需求'), '想看看');
  const both = { investment_years: '8年', aiProfile: { investment_years: '3年' } };
  assert.equal(field(both, '投资经验'), '8年', 'the customer record outranks an AI extraction');
});
check('a placeholder value is never shown as data', () => {
  assert.equal(field({ investment_years: '未知', holdings: ['unknown'], intent: '—' }, '投资经验'), '未记录');
  assert.equal(field({ holdings: ['unknown'] }, '明确持仓'), '未记录');
  assert.equal(field({ intent: '—' }, '客户需求'), '未记录');
});
check('the WhatsApp identity is shown from any stored identity field', () => {
  assert.equal(field({ wsExternalId: '919800000001@c.us' }, 'WhatsApp 身份'), '919800000001@c.us');
  assert.equal(field({ wsExternalIds: ['a@lid', 'b@c.us'] }, 'WhatsApp 身份'), 'a@lid、b@c.us');
  assert.equal(field({ wsParticipantId: '919800000002@s.whatsapp.net' }, 'WhatsApp 身份'), '919800000002@s.whatsapp.net');
});
check('the intent score is clamped to 0–100 and non-numeric input is 未记录', () => {
  assert.equal(field({ intentScore: 250 }, '意向评分'), '100/100');
  assert.equal(field({ intentScore: -5 }, '意向评分'), '0/100');
  assert.equal(field({ intentScore: 'high' }, '意向评分'), '未记录');
  assert.equal(field({ intentScore: '' }, '意向评分'), '未记录');
});
check('the AI provenance hint appears only when AI fields exist', () => {
  assert.match(field({ aiFieldSources: { occupation: { confidence: 0.9 } } }, 'AI 字段来源'), /1 个字段由 AI 提供/);
  assert.equal(field({ aiFieldSources: {} }, 'AI 字段来源'), '未记录');
});
check('lists are de-duplicated', () => {
  assert.equal(field({ holdings: ['AAPL', 'AAPL', ' TSLA '] }, '明确持仓'), 'AAPL、TSLA');
});
check('malformed input never throws and keeps every label', () => {
  for (const customer of [null, undefined, 'x', 5, { aiProfile: 'oops' }, { holdings: 5 }, { aiFieldSources: 'oops' }]) {
    const fields = core.investmentFields(customer);
    assert.equal(fields.length, 11);
    assert.ok(fields.every(([label, value]) => typeof label === 'string' && typeof value === 'string'));
  }
});

const failed = results.filter(ok => !ok).length;
console.log(`Investment profile: ${results.length - failed}/${results.length}`);
if (failed) process.exit(1);
