const assert = require('node:assert/strict');
const core = require('../resources/app/modules/hot-chat-profile-core.js');

assert.deepEqual(core.PROFILE_FIELDS, [
  'preferred_name','age','gender','occupation','work_context','is_investor','investment_years','holdings','investment_habits','investment_preferences','family_context','life_interests','future_plans'
]);

const fact = core.normalizeProfileFact('age', { value: 36, confidence: 0.91, evidence: '我今年36岁' });
assert.deepEqual(fact, { field: 'age', value: 36, state: 'known', confidence: 0.91, evidence: '我今年36岁' });
assert.equal(core.normalizeProfileFact('occupation', { value: '采购经理', confidence: 0.2, evidence: '我是采购经理' }).state, 'pending');
assert.equal(core.normalizeProfileFact('age', { value: 36, confidence: 0.9, evidence: '' }).state, 'missing');

const merged = core.mergeEvidence({ age: { value: '', state: 'missing' } }, [
  { field: 'age', value: 36, confidence: 0.9, evidence: '我今年36岁', sourceMessageId: 'm1' },
  { field: 'age', value: 37, confidence: 0.95, evidence: '我37岁', sourceMessageId: 'm2' },
]);
assert.equal(merged.age.value, 36);
assert.equal(merged.age.state, 'pending');
assert.equal(merged.age.observations.length, 2);

assert.equal(core.computeCompleteness({ age: { state: 'known' }, preferred_name: { state: 'pending' } }), Math.round(100 / 13));
assert.equal(core.deriveStatusColor({ completeness: 90, recentReplyAt: Date.now() }), 'green');
assert.equal(core.deriveStatusColor({ completeness: 20, willingToTalk: true }), 'blue');
assert.equal(core.deriveStatusColor({ intent: 'high', interactionDecline: true }), 'amber');
assert.equal(core.deriveStatusColor({ urgent: true }), 'red');
assert.equal(core.deriveStatusColor({ silent: true }), 'gray');
assert.equal(core.deriveStatusColor({ aiColor: 'red', manualOverride: { color: 'blue', locked: true } }), 'blue');

assert.deepEqual(core.deriveNextTopics({ missingFields: ['family_context','life_interests'], profile: {} }), ['family_context','life_interests']);
assert.equal(core.deriveNextTopics({ missingFields: ['age'], profile: {} }).length, 1);

const noReply = core.assessNoReply({ lastInboundAt: Date.now() - 8 * 86400000, lastOutboundAt: Date.now() - 7 * 86400000, followupCount: 2 });
assert.equal(noReply.cooldown, true);
assert.match(noReply.reason, /等待|频率|沉默/);

assert.equal(core.applyManualOverride({ color: 'red' }, { color: 'blue', locked: true }).color, 'blue');
assert.equal(core.applyManualOverride({ color: 'red', manualOverride: { color: 'blue', locked: true } }, { unlock: true }).color, 'red');

const event = core.buildEvent('topic_suggested', { family_context: '有孩子' }, { sourceText: '我的孩子在上学', secret: 'token-123' });
assert.equal(event.type, 'topic_suggested');
assert.equal(event.payload.secret, undefined);
assert.equal(JSON.stringify(event).includes('token-123'), false);

console.log('hot-chat-profile-core: pass');
