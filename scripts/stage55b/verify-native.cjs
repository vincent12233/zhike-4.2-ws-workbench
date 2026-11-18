'use strict';
// Read-back after the operator's real isolated WinUI actions. No business writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(process.argv[2] || '');
assert.equal(path.dirname(root).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
assert.match(path.basename(root), /^zhike-stage51-native-[a-f0-9]{32}$/);
assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
assert.equal(fs.readFileSync(path.join(root, '.stage51-isolated'), 'utf8'), 'zhike-stage51-isolated-ui-v1');
assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'stage55b-seed-evidence.json'), 'utf8')).synthetic, true);
const connection = JSON.parse(fs.readFileSync(path.join(root, 'connection.private.json'), 'utf8'));
assert.equal(connection.isolated, true); assert.equal(path.resolve(connection.root), root);
const endpoint = new URL(connection.endpoint);
assert.equal(endpoint.hostname, '127.0.0.1'); assert.equal(endpoint.protocol, 'http:');
async function get(route) {
  const response = await fetch(new URL(route, endpoint), { headers: { 'x-zhike-api-token': connection.apiToken, origin: endpoint.origin }, signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, route);
  return response.json();
}
(async () => {
  const state = await get('/api/state');
  assert.equal(state.customers.length, 2, 'Directory reads must not create CRM customers.');
  assert.equal(state.customers.find(row => row.id === 'C-native').occupation, '工程师');
  assert.equal(state.customers.find(row => row.id === 'C-native').language || '', '');
  assert.equal(state.customers.find(row => row.id === 'C-manual').occupation, '人工维护职业');
  const reviewed = (await get('/api/ws/ai-pipeline/suggestions?accountId=default')).suggestions;
  for (const expected of ['applied', 'rejected', 'conflict']) assert.ok(reviewed.some(row => row.verificationStatus === expected), expected);
  const other = (await get('/api/ws/ai-pipeline/suggestions?accountId=native-b')).suggestions;
  assert.ok(other.every(row => row.accountId === 'native-b' && row.verificationStatus === 'pending'), 'A review must not rewrite B suggestions.');
  const audit = await get('/api/ws/workspace/audit?accountId=default&pageSize=100');
  assert.ok(audit.rows.every(row => row.accountId === 'default' && row.category === 'audit'));
  const reviewActions = audit.rows.filter(row => /^suggestion\.(approve|reject|conflict)$/.test(row.action)).map(row => ({ action: row.action, outcome: row.outcome, source: row.source }));
  assert.ok(reviewActions.length >= 3, 'Real UI reviews must leave authoritative audit records; observed actions: ' + [...new Set(audit.rows.map(row => row.action))].join(', '));
  const contacts = await get('/api/ws/workspace/contacts?accountId=default&page=2');
  assert.equal(contacts.total, 49); assert.equal(contacts.page, 2); assert.equal(contacts.rows.length, 9);
  const duplicates = await get('/api/ws/workspace/contacts?accountId=default&duplicate=duplicate');
  assert.equal(duplicates.total, 2);
  const diagnostic = await get('/api/ws/workspace/audit?accountId=default&category=diagnostic');
  assert.equal(diagnostic.available, false); assert.equal(diagnostic.rows.length, 0);
  const evidence = { stage: '5.5B', verifiedAt: new Date().toISOString(), synthetic: true, mode: 'read-only-after-real-WinUI-actions', crmCustomerCount: 2, emptyFieldApproved: true, rejectedFieldUnchanged: true, manualFieldProtected: true, otherAccountSuggestionsUnchanged: true, reviewActions, contactsTotal: contacts.total, secondPageRows: contacts.rows.length, duplicateRows: duplicates.total, diagnosticUnavailable: true, productionOpened: false, realWs: false, paidAi: false };
  fs.writeFileSync(path.join(root, 'stage55b-business-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(evidence));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
