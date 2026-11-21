// Loaded by the sidecar and tests (require) and by index.html as a classic
// script. The function scope keeps its helpers out of the page's global
// scope; only ZhikeOperationsCore (and module.exports in Node) is exposed.
(function () {
'use strict';

function validDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function createTask(input = {}, customers = [], meta = {}) {
  const title = String(input.title || '').trim();
  if (!title || title.length > 120) throw new Error('任务标题不能为空且最多 120 个字符');
  const due = String(input.due || '');
  if (due && !validDate(due)) throw new Error('任务日期无效');
  const customerId = String(input.customerId || '');
  if (customerId && !customers.some(customer => String(customer.id) === customerId && !customer.deleted)) throw new Error('关联客户不存在');
  const now = meta.now || new Date().toISOString();
  return {
    id: String(input.id || `T-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
    title,
    due,
    customerId,
    owner: String(input.owner || '未分配'),
    priority: ['high', 'normal', 'low'].includes(input.priority) ? input.priority : 'normal',
    note: String(input.note || '').slice(0, 2000),
    done: Boolean(input.done),
    createdAt: now,
    updatedAt: now,
  };
}

function taskDismissed(task) {
  return ['dismissed', 'ignored'].includes(String(task?.status || '').toLowerCase());
}

function taskCompleted(task) {
  if (taskDismissed(task)) return false;
  return Boolean(task?.done) || ['done', 'completed', 'closed'].includes(String(task?.status || '').toLowerCase());
}

function taskDone(task) {
  return taskCompleted(task) || taskDismissed(task);
}

function taskBucket(task, today = '') {
  if (taskDone(task)) return 'done';
  if (!validDate(task?.due)) return 'unscheduled';
  if (today && task.due < today) return 'overdue';
  if (today && task.due === today) return 'today';
  return 'upcoming';
}

function taskSearchValues(task) {
  const arrays = [task?.talkingPoints, task?.avoidTopics, task?.tags]
    .flatMap(value => Array.isArray(value) ? value : []);
  return [
    task?.id, task?.title, task?.owner, task?.note, task?.objective, task?.suggestedOpener,
    task?.scoreReason, task?.qualificationReason, task?.engagementReason,
    task?.customerName, task?.customer, task?.phone, task?.rawPhone,
    task?.externalId, task?.customerId, task?.wsConversationId, task?.wsFollowupKey,
    ...arrays,
  ];
}

function compareTasks(a, b, today = '') {
  const bucketRank = { overdue: 0, today: 1, upcoming: 2, unscheduled: 3, done: 4 };
  const aBucket = taskBucket(a, today);
  const bBucket = taskBucket(b, today);
  const bucketDifference = (bucketRank[aBucket] ?? 9) - (bucketRank[bBucket] ?? 9);
  if (bucketDifference) return bucketDifference;

  if (aBucket === 'done') {
    const completedDifference = String(b.completedAt || b.dismissedAt || b.updatedAt || '').localeCompare(String(a.completedAt || a.dismissedAt || a.updatedAt || ''));
    if (completedDifference) return completedDifference;
  }

  const priorityRank = { high: 0, normal: 1, low: 2 };
  const priorityDifference = (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1);
  if (priorityDifference) return priorityDifference;

  const scoreDifference = Number(b.priorityScore ?? -1) - Number(a.priorityScore ?? -1);
  if (scoreDifference) return scoreDifference;

  const aiDifference = Number(Boolean(b.aiGenerated)) - Number(Boolean(a.aiGenerated));
  if (aiDifference) return aiDifference;

  const dueDifference = String(a.due || '9999-12-31').localeCompare(String(b.due || '9999-12-31'));
  if (dueDifference) return dueDifference;

  const updatedDifference = String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
  if (updatedDifference) return updatedDifference;
  return String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN');
}

function selectTasks(tasks = [], query = {}, today = '') {
  const search = String(query.search || '').trim().toLocaleLowerCase();
  const owner = String(query.owner || '').trim();
  const aiOnly = query.aiOnly === true || query.source === 'ai';
  const bucket = String(query.bucket || '');
  return tasks
    .filter(task => {
      const done = taskDone(task);
      if (query.status === 'done' && !taskCompleted(task)) return false;
      if (query.status === 'dismissed' && !taskDismissed(task)) return false;
      if (query.status === 'open' && done) return false;
      if (search && !taskSearchValues(task).some(value => String(value || '').toLocaleLowerCase().includes(search))) return false;
      if (aiOnly && !task.aiGenerated) return false;
      if (owner && owner !== '全部' && String(task.owner || '未分配') !== owner) return false;
      if (bucket === 'today' && taskBucket(task, today) !== 'today') return false;
      if (bucket === 'overdue' && taskBucket(task, today) !== 'overdue') return false;
      return true;
    })
    .sort((a, b) => compareTasks(a, b, today));
}

function applyFollowupAction(task = {}, action = '', meta = {}) {
  const now = String(meta.now || new Date().toISOString());
  if (action === 'complete') return { ...task, done: true, status: 'done', completedAt: now, updatedAt: now };
  if (action === 'snooze') {
    const due = String(meta.due || '');
    if (!validDate(due)) throw new Error('延期日期无效');
    return { ...task, done: false, status: 'snoozed', due, snoozedUntil: String(meta.snoozedUntil || ''), updatedAt: now };
  }
  if (action === 'dismiss') return { ...task, done: true, status: 'dismissed', dismissedAt: now, updatedAt: now };
  if (action === 'reopen') return { ...task, done: false, status: 'open', completedAt: '', dismissedAt: '', updatedAt: now };
  throw new Error('不支持的跟进任务操作');
}

function stageColumns(customers = [], stages = []) {
  const names = [...new Set([...stages, ...customers.map(customer => String(customer.phase || '未设置'))].filter(Boolean))];
  return names.map(name => ({ name, customers: customers.filter(customer => !customer.deleted && String(customer.phase || '未设置') === name) }));
}

const api = { validDate, createTask, taskDismissed, taskCompleted, taskDone, taskBucket, compareTasks, selectTasks, applyFollowupAction, stageColumns };
if (typeof module !== 'undefined') module.exports = api;
if (typeof globalThis !== 'undefined') globalThis.ZhikeOperationsCore = api;
})();
