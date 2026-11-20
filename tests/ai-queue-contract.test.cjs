'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const os = require('node:os');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const app = path.join(repo, 'resources', 'app');
const workbench = readFileSync(path.join(app, 'modules', 'ws-workbench.js'), 'utf8');
const host = readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Views', 'LegacyUiHostPage.xaml.cs'), 'utf8');
assert.match(workbench, /\/api\/ws\/ai-jobs/, 'WS workbench must use the durable AI job queue');
assert.match(workbench, /idempotencyKey/, 'AI queue requests must include an idempotency key');
assert.match(workbench, /nextAttemptAt|retryable/, 'WS workbench must expose retryable queue state');
assert.doesNotMatch(workbench, /previewAnalysisQueue/, 'preview analysis must not rely on an in-memory queue that is lost on restart');
assert.match(workbench, /conversation = state\.conversations\.find\(item => item\.id === grant\.conversationId\)/, 'only the persisted authorization can select the conversation for background analysis');
assert.match(host, /ws\.status/, 'native host must publish WS status events');
assert.match(host, /accepted|deduplicated/, 'native host must include ingest result in the status/event flow');

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-ai-queue-'));
const port = 4481;
const token = 'ai-queue-test-token';
let child;
const headers = { 'content-type': 'application/json', 'x-zhike-api-token': token, origin: `http://127.0.0.1:${port}` };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function start() {
  child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
    cwd: app,
    windowsHide: true,
    env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token },
    stdio: 'ignore',
  });
}
async function request(pathname, init = {}) {
  for (let i = 0; i < 1200; i += 1) {
    try {
      return await fetch(`http://127.0.0.1:${port}${pathname}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    } catch { await wait(50); }
  }
  throw new Error('isolated server did not become available');
}
async function body(response) { return response.json(); }
async function stop() {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  for (let i = 0; i < 80 && child.exitCode === null; i += 1) await wait(25);
  if (child.exitCode === null) child.kill('SIGKILL');
}

(async () => {
  try {
    start();
    const conversation = await body(await request('/api/ws/conversations', { method: 'POST', body: JSON.stringify({ externalId: 'queue-contact', title: 'Queue Contact', conversationType: 'direct', data: { conversationType: 'direct', historyLoaded: true, historyFingerprint: 'queue-history', lastMessageFingerprint: 'queue-history', directionVersion: 4 }, unreadCount: 0 }) }));
    const enqueuePayload = { conversationId: conversation.id, idempotencyKey: 'queue-contact:fp-001', payload: { transcript: 'hello' }, maxAttempts: 3 };
    const first = await request('/api/ws/ai-jobs', { method: 'POST', body: JSON.stringify(enqueuePayload) });
    assert.equal(first.status, 201, 'new AI job must be created durably');
    const firstBody = await body(first);
    assert.equal(firstBody.job.status, 'queued');
    assert.equal(firstBody.job.attempts, 0);
    const repeated = await body(await request('/api/ws/ai-jobs', { method: 'POST', body: JSON.stringify(enqueuePayload) }));
    assert.equal(repeated.existed, true, 'same idempotency key must not enqueue a duplicate');
    assert.equal(repeated.job.id, firstBody.job.id);

    const claimed = await body(await request('/api/ws/ai-jobs', { method: 'POST', body: JSON.stringify({ action: 'claim', jobId: firstBody.job.id }) }));
    assert.equal(claimed.claimed, true);
    assert.equal(claimed.job.status, 'running');
    assert.equal(claimed.job.attempts, 1);
    assert.match(claimed.job.leaseToken, /^[a-f0-9]{64}$/i, 'claim must return an unguessable lease token');
    const staleCheckpoint = await request('/api/ws/ai-jobs', { method: 'POST', body: JSON.stringify({ action: 'checkpoint', jobId: firstBody.job.id, leaseToken: 'stale-worker-token', completedChunks: 1, chunkCount: 2, result: { summary: 'stale' } }) });
    assert.equal(staleCheckpoint.status, 409, 'stale worker checkpoint must be rejected');
    const staleComplete = await request('/api/ws/ai-jobs', { method: 'POST', body: JSON.stringify({ action: 'complete', jobId: firstBody.job.id, leaseToken: 'stale-worker-token', analysisId: 'stale-analysis' }) });
    assert.equal(staleComplete.status, 409, 'stale worker completion must be rejected');
    const staleFail = await request('/api/ws/ai-jobs', { method: 'POST', body: JSON.stringify({ action: 'fail', jobId: firstBody.job.id, leaseToken: 'stale-worker-token', error: 'stale', retryable: false }) });
    assert.equal(staleFail.status, 409, 'stale worker failure must be rejected');
    const stats = await body(await request('/api/ws/ai-jobs?accountId=default'));
    assert.equal(stats.stats.running, 1);

    await stop();
    // Simulate a genuinely stale lease in the isolated fixture. Immediate
    // restart must preserve a live lease; only an expired lease is recovered.
    const isolatedDb = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'));
    isolatedDb.prepare("UPDATE ai_jobs SET locked_at=? WHERE id=?").run(new Date(Date.now() - 11 * 60 * 1000).toISOString(), firstBody.job.id);
    isolatedDb.close();
    start();
    const readOnly = await body(await request('/api/ws/ai-jobs?accountId=default'));
    assert.equal(readOnly.jobs.find(item => item.id === firstBody.job.id).status, 'running', 'GET must not recover or mutate expired jobs');
    const otherRecovery = await body(await request('/api/ws/ai-jobs', { method: 'POST', body: JSON.stringify({ action: 'recover-expired', jobId: 'other-job' }) }));
    assert.equal(otherRecovery.recovered, 0, 'retrying a different job cannot release this expired lease');
    const recovery = await request('/api/ws/ai-jobs', { method: 'POST', body: JSON.stringify({ action: 'recover-expired', jobId: firstBody.job.id }) });
    assert.equal(recovery.status, 200, 'only explicit old-consumer recovery mutates expired jobs');
    const recovered = await body(await request('/api/ws/ai-jobs?accountId=default'));
    const recoveredJob = recovered.jobs.find(item => item.id === firstBody.job.id);
    assert.equal(recoveredJob.status, 'retryable', 'running jobs must recover through the lease-aware retry state after restart');
    assert.match(recoveredJob.lastError, /restart|重启|恢复/i);

    const claimedAgain = await body(await request('/api/ws/ai-jobs', { method: 'POST', body: JSON.stringify({ action: 'claim', jobId: firstBody.job.id }) }));
    assert.equal(claimedAgain.claimed, true);
    const failed = await body(await request('/api/ws/ai-jobs', { method: 'POST', body: JSON.stringify({ action: 'fail', jobId: firstBody.job.id, leaseToken: claimedAgain.job.leaseToken, error: 'temporary outage', retryable: true }) }));
    assert.equal(failed.job.status, 'retryable');
    assert.ok(new Date(failed.job.nextAttemptAt).getTime() > Date.now());

    const unavailableClaim = await body(await request('/api/ws/ai-jobs', { method: 'POST', body: JSON.stringify({ action: 'claim', jobId: firstBody.job.id }) }));
    assert.equal(unavailableClaim.claimed, false, 'backoff must prevent an immediate duplicate claim');
    assert.equal(unavailableClaim.job.status, 'retryable');

    const deadLetterConversation = await body(await request('/api/ws/conversations', { method: 'POST', body: JSON.stringify({ externalId: 'queue-dead-letter', title: 'Dead Letter Contact', conversationType: 'direct', data: { conversationType: 'direct', historyLoaded: true, historyFingerprint: 'dead-history', lastMessageFingerprint: 'dead-history', directionVersion: 4 }, unreadCount: 0 }) }));
    const deadLetterEnqueue = await body(await request('/api/ws/ai-jobs', { method: 'POST', body: JSON.stringify({ conversationId: deadLetterConversation.id, idempotencyKey: 'queue-dead-letter:fp-001', payload: { transcript: 'dead letter' }, maxAttempts: 1 }) }));
    const deadLetterClaim = await body(await request('/api/ws/ai-jobs', { method: 'POST', body: JSON.stringify({ action: 'claim', jobId: deadLetterEnqueue.job.id }) }));
    const deadLetterFail = await body(await request('/api/ws/ai-jobs', { method: 'POST', body: JSON.stringify({ action: 'fail', jobId: deadLetterEnqueue.job.id, leaseToken: deadLetterClaim.job.leaseToken, error: 'permanent outage', retryable: true }) }));
    assert.equal(deadLetterFail.job.status, 'failed', 'max-attempt jobs must move to a terminal dead-letter state');
    assert.equal(deadLetterFail.job.deadLetter, true, 'terminal max-attempt jobs must be marked as dead letters');
    assert.ok(deadLetterFail.stats.deadLetter >= 1, 'queue stats must expose dead-letter count');
    assert.ok(deadLetterFail.stats.retryCount >= 1, 'queue stats must expose retry attempts');
    console.log('AI durable queue contract: idempotent enqueue, restart recovery, claim, backoff and stats passed');
  } finally {
    await stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
