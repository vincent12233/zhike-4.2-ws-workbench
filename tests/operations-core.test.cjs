'use strict';

const assert = require('node:assert/strict');
const {
  validDate,
  createTask,
  taskDismissed,
  taskCompleted,
  taskDone,
  taskBucket,
  selectTasks,
  applyFollowupAction,
  stageColumns,
} = require('../resources/app/modules/operations-core.cjs');

let assertions = 0;
function equal(actual, expected, message) { assert.equal(actual, expected, message); assertions += 1; }
function deepEqual(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions += 1; }
function throws(callback, matcher, message) { assert.throws(callback, matcher, message); assertions += 1; }

equal(validDate('2026-11-03'), true);
equal(validDate('2026-02-30'), false);

const customers = [
  { id: 'C1', phase: '新客户', deleted: false },
  { id: 'C2', phase: '高意向', deleted: false },
  { id: 'C3', phase: '新客户', deleted: true },
];
throws(() => createTask({ title: '回访', due: '2026-02-30' }, customers), /日期无效/);

const tasks = [
  { id: 'future', title: '未来人工任务', due: '2026-11-04', owner: '小王', priority: 'normal', done: false },
  { id: 'today-low', title: '今日普通任务', due: '2026-11-03', owner: '小李', priority: 'low', done: false },
  { id: 'today-ai', title: '跟进 约翰', due: '2026-11-03', owner: '小李', priority: 'high', priorityScore: 88, aiGenerated: true, customerName: '约翰', phone: '9876543210', objective: '确认投资预算', suggestedOpener: '今天市场怎么样', talkingPoints: ['工作', '股票'], scoreReason: '资金实力较强', done: false },
  { id: 'overdue-low', title: '逾期任务', due: '2026-11-02', owner: '小王', priority: 'low', priorityScore: 20, aiGenerated: true, done: false },
  { id: 'done', title: '已完成', due: '2026-11-01', owner: '小王', done: true, updatedAt: '2026-11-03T10:00:00Z' },
];

deepEqual(selectTasks(tasks, {}, '2026-11-03').map(task => task.id), ['overdue-low', 'today-ai', 'today-low', 'future', 'done'], '应先逾期、再今日，同日再按优先级与 AI 分数排序');
deepEqual(selectTasks(tasks, { bucket: 'today' }, '2026-11-03').map(task => task.id), ['today-ai', 'today-low']);
deepEqual(selectTasks(tasks, { bucket: 'overdue' }, '2026-11-03').map(task => task.id), ['overdue-low']);
deepEqual(selectTasks(tasks, { status: 'done' }, '2026-11-03').map(task => task.id), ['done']);
deepEqual(selectTasks(tasks, { aiOnly: true }, '2026-11-03').map(task => task.id), ['overdue-low', 'today-ai']);
deepEqual(selectTasks(tasks, { owner: '小李' }, '2026-11-03').map(task => task.id), ['today-ai', 'today-low']);
deepEqual(selectTasks(tasks, { search: '9876543210' }, '2026-11-03').map(task => task.id), ['today-ai'], '搜索应包含客户号码');
deepEqual(selectTasks(tasks, { search: '投资预算' }, '2026-11-03').map(task => task.id), ['today-ai'], '搜索应包含目标');
deepEqual(selectTasks(tasks, { search: '资金实力' }, '2026-11-03').map(task => task.id), ['today-ai'], '搜索应包含评分依据');
deepEqual(selectTasks(tasks, { search: '股票' }, '2026-11-03').map(task => task.id), ['today-ai'], '搜索应包含话题数组');
deepEqual(selectTasks(tasks, { search: 'today-ai' }, '2026-11-03').map(task => task.id), ['today-ai'], '搜索应包含任务 ID，便于首页精确定位');

const dismissedTask = { id: 'dismissed', title: '已忽略的旧提醒', status: 'dismissed', done: true, updatedAt: '2026-11-03T11:00:00Z' };
equal(taskDismissed(dismissedTask), true);
equal(taskCompleted(dismissedTask), false, '已忽略任务不能计入真实完成');
equal(taskDone(dismissedTask), true, '已忽略任务仍是关闭状态并支持重新打开');
equal(taskCompleted({ done: true }), true, '原有人工任务完成语义保持兼容');
deepEqual(selectTasks([...tasks, dismissedTask], { status: 'done' }, '2026-11-03').map(task => task.id), ['done'], '已完成筛选不得混入已忽略提醒');
deepEqual(selectTasks([...tasks, dismissedTask], { status: 'dismissed' }, '2026-11-03').map(task => task.id), ['dismissed'], '已忽略提醒必须可以单独筛选');
deepEqual(selectTasks([...tasks, dismissedTask], { status: 'open' }, '2026-11-03').map(task => task.id), ['overdue-low', 'today-ai', 'today-low', 'future'], '待处理筛选不得恢复已忽略提醒');
equal(taskBucket(tasks[3], '2026-11-03'), 'overdue');

const baseAiTask = { id: 'ai-action', aiGenerated: true, due: '2026-11-03', done: false, status: 'open' };
const completed = applyFollowupAction(baseAiTask, 'complete', { now: '2026-11-03T12:00:00Z' });
equal(completed.done, true);
equal(completed.status, 'done');
equal(completed.completedAt, '2026-11-03T12:00:00Z');
const snoozed = applyFollowupAction(baseAiTask, 'snooze', { due: '2026-11-04', now: '2026-11-03T12:00:00Z' });
equal(snoozed.due, '2026-11-04');
equal(snoozed.status, 'snoozed');
const dismissed = applyFollowupAction(baseAiTask, 'dismiss', { now: '2026-11-03T12:00:00Z' });
equal(dismissed.done, true);
equal(dismissed.status, 'dismissed');
const reopened = applyFollowupAction(dismissed, 'reopen', { now: '2026-11-03T13:00:00Z' });
equal(reopened.done, false);
equal(reopened.status, 'open');
throws(() => applyFollowupAction(baseAiTask, 'snooze', { due: '2026-02-30' }), /日期无效/);

deepEqual(stageColumns(customers, ['新客户', '高意向']).map(column => [column.name, column.customers.length]), [['新客户', 1], ['高意向', 1]]);

console.log(`operations-core: ${assertions} assertions passed`);
