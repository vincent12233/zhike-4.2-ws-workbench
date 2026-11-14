'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'resources', 'app', 'app.js'), 'utf8');
const start = app.indexOf('  function horizonCustomerName(');
const end = app.indexOf('  function horizonNodeHtml(', start);
assert.ok(start >= 0 && end > start, 'the AI alert mapper must remain available');

const context = { String, Number, Math, Map, Array };
vm.runInNewContext(`${app.slice(start, end)}\nglobalThis.mapAlerts=horizonAlertItems;`, context);
const customers = new Map([
  ['first', { id: 'first', name: '客户甲', phone: '111' }],
  ['second', { id: 'second', name: '客户乙', phone: '222' }],
]);
const alerts = [
  { customerId: 'first', taskId: 'urgent', priorityScore: 60, reason: '今天必须处理' },
  { customerId: 'second', taskId: 'later', priorityScore: 95, reason: '后续处理' },
];
const mapped = context.mapAlerts(alerts, customers, new Map());
assert.deepEqual(Array.from(mapped, item => item.taskId), ['urgent', 'later'], 'the client must retain the server due-date and urgency order');
assert.deepEqual(Array.from(mapped, item => item.name), ['客户甲', '客户乙']);
assert.equal(mapped[0].reason, '今天必须处理');
assert.doesNotMatch(app, /本地优先级|显示本地优先级/, 'the AI display must never fall back to a local CRM ranking');

console.log('home AI priority: truthful source and server alert order passed');
