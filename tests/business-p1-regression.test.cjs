'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const rules = require('../resources/app/modules/business-rule-core.js');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'resources', 'app', 'app.js'), 'utf8');

// A: status changes append one event only.  The O(N) ledger projection runs
// once at the persistence boundary, not once per record inside bulk loops.
const recordStart = appSource.indexOf('function recordCustomerStatus(');
const recordEnd = appSource.indexOf('\n  function ', recordStart + 10);
const recordSource = appSource.slice(recordStart, recordEnd);
assert.ok(recordStart >= 0 && recordEnd > recordStart);
assert.doesNotMatch(recordSource, /syncBusinessRuleState|syncGroupMembershipLedger/, '单条状态记录不得触发全库同步');
const payloadLine = appSource.split(/\r?\n/).find(line => line.includes('function statePayload()')) || '';
assert.equal((payloadLine.match(/syncGroupMembershipLedger\(\)/g) || []).length, 1, '每次持久化只重建一次事件投影');

const makeCustomers = count => Array.from({ length: count }, (_, index) => ({
  id: `c-${index}`,
  source: index % 2 ? '单导' : 'WhatsApp群粉',
  group: `G-${index % 20}`,
  statusHistory: [{
    id: `s-${index}`,
    type: index % 3 ? 'joined' : 'left',
    to: index % 3 ? '在群' : '已退群',
    date: '2026-11-13',
    at: `2026-11-13T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
  }],
}));

rules.buildGroupMembershipLedger(makeCustomers(1000)); // warm up JIT
let projectionCalls = 0;
const project = customers => { projectionCalls++; return rules.buildGroupMembershipLedger(customers); };
const tenK = makeCustomers(10000);
let started = performance.now();
assert.equal(project(tenK).length, 10000);
const tenKMs = performance.now() - started;
assert.equal(projectionCalls, 1, '10k 批次只允许一次全量投影');
const fiftyK = makeCustomers(50000);
started = performance.now();
assert.equal(project(fiftyK).length, 50000);
const fiftyKMs = performance.now() - started;
assert.equal(projectionCalls, 2, '50k 批次累计只允许两次全量投影');
assert.ok(fiftyKMs < 8000, `50k 事件投影耗时过长：${fiftyKMs.toFixed(1)}ms`);
assert.ok(fiftyKMs <= Math.max(4000, tenKMs * 12 + 500), `事件投影增长异常：10k=${tenKMs.toFixed(1)}ms, 50k=${fiftyKMs.toFixed(1)}ms`);

// B: renaming through the general source list must keep the group-fan subtype
// list aligned, so the stable definition ID retains its group-fan type.
assert.match(appSource, /if\(key==='sources'\)\{const groupFanIndex=groupFanSources\.indexOf\(oldValue\);if\(groupFanIndex>=0\)groupFanSources\.splice\(groupFanIndex,1,value\);\}/);
let definitions = rules.reconcileSourceDefinitions([], ['WhatsApp群粉'], ['WhatsApp群粉']);
const stableId = definitions[0].id;
definitions = rules.renameSourceDefinition(definitions, 'WhatsApp群粉', '印度群粉', ['印度群粉']);
assert.equal(rules.resolveSourceDefinition('印度群粉', definitions).id, stableId);
assert.equal(rules.resolveSourceDefinition('印度群粉', definitions).type, 'group-fan');

// C: statusHistory is authoritative.  A stale derived event must disappear
// after rollback/removal instead of surviving as a phantom statistic.
const customerWithHistory = [{
  id: 'c-ledger', source: 'WhatsApp群粉', group: 'A-1',
  statusHistory: [{ id: 's-ledger', type: 'joined', to: '在群', date: '2026-11-13', at: '2026-11-13T00:00:00.000Z' }],
}];
const priorLedger = rules.buildGroupMembershipLedger(customerWithHistory);
assert.equal(priorLedger.length, 1);
assert.deepEqual(rules.buildGroupMembershipLedger([{ ...customerWithHistory[0], statusHistory: [] }], priorLedger), [], '撤销状态历史后不得保留 phantom 事件');

// D: inject a failed import after mutating all staged surfaces.  Rollback must
// restore customer fields, settings/ledger, and both source option arrays.
const state = {
  customers: [{ id: 'c-import', name: '原客户', source: '单导', statusHistory: [] }],
  settings: { importProfiles: [], groupMembershipEvents: [{ id: 'ledger-before' }] },
};
const customerSnapshots = new Map([['c-import', structuredClone(state.customers[0])]]);
const settingsBefore = structuredClone(state.settings);
const sources = ['单导'];
const sourcesBefore = [...sources];
const groupFanSources = ['群粉'];
const groupFanSourcesBefore = [...groupFanSources];
try {
  state.customers[0].name = '被导入覆盖';
  state.customers[0].statusHistory.push({ id: 'phantom' });
  state.settings.importProfiles.push({ signature: 'mutated' });
  state.settings.groupMembershipEvents.push({ id: 'phantom-ledger' });
  sources.push('临时渠道');
  groupFanSources.push('临时群粉');
  throw new Error('injected persistence failure');
} catch {
  assert.equal(rules.restoreImportStaging({ state, customerSnapshots, settingsBefore, sources, sourcesBefore, groupFanSources, groupFanSourcesBefore }), true);
}
assert.deepEqual(state.customers[0], { id: 'c-import', name: '原客户', source: '单导', statusHistory: [] });
assert.deepEqual(state.settings, settingsBefore);
assert.deepEqual(sources, sourcesBefore);
assert.deepEqual(groupFanSources, groupFanSourcesBefore);
assert.match(appSource, /if\(state\.customers\.length\+newCustomers\.length>250000\)\{restoreImportStaging\(\);/);
assert.match(appSource, /if\(state\.importIssues\.length\+issues\.length>100000\)\{restoreImportStaging\(\);/);
assert.match(appSource, /catch\{restoreImportStaging\(\);Object\.assign\(state,before\);/);

// Editing an existing deposit keeps row counts and IDs unchanged. Persisted
// data revision must still invalidate the customer/business summary cache.
const cacheStart = appSource.indexOf('function businessSummaryIndex(){');
const cacheEnd = appSource.indexOf('\n  function customerBusinessSummary', cacheStart);
assert.ok(cacheStart >= 0 && cacheEnd > cacheStart);
const cacheState = { dataRevision: 1, customers: [{ id: 'c-1' }], tickets: [], deposits: [{ id: 'd-1', amount: 100 }] };
let cacheBuilds = 0;
const cachedSummary = new Function('state', 'buildBusinessSummaryIndex', `let businessIndexCache=null;\n${appSource.slice(cacheStart, cacheEnd)}\nreturn businessSummaryIndex;`)(cacheState, () => {
  cacheBuilds++;
  return cacheState.deposits.reduce((sum, row) => sum + row.amount, 0);
});
assert.equal(cachedSummary(), 100);
cacheState.deposits[0].amount = 200;
cacheState.dataRevision++;
assert.equal(cachedSummary(), 200, '同数量同 ID 的入金编辑后，业务汇总必须刷新');
assert.equal(cacheBuilds, 2);

console.log(`business P1 regression: 10k ${tenKMs.toFixed(1)}ms, 50k ${fiftyKMs.toFixed(1)}ms; rollback/source/ledger pass`);
