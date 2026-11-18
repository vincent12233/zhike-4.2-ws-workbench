'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');
const { createServer } = require('node:net');
const { DatabaseSync } = require('node:sqlite');
const { createMockTransport } = require('../../resources/app/modules/ws-group-mock-transport.js');

const repo = path.resolve(__dirname, '..', '..');
const app = path.join(repo, 'resources', 'app');
const wait = ms => new Promise(r => setTimeout(r, ms));
async function port() { const s = createServer(); await new Promise((r, j) => { s.once('error', j); s.listen(0, '127.0.0.1', r); }); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
function start(root, p) { const token = 'stage5-business-isolated'; const child = spawn(process.execPath, ['server.mjs'], { cwd: app, windowsHide: true, env: { ...process.env, ZHIKE_DATA_DIR: root, ZHIKE_PORT: String(p), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token, ZHIKE_FENCING_MODE: 'isolated', ZHIKE_AI_PIPELINE_MODE: 'isolated', ZHIKE_STAGE4_MOCK: '1', ZHIKE_GROUP_MANAGER_MODE: 'isolated', ZHIKE_STAGE3_MOCK: '1' }, stdio: 'ignore' }); return { child, token }; }
async function stop(child) { if (child.exitCode !== null) return; child.kill('SIGTERM'); for (let i = 0; i < 120 && child.exitCode === null; i++) await wait(25); if (child.exitCode === null) child.kill('SIGKILL'); }
async function req(p, token, route, init = {}) { const headers = { origin: `http://127.0.0.1:${p}`, 'x-zhike-api-token': token, 'content-type': 'application/json', ...(init.headers || {}) }; for (let i = 0; i < 1200; i++) { try { const r = await fetch(`http://127.0.0.1:${p}${route}`, { ...init, headers }); return { response: r, value: await r.json() }; } catch { await wait(25); } } throw new Error('isolated stage5 server unavailable'); }
const post = (p, t, route, value, headers = {}) => req(p, t, route, { method: 'POST', headers, body: JSON.stringify(value) });
const get = (p, t, route) => req(p, t, route);
async function stateVersion(p, t) { return (await get(p, t, '/api/state/version')).value.version; }
async function putState(p, t, state) { return req(p, t, '/api/state', { method: 'PUT', headers: { 'x-state-version': String(await stateVersion(p, t)) }, body: JSON.stringify(state) }); }

(async () => {
  execFileSync(path.join(repo, '.tools/dotnet10/dotnet.exe'), ['build', path.join(__dirname, 'WorkerAiIntegration/WorkerAiIntegration.csproj'), '-c', 'Release', '--nologo', '-v:minimal'], { cwd: repo, windowsHide: true, encoding: 'utf8', timeout: 60000 });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-stage5-business-'));
  const p = await port(); const server = start(root, p); let stopped = false;
  try {
    const transport = createMockTransport({ fixtures: { default: { groups: [{ groupJid: '1203-stage5@g.us', name: 'Stage 5 群' }] }, 'account-b': { groups: [{ groupJid: '1203-stage5@g.us', name: 'Stage 5 群' }] } } });
    for (const account of transport.accounts()) { assert.equal(transport.connect(account).credentials, false); assert.equal(transport.heartbeat(account).ok, true); }
    await post(p, server.token, '/api/ws/accounts', { id: 'account-b', displayName: 'Stage 5 B' });
    await putState(p, server.token, { schemaVersion: 4, customers: [{ id: 'C-stage5', name: 'Stage 5 客户', rawPhone: '+91 90000 00001', phone: '919000000001', occupation: '', source: '', deleted: false }], settings: { operatingTasks: [], sourceDefinitions: [] }, activities: [], tickets: [], deposits: [], followups: [], registrations: [], phoneRegistry: [], batchOperations: [], importIssues: [], savedViews: [], channelAliases: {} });
    const group = { groupJid: '1203-stage5@g.us', name: 'Stage 5 群', channelId: 'stage5-channel', participantCount: 1 };
    assert.equal((await req(p, server.token, '/api/ws/group-manager/groups?accountId=default', { method: 'POST', body: JSON.stringify(group) })).response.status, 201);
    assert.equal((await req(p, server.token, '/api/ws/group-manager/groups?accountId=account-b', { method: 'POST', body: JSON.stringify(group) })).response.status, 201);
    const event = await post(p, server.token, '/api/ws/group-manager/members?accountId=default', { ...group, memberJid: '919000000001@s.whatsapp.net', type: 'joined', approvalStatus: 'confirmed', sourceEventId: 'stage5-member-1', correlationId: 'stage5-flow-1' });
    assert.equal(event.response.status, 201, JSON.stringify(event.value)); assert.ok(event.value.member?.memberJid); assert.equal(event.value.member.correlationId, 'stage5-flow-1');
    const state = (await get(p, server.token, '/api/state')).value; assert.equal(state.customers.length, 1, 'confirmed member must reuse the existing CRM customer');
    const captured = await post(p, server.token, '/api/ws/group-manager/messages?accountId=default', { groupJid: group.groupJid, messageId: 'stage5-msg', senderJid: event.value.member.memberJid, sourceEvidence: '我是一名工程师', type: 'text', correlationId: 'stage5-flow-1' });
    assert.equal(captured.response.status, 201, JSON.stringify(captured.value)); assert.equal(captured.value.message.correlationId, 'stage5-flow-1');
    const delivered = await post(p, server.token, '/api/ws/group-manager/read-evidence?accountId=default', { groupJid: group.groupJid, messageId: 'stage5-msg', memberJid: event.value.member.memberJid, status: 'delivered', evidence: 'mock-delivered' }); assert.equal(delivered.response.status, 200);
    const legacyDb = new DatabaseSync(path.join(root, 'workspace.sqlite'));
    try { legacyDb.prepare('UPDATE ws_group_read_evidence SET id=? WHERE id=?').run('legacy-stage4-read-evidence-id', delivered.value.evidence.id); } finally { legacyDb.close(); }
    const read = await post(p, server.token, '/api/ws/group-manager/read-evidence?accountId=default', { groupJid: group.groupJid, messageId: 'stage5-msg', memberJid: event.value.member.memberJid, status: 'read', evidence: 'mock-read' }); assert.equal(read.response.status, 200, JSON.stringify(read.value)); assert.equal(read.value.evidence.id, 'legacy-stage4-read-evidence-id');
    const conversation = await post(p, server.token, '/api/ws/conversations', { id: 'conv-stage5', accountId: 'default', externalId: 'stage5-conversation', title: 'Stage 5 客户', unreadCount: 0, data: { conversationType: 'direct', isGroup: false, historyLoaded: true, historyFingerprint: 'stage5-history', lastMessageFingerprint: 'stage5-history', directionVersion: 5 } }); assert.equal(conversation.response.status, 200, JSON.stringify(conversation.value));
    const lease = (await post(p, server.token, '/api/ws/fencing', { action: 'acquire', scopeKey: 'stage5-flow', ownerId: 'stage5-worker', leaseMs: 120000 })).value.lease;
    const jobBody = { accountId: 'default', conversationId: 'conv-stage5', customerId: 'C-stage5', jobType: 'customer_chat_analysis', idempotencyKey: 'stage5-job-1', sourceEventId: 'stage5-member-1', correlationId: 'stage5-flow-1', payload: { transcript: '我是一名工程师' }, lease };
    const job = await post(p, server.token, '/api/ws/ai-pipeline/jobs', jobBody); assert.equal(job.response.status, 201, JSON.stringify(job.value)); assert.equal(job.value.job.correlationId, 'stage5-flow-1');
    const claimed = await post(p, server.token, '/api/ws/ai-pipeline/jobs', { ...jobBody, action: 'claim', jobId: job.value.job.id, actor: 'stage5-worker' }); assert.equal(claimed.value.claimed, true);
    const worker = JSON.parse(execFileSync(path.join(__dirname, 'WorkerAiIntegration/bin/Release/net10.0-windows/WorkerAiIntegration.exe'), [], { input: JSON.stringify({ jobId: job.value.job.id, correlationId: 'stage5-flow-1', fixture: { profileFacts: { occupation: { value: '工程师', evidence: captured.value.message.sourceEvidence, confidence: 0.95, messageId: 'stage5-msg' } }, confidence: 0.95 } }), env: { ...process.env, ZHIKE_STAGE5_ISOLATED: '1', ZHIKE_STAGE5_TEST_NODE: path.join(app, 'node.exe') }, encoding: 'utf8', windowsHide: true, timeout: 30000 }));
    assert.equal(worker.ok, true); assert.equal(worker.transport, 'Windows Named Pipe'); assert.equal(worker.correlationId, 'stage5-flow-1'); assert.equal(worker.tempRootClean, true);
    const mockResult = worker.result;
    const complete = await post(p, server.token, '/api/ws/ai-pipeline/jobs', { ...jobBody, action: 'complete', jobId: job.value.job.id, leaseToken: claimed.value.job.leaseToken, result: mockResult }); assert.equal(complete.value.job.correlationId, 'stage5-flow-1');
    const evidence = await post(p, server.token, '/api/ws/ai-pipeline/evidence', { ...jobBody, jobId: job.value.job.id, quote: '我是一名工程师', sourceId: 'stage5-msg', messageId: 'stage5-msg' }); assert.equal(evidence.response.status, 201); assert.equal(evidence.value.evidence.correlationId, 'stage5-flow-1');
    const suggestions = await post(p, server.token, '/api/ws/ai-pipeline/suggestions', { ...jobBody, jobId: job.value.job.id, result: { profileFacts: { occupation: { value: '工程师', evidence: '我是一名工程师', confidence: 0.95, messageId: 'stage5-msg' } } }, idempotencyKey: 'stage5-suggestion-1' }); assert.equal(suggestions.response.status, 201); assert.equal(suggestions.value.suggestions[0].correlationId, 'stage5-flow-1');
    const suggestionId = suggestions.value.suggestions[0].id;
    const approved = await post(p, server.token, `/api/ws/ai-pipeline/suggestions/${encodeURIComponent(suggestionId)}/approve`, { ...jobBody, suggestionId, action: 'approve', actor: 'stage5-reviewer' }, { 'x-state-version': String(await stateVersion(p, server.token)) });
    assert.equal(approved.response.status, 200, JSON.stringify(approved.value)); assert.equal(approved.value.applied, true);
    assert.equal((await get(p, server.token, '/api/state')).value.customers.find(item => item.id === 'C-stage5').occupation, '工程师');
    const audit = await get(p, server.token, `/api/ws/ai-pipeline/audit?accountId=default&jobId=${encodeURIComponent(job.value.job.id)}`); assert.ok(audit.value.audit.some(item => item.action === 'suggestion.approve')); assert.ok(audit.value.audit.every(item => item.correlationId === 'stage5-flow-1'));
    const badCorrelation = await post(p, server.token, '/api/ws/ai-pipeline/evidence', { ...jobBody, jobId: job.value.job.id, quote: 'wrong-flow', correlationId: 'other-flow' }); assert.equal(badCorrelation.response.status, 409);
    const noOpReview = await post(p, server.token, '/api/ws/ai-pipeline/suggestions/' + suggestionId + '/reject', { ...jobBody, action: 'reject', suggestionId }); assert.equal(noOpReview.response.status, 200); assert.equal(noOpReview.value.suggestion.verificationStatus, 'applied');
    assert.equal((await get(p, server.token, `/api/ws/ai-pipeline/audit?accountId=default&jobId=${encodeURIComponent(job.value.job.id)}`)).value.audit.length, audit.value.audit.length, 'no-op review cannot fabricate an audit transition');
    const accountB = await post(p, server.token, '/api/ws/group-manager/members?accountId=account-b', { ...group, memberJid: '919000000002@s.whatsapp.net', type: 'joined', approvalStatus: 'confirmed', sourceEventId: 'stage5-member-b', correlationId: 'stage5-flow-b' }); assert.equal(accountB.response.status, 201);
    const bGroups = await get(p, server.token, '/api/ws/group-manager/members?accountId=account-b&groupJid=1203-stage5%40g.us'); assert.equal(bGroups.value.members.length, 1, 'second account keeps an isolated group membership ledger');
    const beforeShared = (await get(p, server.token, '/api/state')).value.customers.length;
    const shared = await post(p, server.token, '/api/ws/group-manager/members?accountId=account-b', { ...group, memberJid: '919000000001@s.whatsapp.net', type: 'joined', approvalStatus: 'confirmed', sourceEventId: 'stage5-shared-member', correlationId: 'stage5-flow-1' });
    assert.equal(shared.response.status, 201, JSON.stringify(shared.value)); assert.equal(shared.value.member.customerId, 'C-stage5'); assert.equal((await get(p, server.token, '/api/state')).value.customers.length, beforeShared);
    const wrongAccount = await post(p, server.token, '/api/ws/ai-pipeline/jobs', { ...jobBody, accountId: 'account-b', action: 'claim', jobId: job.value.job.id }); assert.equal(wrongAccount.response.status, 404);
    const unknown = await post(p, server.token, '/api/ws/ai-pipeline/suggestions', { ...jobBody, customerId: 'missing-customer', result: mockResult }); assert.equal(unknown.response.status, 409);
    const conflicting = await post(p, server.token, '/api/ws/ai-pipeline/suggestions', { ...jobBody, jobId: job.value.job.id, idempotencyKey: 'stage5-conflict', result: { profileFacts: { occupation: { value: '律师', evidence: 'I am a lawyer', confidence: 0.95 } } } });
    assert.equal(conflicting.response.status, 201); const conflictId = conflicting.value.suggestions[0].id;
    const conflict = await post(p, server.token, '/api/ws/ai-pipeline/suggestions/' + conflictId + '/approve', { ...jobBody, action: 'approve', suggestionId: conflictId }, { 'x-state-version': String(await stateVersion(p, server.token)) }); assert.equal(conflict.response.status, 200); assert.equal(conflict.value.applied, false); assert.equal(conflict.value.suggestion.verificationStatus, 'conflict');
    assert.equal((await get(p, server.token, '/api/state')).value.customers.find(item => item.id === 'C-stage5').occupation, '工程师');
    const leave = await post(p, server.token, '/api/ws/group-manager/members?accountId=account-b', { ...group, memberJid: '919000000001@s.whatsapp.net', type: 'left', sourceEventId: 'stage5-leave', correlationId: 'stage5-flow-1' }); assert.equal(leave.response.status, 200); assert.ok((await get(p, server.token, '/api/state')).value.customers.some(item => item.id === 'C-stage5'));
    transport.disconnect('account-b', 'isolated-offline'); assert.equal(transport.heartbeat('account-b').ok, false); transport.connect('account-b'); assert.equal(transport.heartbeat('account-b').ok, true);
    await post(p, server.token, '/api/shutdown', {}, { 'x-zhike-shutdown-token': server.token }); stopped = true;
  } finally { if (!stopped) { try { await post(p, server.token, '/api/shutdown', {}, { 'x-zhike-shutdown-token': server.token }); } catch {} } await stop(server.child); fs.rmSync(root, { recursive: true, force: true }); }
  console.log('stage5 business integration: two-account group isolation, correlation propagation, AI evidence and CRM chain PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
