'use strict';

// Real sidecar integration for the isolated Stage 4 API. The process uses a
// temporary data root, explicit mock/fencing gates and a random local port;
// it never opens production SQLite, real WS credentials or a paid AI provider.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createServer: createTcpServer } = require('node:net');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const app = path.join(repo, 'resources', 'app');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function freePort() {
  const probe = createTcpServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const address = probe.address();
  const port = Number(address && typeof address === 'object' ? address.port : 0);
  await new Promise(resolve => probe.close(resolve));
  if (!port) throw new Error('failed to allocate a test port');
  return port;
}

function startServer(dataDir, port, isolated) {
  const token = `stage4-api-${isolated ? 'isolated' : 'disabled'}`;
  const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
    cwd: app,
    windowsHide: true,
    env: {
      ...process.env,
      ZHIKE_DATA_DIR: dataDir,
      ZHIKE_PORT: String(port),
      ZHIKE_API_TOKEN: token,
      ZHIKE_SHUTDOWN_TOKEN: token,
      ...(isolated ? { ZHIKE_FENCING_MODE: 'isolated', ZHIKE_AI_PIPELINE_MODE: 'isolated', ZHIKE_STAGE4_MOCK: '1' } : {}),
    },
    stdio: 'ignore',
  });
  return { child, token };
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  for (let attempt = 0; attempt < 160 && child.exitCode === null; attempt += 1) await wait(25);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function request(port, token, pathname, init = {}) {
  const headers = { origin: `http://127.0.0.1:${port}`, 'x-zhike-api-token': token, 'content-type': 'application/json', ...(init.headers || {}) };
  for (let attempt = 0; attempt < 1200; attempt += 1) {
    try { return await fetch(`http://127.0.0.1:${port}${pathname}`, { ...init, headers }); }
    catch { await wait(50); }
  }
  throw new Error('stage4 sidecar did not become available');
}

async function readJson(response) { return { response, value: await response.json() }; }
async function post(port, token, pathname, payload, headers = {}) { return readJson(await request(port, token, pathname, { method: 'POST', headers, body: JSON.stringify(payload) })); }
async function stateVersion(port, token) { return (await readJson(await request(port, token, '/api/state/version'))).value.version; }
async function putState(port, token, value) {
  const version = await stateVersion(port, token);
  return readJson(await request(port, token, '/api/state', { method: 'PUT', headers: { 'x-state-version': version }, body: JSON.stringify(value) }));
}
function stateWith(customers) {
  return { schemaVersion: 4, customers, settings: { operatingTasks: [], sourceDefinitions: [] }, activities: [], tickets: [], deposits: [], followups: [], registrations: [], phoneRegistry: [], batchOperations: [], importIssues: [], savedViews: [], channelAliases: {} };
}
function customer(id, phone, extra = {}) {
  return { id, name: id, rawPhone: phone, phone, source: '', status: '未进群', phase: '新客户', deleted: false, ...extra };
}

(async () => {
  const disabledRoot = mkdtempSync(path.join(os.tmpdir(), 'zhike-stage4-api-disabled-'));
  const disabledPort = await freePort();
  const disabled = startServer(disabledRoot, disabledPort, false);
  try {
    const blocked = await readJson(await request(disabledPort, disabled.token, '/api/ws/ai-pipeline/jobs?accountId=default'));
    assert.equal(blocked.response.status, 404);
    assert.equal(blocked.value.code, 'AI_PIPELINE_DISABLED');
  } finally { await stopServer(disabled.child); rmSync(disabledRoot, { recursive: true, force: true }); }

  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-stage4-api-'));
  const port = await freePort();
  const isolated = startServer(dataDir, port, true);
  let shutdown = false;
  try {
    const put = await putState(port, isolated.token, stateWith([customer('C-stage4', '+91 98765 43210', { occupation: '' })]));
    assert.equal(put.response.status, 200, JSON.stringify(put.value));
    const persistedState = await readJson(await request(port, isolated.token, '/api/state'));
    assert.equal(persistedState.value.customers.length, 1, JSON.stringify(persistedState.value));
    const conversation = await post(port, isolated.token, '/api/ws/conversations', {
      id: 'conv-stage4', accountId: 'default', externalId: 'stage4-direct-1', title: 'Stage 4 测试客户', unreadCount: 0,
      data: { conversationType: 'direct', isGroup: false, vipGroup: false, historyLoaded: true, historyFingerprint: 'stage4-history', lastMessageFingerprint: 'stage4-history', directionVersion: 4 },
    });
    assert.equal(conversation.response.status, 200);

    const leaseResponse = await post(port, isolated.token, '/api/ws/fencing', { action: 'acquire', scopeKey: 'stage4-ai-api', ownerId: 'worker-a', leaseMs: 120000 });
    assert.equal(leaseResponse.response.status, 200);
    const lease = leaseResponse.value.lease;
    assert.ok(lease && lease.fencingToken > 0 && lease.leaseId);

    const enqueueBody = { accountId: 'default', conversationId: 'conv-stage4', jobType: 'customer_chat_analysis', idempotencyKey: 'stage4-job-1', sourceMessageId: 'msg-stage4-1', payload: { transcript: 'isolated fixture' }, lease };
    const enqueued = await post(port, isolated.token, '/api/ws/ai-pipeline/jobs', enqueueBody);
    assert.equal(enqueued.response.status, 201);
    assert.equal(enqueued.value.job.status, 'pending');
    const duplicate = await post(port, isolated.token, '/api/ws/ai-pipeline/jobs', enqueueBody);
    assert.equal(duplicate.response.status, 200);
    assert.equal(duplicate.value.existed, true);
    const jobId = enqueued.value.job.id;

    const claimed = await post(port, isolated.token, '/api/ws/ai-pipeline/jobs', { ...enqueueBody, action: 'claim', jobId, actor: 'worker-a' });
    assert.equal(claimed.response.status, 200);
    assert.equal(claimed.value.claimed, true);
    assert.equal(claimed.value.job.status, 'running');
    const leaseToken = claimed.value.job.leaseToken;
    assert.ok(leaseToken);

    const checkpoint = await post(port, isolated.token, '/api/ws/ai-pipeline/jobs', { ...enqueueBody, action: 'checkpoint', jobId, leaseToken, completedChunks: 1, chunkCount: 2, cursor: 'msg-stage4-1' });
    assert.equal(checkpoint.response.status, 200);
    assert.equal(checkpoint.value.job.checkpoint.completedChunks, 1);
    const checkpointRegression = await post(port, isolated.token, '/api/ws/ai-pipeline/jobs', { ...enqueueBody, action: 'checkpoint', jobId, leaseToken, completedChunks: 0, chunkCount: 2, cursor: 'msg-stage4-0' });
    assert.equal(checkpointRegression.response.status, 400);

    const cancelled = await post(port, isolated.token, '/api/ws/ai-pipeline/jobs', { ...enqueueBody, action: 'cancel', jobId, leaseToken, reason: '隔离取消测试' });
    assert.equal(cancelled.response.status, 200);
    assert.equal(cancelled.value.job.status, 'cancelled');
    const staleComplete = await post(port, isolated.token, '/api/ws/ai-pipeline/jobs', { ...enqueueBody, action: 'complete', jobId, leaseToken, result: { profileFacts: {}, evidence: [] } });
    assert.equal(staleComplete.response.status, 409);

    const retried = await post(port, isolated.token, '/api/ws/ai-pipeline/jobs', { ...enqueueBody, action: 'retry', jobId, reason: '隔离重试测试' });
    assert.equal(retried.response.status, 200);
    assert.equal(retried.value.retried, true);
    const claimedAgain = await post(port, isolated.token, '/api/ws/ai-pipeline/jobs', { ...enqueueBody, action: 'claim', jobId, actor: 'worker-a' });
    assert.equal(claimedAgain.value.claimed, true);
    const leaseTokenAgain = claimedAgain.value.job.leaseToken;
    const result = { confidence: 0.91, profileFacts: { occupation: { value: '工程师', evidence: '我是一名工程师', confidence: 0.91, messageId: 'msg-stage4-1' } }, evidence: [{ field: 'occupation', value: '工程师', text: '我是一名工程师', messageId: 'msg-stage4-1' }] };
    const completed = await post(port, isolated.token, '/api/ws/ai-pipeline/jobs', { ...enqueueBody, action: 'complete', jobId, leaseToken: leaseTokenAgain, result, confidence: 0.91 });
    assert.equal(completed.response.status, 200);
    assert.equal(completed.value.job.status, 'completed');
    assert.ok(completed.value.analysisId);

    const evidence = await post(port, isolated.token, '/api/ws/ai-pipeline/evidence', { ...enqueueBody, jobId, quote: '我是一名工程师', sourceType: 'message', sourceId: 'msg-stage4-1', messageId: 'msg-stage4-1' });
    assert.equal(evidence.response.status, 201);
    assert.equal(evidence.value.evidence.quote, '我是一名工程师');
    const suggestions = await post(port, isolated.token, '/api/ws/ai-pipeline/suggestions', { ...enqueueBody, jobId, customerId: 'C-stage4', conversationId: 'conv-stage4', result, idempotencyKey: 'stage4-suggestion-1' });
    assert.equal(suggestions.response.status, 201);
    assert.equal(suggestions.value.suggestions.length, 1);
    assert.equal(suggestions.value.suggestions[0].customerId, 'C-stage4', JSON.stringify(suggestions.value));
    const suggestionId = suggestions.value.suggestions[0].id;
    const stateBeforeApprove = await stateVersion(port, isolated.token);
    const approved = await post(port, isolated.token, `/api/ws/ai-pipeline/suggestions/${encodeURIComponent(suggestionId)}/approve`, { ...enqueueBody, action: 'approve', suggestionId, lease, actor: 'operator' }, { 'x-state-version': stateBeforeApprove });
    assert.equal(approved.response.status, 200);
    assert.equal(approved.value.applied, true);
    const afterState = await readJson(await request(port, isolated.token, '/api/state'));
    if (afterState.value.customers.find(item => item.id === 'C-stage4').occupation !== '工程师') console.log('approval payload', approved.value, afterState.value.customers.find(item => item.id === 'C-stage4'));
    assert.equal(afterState.value.customers.find(item => item.id === 'C-stage4').occupation, '工程师');

    const unknown = await post(port, isolated.token, '/api/ws/ai-pipeline/suggestions', { ...enqueueBody, customerId: 'C-unknown', result });
    assert.equal(unknown.response.status, 409);
    assert.equal(unknown.value.code, 'CRM_CUSTOMER_REQUIRED');
    const audit = await readJson(await request(port, isolated.token, `/api/ws/ai-pipeline/audit?accountId=default&jobId=${encodeURIComponent(jobId)}`));
    assert.equal(audit.response.status, 200);
    assert.ok(audit.value.audit.some(item => item.action === 'complete'));

    const shutdownResponse = await post(port, isolated.token, '/api/shutdown', {}, { 'x-zhike-shutdown-token': isolated.token });
    assert.equal(shutdownResponse.response.status, 200);
    shutdown = true;
  } finally {
    if (!shutdown) { try { await post(port, isolated.token, '/api/shutdown', {}, { 'x-zhike-shutdown-token': isolated.token }); } catch {} }
    await stopServer(isolated.child);
    rmSync(dataDir, { recursive: true, force: true });
  }
  console.log('stage4 isolated AI queue, fencing, evidence, CRM review and rollback boundaries: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
