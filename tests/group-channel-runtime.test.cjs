'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'resources', 'app', 'app.js'), 'utf8');
const between = (start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `cannot find production function ${start}`);
  return source.slice(from, to);
};
const customers = [
  { id: 'A', source: '群粉', channel: '渠道甲群粉', group: 'G-1', status: '在群', assistant: '助理甲' },
  { id: 'B', source: '群粉', channel: '渠道乙群粉', group: 'G-1', status: '已退群', assistant: '助理乙' },
];
const context = {
  sources: ['单导', '群粉', '渠道甲群粉', '渠道乙群粉', '空渠道'],
  groupFanSources: ['群粉', '渠道甲群粉', '渠道乙群粉'],
  state: { wsGroupMembershipEvents: [
    { type: 'joined', initial: false, source: '渠道甲群粉', subgroup: 'G-2' },
  ], settings: { groupMembershipEvents: [
    { type: 'joined', initial: false, source: '渠道甲群粉', subgroup: 'G-1' },
    { type: 'left', initial: false, source: '渠道乙群粉', subgroup: 'G-1' },
  ] } },
  activeCustomers: () => customers,
  canonicalBusinessSource: value => String(value || '').trim(),
  businessSummaryIndex: () => null,
  customerBusinessSummary: () => ({ ticket: false, deposit: false, amount: 0 }),
  normalizeObjectRows: value => Array.isArray(value) ? value : [],
  console,
};
const functions = between('  function effectiveCustomerSource(', '  function exposeImportSourceCatalog(')
  + between('  function groupMembershipEventRows(', '  function renderGroups(');
vm.runInNewContext(`${functions}\nthis.groupSummaryRows = groupSummaryRows;`, context);

const all = context.groupSummaryRows();
assert.equal(all.totalGroups, 3, 'same group number in two configured channels remains separate and server events add their own group row');
assert.equal(all.summary['渠道甲群粉'].customers, 1);
assert.equal(all.summary['渠道甲群粉'].joined, 1);
assert.equal(all.summary['渠道甲群粉'].eventJoined, 2);
assert.equal(all.summary['渠道乙群粉'].customers, 1);
assert.equal(all.summary['渠道乙群粉'].left, 1);
assert.equal(all.summary['渠道乙群粉'].eventLeft, 1);
assert.equal(all.summary['空渠道'].customers, 0, 'configured channels without customers are still displayed');
assert.equal(context.groupSummaryRows('', '渠道甲群粉').rows.length, 2);
assert.equal(context.groupSummaryRows('', '渠道乙群粉').rows.length, 1);
assert.equal(context.groupSummaryRows('', '群粉').rows.length, 0, 'broad group-fan category does not merge concrete channels');
assert.equal(all.summary['渠道甲群粉'].eventJoined, 2, 'server-backed membership events must join the local summary ledger');
assert.equal(all.rows.find(row => row.group === 'G-2' && row.source === '渠道甲群粉').eventJoined, 1, 'server-backed event must create its own group row');

console.log('group channel runtime: same group code remains separated by configured channel and join/leave counts');
