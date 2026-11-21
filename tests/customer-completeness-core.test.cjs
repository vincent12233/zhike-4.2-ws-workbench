'use strict';
// V5.0 §17 customer profile completeness.
const assert = require('node:assert/strict');
const core = require('../resources/app/modules/customer-completeness-core.js');

const results = [];
function check(name, fn) {
  try { fn(); results.push(true); console.log('PASS ' + name); }
  catch (error) { results.push(false); console.log('FAIL ' + name + ' :: ' + error.message); }
}
const score = customer => core.computeProfileCompleteness(customer).score;
const missing = customer => core.computeProfileCompleteness(customer).missing;
const full = {
  name: 'Ravi', phone: '+91 98000 00001', country: 'Mumbai', occupation: '工程师',
  investment_years: '5年', investment_preferences: ['科技股'], holdings: ['AAPL'], intent: '想了解短线机会',
  firstSourceChannel: '单导K', groupStatus: '在群',
};

check('an empty customer scores 0 and lists every missing field', () => {
  const result = core.computeProfileCompleteness({});
  assert.equal(result.score, 0);
  assert.equal(result.band, 'sparse');
  assert.equal(result.missingCount, 10);
  assert.ok(result.missing.includes('可靠身份') && result.missing.includes('职业'));
});
check('a complete profile scores 100', () => {
  assert.equal(score(full), 100);
  assert.deepEqual(missing(full), []);
});
check('placeholder values never count as profile data', () => {
  const fake = { name: '未命名客户', phone: '', rawPhone: '—', occupation: '未知', country: '-', channel: 'WhatsApp', assistant: '未分配', groupStatus: '状态未知', intent: 'n/a' };
  assert.equal(score(fake), 0, 'fabricated placeholders must not raise the score');
});
check('a generic label is not a business channel', () => {
  assert.ok(missing({ ...full, firstSourceChannel: '', channel: 'WhatsApp' }).includes('来源渠道'));
  assert.ok(!missing({ ...full, firstSourceChannel: '单导K' }).includes('来源渠道'));
});
check('uncertain in-group state earns nothing', () => {
  for (const groupStatus of ['待确认', '状态未知', '未进群', '']) {
    assert.ok(missing({ ...full, groupStatus }).includes('在群状态'), groupStatus);
  }
  for (const groupStatus of ['在群', '已退群', '被移除', '已进群']) {
    assert.ok(!missing({ ...full, groupStatus }).includes('在群状态'), groupStatus);
  }
});
check('an invalid phone cannot establish identity', () => {
  assert.ok(missing({ ...full, phone: '12345', rawPhone: '' }).includes('可靠身份'));
  assert.ok(!missing({ ...full, phone: '9800000001' }).includes('可靠身份'));
});
check('a reliable WhatsApp identity counts without a phone', () => {
  assert.ok(!missing({ ...full, phone: '', wsExternalIds: ['919800000001@s.whatsapp.net'] }).includes('可靠身份'));
});
check('the score only rises when real fields are added', () => {
  let previous = 0;
  const steps = [{ name: 'Ravi' }, { name: 'Ravi', phone: '9800000001' }, { ...full, investment_preferences: [] }, full];
  for (const customer of steps) {
    const current = score(customer);
    assert.ok(current >= previous, `score must not drop: ${previous} -> ${current}`);
    previous = current;
  }
  assert.equal(previous, 100);
});
check('a nearly empty record cannot collect full confidence marks', () => {
  const phoneOnly = score({ phone: '9800000001' });
  assert.ok(phoneOnly > 0 && phoneOnly <= 20, `phone-only score was ${phoneOnly}`);
});
check('weak AI confidence is flagged and costs score', () => {
  const trusted = core.computeProfileCompleteness(full);
  const weak = core.computeProfileCompleteness({ ...full, aiFieldSources: { occupation: { confidence: 0.2 }, holdings: { confidence: 0.2 } } });
  assert.ok(weak.score < trusted.score);
  assert.ok(weak.missing.includes('字段可信度待确认'));
  assert.deepEqual(weak.weakFields, ['occupation', 'holdings']);
});
check('manual values are trusted without an AI source', () => {
  const result = core.computeProfileCompleteness(full);
  assert.deepEqual(result.weakFields, []);
  assert.ok(!result.missing.includes('字段可信度待确认'));
});
check('score is always an integer between 0 and 100', () => {
  const odd = [
    null, undefined, {}, { name: 12345, phone: 0 }, { holdings: 'AAPL' }, { holdings: ['AAPL', '', '  '] },
    { aiFieldSources: 'oops' }, { tags: '偏好科技股' },
  ];
  for (const customer of odd) {
    const value = core.computeProfileCompleteness(customer).score;
    assert.ok(Number.isInteger(value) && value >= 0 && value <= 100, `bad score ${value}`);
  }
});
check('bands follow the score', () => {
  const band = value => core.computeProfileCompleteness(value).band;
  assert.equal(band({}), 'sparse');
  assert.equal(band(full), 'complete');
  assert.equal(core.CONFIDENCE_WEIGHT, 18);
  assert.equal(core.COMPONENTS.reduce((sum, item) => sum + item.weight, 0) + core.CONFIDENCE_WEIGHT, 100);
});

const failed = results.filter(ok => !ok).length;
console.log(`Customer completeness: ${results.length - failed}/${results.length}`);
if (failed) process.exit(1);
