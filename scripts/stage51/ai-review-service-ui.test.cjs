'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const { randomUUID } = require('node:crypto');
const repo = path.resolve(__dirname, '../..'), app = path.join(repo, 'resources/app');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() { const server = createServer(); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-stage51-review-ui-'));
  const port = await freePort(), token = randomUUID();
  const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], { cwd: app, windowsHide: true, stdio: 'ignore', env: { ...process.env, ZHIKE_DATA_DIR: root, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token, ZHIKE_FENCING_MODE: 'isolated', ZHIKE_AI_PIPELINE_MODE: 'isolated', ZHIKE_STAGE4_MOCK: '1' } });
  const send = (route, init = {}) => fetch('http://127.0.0.1:' + port + route, { ...init, headers: { 'Content-Type': 'application/json', 'X-Zhike-Api-Token': token, origin: 'http://127.0.0.1:' + port, ...(init.headers || {}) } });
  const request = async (route, init = {}) => {
    const response = await send(route, init);
    const value = await response.json(); return { response, value };
  };
  const post = (route, body, headers) => request(route, { method: 'POST', headers, body: JSON.stringify(body) });
  try {
    for (let attempt = 0; ; attempt++) { try { if ((await request('/api/health')).response.ok) break; } catch {} if (attempt >= 600) throw new Error('Isolated review sidecar unavailable'); await pause(50); }
    let version = (await request('/api/state/version')).value.version;
    const initial = (await request('/api/state')).value;
    const state = { ...initial, customers: [{ id: 'C-review-ui', name: 'UI fixture', phone: '919000000040', rawPhone: '919000000040', occupation: '', language: '人工中文', country: '', manualLockedFields: ['language'], deleted: false }] };
    assert.equal((await request('/api/state', { method: 'PUT', headers: { 'X-State-Version': String(version) }, body: JSON.stringify(state) })).response.status, 200);
    version = (await request('/api/state/version')).value.version;
    const conversation = await post('/api/ws/conversations', { accountId: 'default', id: 'review-ui-conv', externalId: 'review-ui-contact', title: 'UI fixture', unreadCount: 0, data: { conversationType: 'direct', isGroup: false, historyLoaded: true, historyFingerprint: 'ui-history', lastMessageFingerprint: 'ui-history', directionVersion: 5 } });
    assert.equal(conversation.response.status, 200);
    const lease = (await post('/api/ws/fencing', { action: 'acquire', scopeKey: 'stage51-review-ui', ownerId: 'isolated-ui', leaseMs: 120000 })).value.lease;
    const body = { accountId: 'default', customerId: 'C-review-ui', conversationId: 'review-ui-conv', jobType: 'customer_chat_analysis', idempotencyKey: 'review-ui-job', correlationId: 'review-ui-flow', lease };
    const queued = await post('/api/ws/ai-pipeline/jobs', body); assert.equal(queued.response.status, 201); const jobId = queued.value.job.id;
    const facts = { occupation: { value: '工程师', evidence: '我是一名工程师', confidence: 0.95 }, country: { value: '印度', evidence: '我在印度生活', confidence: 0.95 }, language: { value: '英语', evidence: 'I speak English', confidence: 0.95 } };
    const suggestions = await post('/api/ws/ai-pipeline/suggestions', { ...body, jobId, result: { profileFacts: facts }, idempotencyKey: 'review-ui-suggestions' }); assert.equal(suggestions.response.status, 201); const byField = Object.fromEntries(suggestions.value.suggestions.map(item => [item.fieldName, item.id]));

    // Real UI module and click handler; only DOM primitives are substituted.
    // All reads, mutations, version checks and audit assertions hit real sidecar.
    const handlers = {}, panel = { innerHTML: '' }; let mounted = null;
    const target = { dataset: { wsAccountId: 'default' }, appendChild(value) { mounted = value; }, addEventListener(kind, handler) { handlers[kind] = handler; }, removeEventListener() {} };
    const sandbox = {
      document: { body: {}, querySelector(selector) { return selector === '#stage4AiReviewCenter' ? mounted : target; }, createElement() { return panel; } },
      AbortController, URLSearchParams, setTimeout, clearTimeout, addEventListener() {}, MutationObserver: class { observe() {} },
      __stage4AiLease: lease,
      __zhikeRegistryHost: { getStateVersion: () => version, refreshState: async () => { version = (await request('/api/state/version')).value.version; } },
      fetch: send,
    };
    vm.runInNewContext(fs.readFileSync(path.join(app, 'modules/ai-review-center-ui.js'), 'utf8'), sandbox);
    await sandbox.ZhikeAiReviewCenter.refresh();
    const click = async (action, suggestionId) => handlers.click({ target: { closest() { return { dataset: { stage4Action: action, suggestionId }, disabled: false }; } } });
    await click('approve', byField.occupation);
    let stored = (await request('/api/state')).value.customers[0];
    assert.equal(stored.occupation, '工程师', 'real UI approve must supply the suggestion ID expected by the Service');
    await click('reject', byField.country);
    stored = (await request('/api/state')).value.customers[0]; assert.equal(stored.country, '');
    await click('approve', byField.language);
    stored = (await request('/api/state')).value.customers[0]; assert.equal(stored.language, '人工中文');
    const final = (await request('/api/ws/ai-pipeline/suggestions?accountId=default')).value.suggestions;
    assert.equal(final.find(item => item.id === byField.occupation).verificationStatus, 'applied');
    assert.equal(final.find(item => item.id === byField.country).verificationStatus, 'rejected');
    assert.equal(final.find(item => item.id === byField.language).verificationStatus, 'conflict');
    const audit = (await request('/api/ws/ai-pipeline/audit?accountId=default&jobId=' + jobId)).value.audit;
    assert.ok(audit.some(item => item.action === 'suggestion.approve')); assert.ok(audit.some(item => item.action === 'suggestion.reject'));
    assert.equal(audit.filter(item => item.action === 'suggestion.conflict').length, 1, 'manual-field conflict must create one truthful review audit');
    const conflictCandidate = final.find(item => item.id === byField.language);
    assert.ok(conflictCandidate.reviewedAt); assert.equal(conflictCandidate.reviewedBy, 'operator'); assert.ok(conflictCandidate.conflictReason);
    await click('approve', byField.language);
    const repeatedAudit = (await request('/api/ws/ai-pipeline/audit?accountId=default&jobId=' + jobId)).value.audit;
    assert.equal(repeatedAudit.length, audit.length, 'repeated conflict review cannot fabricate duplicate transitions');
    assert.equal((await request('/api/state')).value.customers[0].language, '人工中文');
    // Verify native-bridge shaped error messages are shown without inventing login failures.
    const realFetch = sandbox.fetch;
    sandbox.fetch = async () => ({ ok: false, status: 409, json: async () => ({ errorCode: 'CONFLICT', message: '隔离测试版本冲突，刷新后重试' }) });
    await sandbox.ZhikeAiReviewCenter.refresh(); assert.match(panel.innerHTML, /隔离测试版本冲突，刷新后重试/); sandbox.fetch = realFetch;
    console.log('stage5.1 real Service + UI event review: approve, reject, manual conflict, audit and bridge error detail PASS');
  } finally {
    try { await post('/api/shutdown', {}, { 'X-Zhike-Shutdown-Token': token }); } catch {}
    for (let attempt = 0; child.exitCode === null && attempt < 200; attempt++) await pause(25);
    if (child.exitCode === null) { child.kill('SIGKILL'); await new Promise(resolve => child.once('exit', resolve)); }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
