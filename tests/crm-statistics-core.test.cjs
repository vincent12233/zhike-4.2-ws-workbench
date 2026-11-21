'use strict';
// V5.0 §20 channel / assistant / group statistics and dedupe rules.
const assert = require('node:assert/strict');
const core = require('../resources/app/modules/crm-statistics-core.js');

const results = [];
function check(name, fn) {
  try { fn(); results.push(true); console.log('PASS ' + name); }
  catch (error) { results.push(false); console.log('FAIL ' + name + ' :: ' + error.message); }
}
const OPTS = { today: '2026-11-21', since: '2026-11-01' };
const run = (customers, options = OPTS) => core.computeStatistics(customers, options);

check('CRM counts are unique customers, not rows', () => {
  const result = run([{ id: 'C1', firstSourceChannel: '单导K' }, { id: 'C1', firstSourceChannel: '单导K' }, { id: 'C1' }]);
  assert.equal(result.uniqueCustomers, 1);
  assert.equal(result.channels.reduce((sum, item) => sum + item.value, 0), 1);
});
check('deleted customers are excluded', () => {
  const result = run([{ id: 'C1' }, { id: 'C2', deleted: true }]);
  assert.equal(result.uniqueCustomers, 1);
});
check('channel attribution prefers the first source channel', () => {
  assert.equal(core.customerChannel({ firstSourceChannel: '单导K', channel: 'FB群粉', currentChannels: ['API群粉'] }).channel, '单导K');
  assert.equal(core.customerChannel({ currentChannels: ['API群粉'] }).origin, 'current');
  assert.equal(core.customerChannel({ channel: '短信群粉' }).channel, '短信群粉');
});
check('a generic label is not a channel and is reported as unclassified', () => {
  const result = run([{ id: 'C1', channel: 'WhatsApp' }, { id: 'C2', firstSourceChannel: '单导K' }]);
  assert.deepEqual(result.channels, [{ label: '单导K', value: 1 }]);
  assert.equal(result.unclassifiedChannel, 1);
  assert.equal(result.channelTotal + result.unclassifiedChannel, result.uniqueCustomers, 'channels and unclassified always add up');
});
check('assistant counts are unique customers; 未分配 is separate', () => {
  const result = run([
    { id: 'C1', assistant: '小王' }, { id: 'C2', assistant: '小王' }, { id: 'C3', assistant: '未分配' }, { id: 'C4' },
  ]);
  assert.deepEqual(result.assistants, [{ label: '小王', value: 2 }]);
  assert.equal(result.unassigned, 2);
});
check('a customer in several groups is counted once per CRM metric, per group in the group panel', () => {
  const customer = { id: 'C1', groupStatus: '在群', groupMemberships: [{ groupJid: 'g1@g.us', groupName: 'G1', status: '在群' }, { groupJid: 'g2@g.us', groupName: 'G2', status: '在群' }] };
  const result = run([customer, { id: 'C2', groupMemberships: [{ groupJid: 'g1@g.us', status: '在群' }] }]);
  assert.equal(result.inGroup, 2, 'CRM in-group count is by customer');
  assert.deepEqual(result.groups.map(group => [group.groupName, group.members]), [['G1', 2], ['G2', 1]]);
});
check('unknown or insufficient evidence is 待确认, never 已退群', () => {
  for (const customer of [
    { id: 'C1', groupStatus: '状态未知' },
    { id: 'C2', groupStatus: '待确认' },
    { id: 'C3' },
    { id: 'C4', groupMemberships: [{ groupJid: 'g@g.us', status: '状态未知' }] },
  ]) {
    assert.equal(core.customerGroupState(customer), 'pending', JSON.stringify(customer));
  }
  const result = run([{ id: 'C1', groupStatus: '状态未知' }, { id: 'C2', groupStatus: '已退群' }]);
  assert.equal(result.pending, 1);
  assert.equal(result.left, 1);
});
check('one remaining unknown relation keeps a left customer at 待确认', () => {
  const customer = { id: 'C1', groupStatus: '已退群', groupMemberships: [{ groupJid: 'a@g.us', status: '已退群' }, { groupJid: 'b@g.us', status: '状态未知' }] };
  assert.equal(core.customerGroupState(customer), 'pending');
});
check('analysed, incomplete and due counts use real evidence', () => {
  const result = run([
    { id: 'C1', wsAnalysisId: 'A1', profileMissingFields: [], due: '2026-11-01' },
    { id: 'C2', aiProfile: { lastAnalysisId: 'A2' }, profileMissingFields: ['职业'], due: '2026-11-30' },
    { id: 'C3', profileCompleteness: 100, due: '未安排' },
  ]);
  assert.equal(result.analysed, 2);
  assert.equal(result.incomplete, 1, 'completeness 100 and an empty missing list are complete');
  assert.equal(result.due, 1, 'only a real date that is today or past counts as due');
});
check('new customers use the period start and ignore malformed dates', () => {
  const result = run([
    { id: 'C1', createdAt: '2026-11-05T10:00:00Z' },
    { id: 'C2', createdAt: '2026-10-05T10:00:00Z' },
    { id: 'C3', createdAt: 'garbage' },
    { id: 'C4' },
  ]);
  assert.equal(result.newCustomers, 1);
  assert.equal(result.since, '2026-11-01');
});
check('an empty book yields zeros, not dashes or invented values', () => {
  const result = run([]);
  assert.equal(result.uniqueCustomers, 0);
  assert.deepEqual(result.channels, []);
  assert.deepEqual(result.assistants, []);
  assert.deepEqual(result.groups, []);
  for (const key of ['inGroup', 'left', 'pending', 'analysed', 'incomplete', 'due', 'newCustomers', 'unassigned']) assert.equal(result[key], 0, key);
  assert.equal(Number.isFinite(result.channelTotal), true);
});
check('the dedupe notes are always present', () => {
  const notes = run([]).notes;
  for (const key of ['crm', 'groups', 'pending', 'period']) assert.ok(notes[key] && notes[key].length > 4, key);
});
check('malformed input never throws', () => {
  for (const customers of [null, undefined, 'x', 5, [null, 3, {}], { length: 3 }]) {
    const result = core.computeStatistics(customers, OPTS);
    assert.ok(Number.isInteger(result.uniqueCustomers));
  }
});

const failed = results.filter(ok => !ok).length;
console.log(`CRM statistics: ${results.length - failed}/${results.length}`);
if (failed) process.exit(1);
