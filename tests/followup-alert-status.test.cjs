'use strict';
// V5.0 §18 reminder states and time confirmation.
const assert = require('node:assert/strict');
const sync = require('../resources/app/modules/ws-crm-sync-core.js');

const results = [];
function check(name, fn) {
  try { fn(); results.push(true); console.log('PASS ' + name); }
  catch (error) { results.push(false); console.log('FAIL ' + name + ' :: ' + error.message); }
}
const plan = (overrides = {}) => sync.deriveFollowupPlan({
  confidence: 0.9,
  summary: '客户询问开户流程，希望尽快了解。',
  intentScore: 80,
  followupStrategy: { shouldFollowUp: true, reason: '客户有明确需求', objective: '发送开户资料' },
  ...overrides,
}, { id: 'A1' }, { id: 'C1', externalId: '9198@c.us' }, 'acc');

check('an explicitly stated date is a confirmed time', () => {
  const result = plan({ followupStrategy: { shouldFollowUp: true, reason: '约好联系', bestTime: '2026-11-25' } });
  assert.equal(result.nextDate, '2026-11-25');
  assert.equal(result.timeConfirmed, true);
  assert.equal(result.timeSource, 'ai-explicit');
});
check('a cadence default is a suggestion, not an agreed date', () => {
  const result = plan();
  assert.ok(result.nextDate, 'a reminder date exists so the lead is not lost');
  assert.equal(result.timeConfirmed, false);
  assert.equal(result.timeSource, 'suggested-cadence');
});
check('fuzzy wording never becomes a definite date', () => {
  for (const bestTime of ['下周有空再说', '过几天', '下个月', '改天聊', '有空的时候']) {
    assert.equal(sync.normalizeDate(bestTime), '', bestTime);
    const result = plan({ followupStrategy: { shouldFollowUp: true, reason: '客户说再看', bestTime } });
    assert.equal(result.timeConfirmed, false, bestTime);
  }
});
check('pending when a confirmed date is future or today', () => {
  const future = sync.followupAlertStatus({ status: 'open', followupTime: '2099-01-01', data: { timeConfirmed: true } });
  assert.equal(future.key, 'pending');
  assert.equal(future.label, '待处理');
  assert.equal(future.overdue, false);
});
check('overdue is derived from a past date and is never stored', () => {
  const row = { status: 'open', followupTime: '2020-01-01', data: { timeConfirmed: true } };
  assert.equal(sync.followupAlertStatus(row).key, 'overdue');
  assert.equal(sync.followupAlertStatus(row).label, '逾期');
  assert.equal(row.status, 'open', 'the row is not mutated');
});
check('a completed or cancelled reminder is never shown as overdue', () => {
  assert.equal(sync.followupAlertStatus({ status: 'done', followupTime: '2020-01-01', data: {} }).label, '已完成');
  assert.equal(sync.followupAlertStatus({ status: 'dismissed', followupTime: '2020-01-01', data: {} }).label, '已取消');
  assert.equal(sync.followupAlertStatus({ status: 'cancelled', followupTime: '', data: {} }).label, '已取消');
});
check('an unconfirmed suggestion shows as 待确认', () => {
  const result = sync.followupAlertStatus({ status: 'open', followupTime: '2099-01-01', data: { timeConfirmed: false } });
  assert.equal(result.key, 'review');
  assert.equal(result.label, '待确认');
  assert.equal(result.confirmed, false);
  assert.equal(sync.followupAlertStatus({ status: 'review', followupTime: '', data: {} }).label, '待确认');
});
check('the five required states are all reachable', () => {
  const labels = [
    sync.followupAlertStatus({ status: 'open', followupTime: '2099-01-01', data: {} }),
    sync.followupAlertStatus({ status: 'open', followupTime: '2020-01-01', data: {} }),
    sync.followupAlertStatus({ status: 'done' }),
    sync.followupAlertStatus({ status: 'dismissed' }),
    sync.followupAlertStatus({ status: 'open', data: { timeConfirmed: false } }),
  ].map(item => item.label);
  assert.deepEqual([...new Set(labels)].sort(), ['已完成', '已取消', '待处理', '待确认', '逾期'].sort());
});

const failed = results.filter(ok => !ok).length;
console.log(`Follow-up reminder states: ${results.length - failed}/${results.length}`);
if (failed) process.exit(1);
