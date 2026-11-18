'use strict';
// Read back the real isolated service after native operator actions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(process.argv[2] || '');
assert.equal(path.dirname(root).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
assert.match(path.basename(root), /^zhike-stage51-native-[a-f0-9]{32}$/);
assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
assert.equal(fs.readFileSync(path.join(root, '.stage51-isolated'), 'utf8'), 'zhike-stage51-isolated-ui-v1');
const connection = JSON.parse(fs.readFileSync(path.join(root, 'connection.private.json'), 'utf8'));
assert.equal(connection.isolated, true); assert.equal(path.resolve(connection.root), root);
const endpoint = new URL(connection.endpoint);
assert.equal(endpoint.hostname, '127.0.0.1'); assert.equal(endpoint.protocol, 'http:');
const headers = { 'x-zhike-api-token': connection.apiToken, origin: endpoint.origin };
async function get(route) {
  const response = await fetch(new URL(route, endpoint), { headers });
  assert.equal(response.status, 200, route);
  return response.json();
}
(async () => {
  const state = await get('/api/state');
  assert.equal(state.customers.length, 2);
  const customer = state.customers.find(row => row.id === 'C-native');
  const manual = state.customers.find(row => row.id === 'C-manual');
  assert.equal(customer.occupation, '工程师');
  assert.equal(customer.language || '', '');
  assert.equal(manual.occupation, '人工维护职业');
  const candidates = await get('/api/ws/ai-pipeline/suggestions?accountId=native-b');
  const suggestions = candidates.suggestions;
  assert.equal(suggestions.length, 3);
  assert.deepEqual(suggestions.map(row => row.verificationStatus).sort(), ['applied', 'conflict', 'rejected']);
  const jobResult = await get('/api/ws/ai-pipeline/jobs?accountId=native-b');
  const jobs = jobResult.jobs;
  assert.equal(jobs.find(row => row.jobType === '隔离任务-pending').status, 'cancelled');
  assert.equal(jobs.find(row => row.jobType === '隔离任务-failed').status, 'queued');
  const auditResult = await get('/api/ws/ai-pipeline/audit?accountId=native-b');
  const audit = auditResult.audit;
  for (const action of ['suggestion.approve', 'suggestion.reject', 'suggestion.conflict']) {
    assert.equal(audit.filter(row => row.action === action).length, 1, action);
  }
  assert.ok(audit.every(row => row.accountId === 'native-b'));
  const other = await get('/api/ws/ai-pipeline/suggestions?accountId=default');
  assert.equal(other.suggestions.length, 3);
  assert.ok(other.suggestions.every(row => row.verificationStatus === 'pending'));
  const members = await get('/api/ws/group-manager/members?accountId=native-b');
  assert.equal(members.members.length, 2);
  assert.equal(new Set(members.members.map(row => row.groupJid)).size, 2);
  assert.ok(members.members.every(row => row.customerId === 'C-native'));
  console.log(JSON.stringify({ status: 'Passed', source: 'real isolated service readback after native UI actions', customerCount: 2, occupationApplied: true, rejectedLanguageStillEmpty: true, manualFieldPreserved: true, candidateStatuses: suggestions.map(row => row.verificationStatus).sort(), retryQueued: true, pendingCancelled: true, auditActionsExactlyOnce: ['suggestion.approve', 'suggestion.reject', 'suggestion.conflict'], otherAccountCandidatesUnchanged: true, sameCustomerInTwoGroups: true, productionOpened: false, realWsConnected: false }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
