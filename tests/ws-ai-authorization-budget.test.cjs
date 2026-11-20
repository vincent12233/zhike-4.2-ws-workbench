'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');
const { runMigrations } = require('../resources/app/migration-runner.cjs');
const budget = require('../resources/app/modules/ws-ai-budget.cjs');
const { observeSidecarStartup, requestWithStartupDiagnostics } = require('./helpers/sidecar-startup-observer.cjs');
const repo = path.resolve(__dirname, '..'), app = path.join(repo, 'resources/app');
const accountId = 'authorized-account', otherAccount = 'other-account';
const now = '2026-11-20T05:00:00.000Z';
// Synthetic public-document shape; no live documentation or model network.
const modelEvidence = ['Default snapshot: `gpt-5.4-mini-2026-03-17`', 'Maximum input tokens: 272,000', '### Text tokens',
  '| Input | $0.75 | 1M tokens |', '| Output | $4.5 | 1M tokens |', '## Endpoints', '| Responses | `v1/responses` | Supported |'].join('\n');
const responseEvidence = 'max_output_tokens includes the bound including visible output tokens and [reasoning tokens]';
const quote = budget.parseOfficialVerification(modelEvidence, responseEvidence);
function seed(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'));
  try {
    runMigrations({ db, migrationDir: path.join(app, 'migrations'), lockPath: path.join(dataDir, 'seed.lock'), backup: false });
    db.prepare("INSERT INTO ws_ai_price_verifications(id,quote_json,updated_at) VALUES('current',?,?)").run(JSON.stringify(quote), new Date().toISOString());
    for (const id of [accountId, otherAccount]) db.prepare("INSERT INTO ws_accounts(id,display_name,workspace_mode,created_at,updated_at) VALUES(?,?,'ordinary',?,?)").run(id, id, now, now);
    for (const [id, account, text, source] of [['authorized-chat', accountId, 'SYNTHETIC_AUTHORIZED_CHAT I am an engineer', 'ws-webview2'],
      ['other-chat', accountId, 'OUTSIDE_CONVERSATION', 'ws-webview2'], ['cross-account-chat', otherAccount, 'SYNTHETIC_OTHER_ACCOUNT', 'ws-webview2'],
      ['manual-chat', accountId, 'Manual text cannot prove native history', 'manual']]) {
      const data = { conversationType: 'direct', historyLoaded: true, directionVersion: 4, historyFingerprint: 'saved-' + id, lastMessageFingerprint: 'saved-' + id };
      db.prepare('INSERT INTO ws_conversations(id,account_id,external_id,title,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
        .run(id, account, id + '@s.whatsapp.net', id, JSON.stringify(data), now, now);
      db.prepare(`INSERT INTO ws_messages(id,account_id,conversation_id,external_id,direction,original_text,data_json,created_at,updated_at)
        VALUES(?,?,?,?,'receive',?,?,?,?)`).run('message-' + id, account, id, id, text, JSON.stringify({ source, nativeAuthorityVerified: source === 'ws-webview2', directionVersion: 4, directionSource: 'class-message-in' }), now, now);
    }
  } finally { db.close(); }
}
async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port;
}
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(stdout) : reject(new Error(`isolated native fixture exited ${code}: ${stderr}\n${stdout}`)));
  });
}
test('automatic pricing uses an integer conservative ceiling and expires closed', () => {
  const fixed = budget.parseOfficialVerification(modelEvidence, responseEvidence, '2026-11-20T05:00:00Z');
  assert.equal(budget.upperBoundMicros(fixed), 244676);
  assert.equal(budget.availability(fixed, '2026-11-20T05:00:00Z').available, true);
  assert.equal(budget.availability(fixed, '2026-12-20T05:00:00Z').code, 'AI_PRICING_UNVERIFIED');
  assert.equal(budget.availability(null).available, false);
  assert.equal(budget.availability({ ...fixed, expiresAt: 'invalid' }).available, false);
  assert.equal(budget.availability({ ...fixed, upliftNumerator: 1 }).available, false);
  assert.throws(() => budget.upperBoundMicros({ ...fixed, maxInputTokens: NaN }), /UNAVAILABLE/);
  assert.throws(() => budget.parseOfficialVerification(modelEvidence + '\nStatus: Deprecated', responseEvidence), /UNSUPPORTED/);
});
test('official price maintenance only fetches fixed unpaid documentation URLs', async () => {
  const seen = [];
  const result = await budget.verifyOfficialPricing(async (url, options) => {
    seen.push(url); assert.equal(options.redirect, 'error'); assert.equal(options.headers.authorization, undefined);
    return new Response(url.includes('/models/') ? modelEvidence : responseEvidence);
  });
  assert.equal(budget.availability(result).available, true); assert.equal(seen.length, 2);
  assert.ok(seen.every(url => url.startsWith('https://developers.openai.com/api/')));
});

test('real automatic authorization, budget, native coordinator and CRM lifecycle', { timeout: 120000 }, async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-ai-authorization-'));
  seed(dataDir);
  const port = await freePort(), origin = 'http://127.0.0.1:' + port + '/', token = randomBytes(24).toString('hex'), nativeToken = randomBytes(32).toString('hex');
  let child, closed;
  const request = async (route, body, expected = 200) => {
    const headers = { origin: origin.slice(0, -1), 'x-zhike-api-token': token, 'content-type': 'application/json' };
    if (route.endsWith('/attempts')) headers['x-zhike-native-token'] = nativeToken;
    if (body !== undefined) headers['x-state-version'] = (await fetch(origin + 'api/state/version', { headers }).then(response => response.json())).version;
    const response = await fetch(origin + route.replace(/^\//, ''), { method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(5000), headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json(); assert.equal(response.status, expected, `${route}: ${JSON.stringify(result)}`); return result;
  };
  async function start() {
    child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], { cwd: app, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_NATIVE_WRITE_TOKEN: nativeToken, ZHIKE_PARENT_PID: '',
        ZHIKE_GROUP_MANAGER_MODE: '', ZHIKE_STAGE3_MOCK: '', ZHIKE_AI_PIPELINE_MODE: '', ZHIKE_STAGE4_MOCK: '', ZHIKE_FENCING_MODE: '' } });
    closed = new Promise(resolve => child.once('close', resolve));
    const observer = observeSidecarStartup(child, { secrets: [token, nativeToken] });
    await requestWithStartupDiagnostics(() => request('/api/health'), observer);
  }
  async function stop() { if (child?.exitCode === null && child.signalCode === null) child.kill(); if (closed) await closed; }
  const auth = (body, expected = 200) => request('/api/ws/ai-automation' + (['reserve','dispatch','finish'].includes(body.action) ? '/attempts' : ''), { accountId, ...body }, expected);
  const status = () => request('/api/ws/ai-automation?accountId=' + accountId);
  const grant = async (extra = {}) => {
    const prior = (await status()).authorization;
    return auth({ action: 'grant', conversationId: 'authorized-chat', consent: true, quoteId: quote.id, budgetMicros: 1000000,
      commandId: randomBytes(16).toString('hex'), expectedAuthorizationId: prior?.id || '', expectedRevision: prior?.revision || 0, ...extra }, 201);
  };
  async function claimed(key, conversationId = 'authorized-chat') {
    const authorizationId = (await status()).authorization?.id;
    const queued = await request('/api/ws/ai-jobs', { accountId, conversationId, idempotencyKey: key, payload: { sourceFingerprint: 'saved-' + conversationId, authorizationId } }, 201);
    return (await request('/api/ws/ai-jobs', { accountId, action: 'claim', jobId: queued.job.id })).job;
  }
  const reserve = job => auth({ action: 'reserve', conversationId: job.conversationId, jobId: job.id, leaseToken: job.leaseToken });
  try {
    await start();
    assert.equal((await status()).active, false);
    await t.test('native budget attempts reject generic renderer requests before any reservation', async () => {
      for (const route of ['api/ws/ai-automation', 'api/ws/ai-automation/attempts']) {
        const response = await fetch(origin + route, { method: 'POST', headers: { 'x-zhike-api-token': token, 'content-type': 'application/json' },
          body: JSON.stringify({ accountId, action: 'reserve', conversationId: 'authorized-chat' }) });
        assert.equal(response.status, 403); assert.equal((await response.json()).code, 'WS_NATIVE_AUTHORITY_REQUIRED');
      }
    });
    await t.test('explicit consent, exact scope and native evidence are required', async () => {
      assert.equal((await auth({ action: 'reserve', conversationId: 'authorized-chat' }, 422)).code, 'AI_AUTHORIZATION_REQUIRED');
      assert.equal((await auth({ action: 'grant', conversationId: 'authorized-chat', quoteId: quote.id, budgetMicros: 1000000 }, 422)).code, 'AI_EXPLICIT_CONSENT_REQUIRED');
      assert.equal((await auth({ action: 'grant', conversationId: 'manual-chat', consent: true, quoteId: quote.id, budgetMicros: 1000000 }, 422)).code, 'WS_AI_NATIVE_SOURCE_REQUIRED');
      await auth({ action: 'grant', conversationId: 'cross-account-chat', consent: true, quoteId: quote.id, budgetMicros: 1000000 }, 400);
      await grant();
      const job = await claimed('other-scope', 'other-chat');
      assert.equal((await auth({ action: 'reserve', conversationId: job.conversationId, jobId: job.id, leaseToken: job.leaseToken }, 422)).code, 'AI_SCOPE_MISMATCH');
      assert.equal((await status()).authorization.reservedMicros, 0);
    });
    await t.test('concurrent attempts cannot exceed the authorized total and finish cannot refund it', async () => {
      await grant({ budgetMicros: budget.upperBoundMicros(quote) });
      const a = await claimed('budget-one'), b = await claimed('budget-two');
      const responses = await Promise.all([a, b].map(async job => {
        const response = await fetch(origin + 'api/ws/ai-automation/attempts', { method: 'POST', headers: { 'x-zhike-api-token': token, 'x-zhike-native-token': nativeToken, 'content-type': 'application/json' },
          body: JSON.stringify({ accountId, action: 'reserve', conversationId: job.conversationId, jobId: job.id, leaseToken: job.leaseToken }) });
        return { job, status: response.status, data: await response.json() };
      }));
      assert.deepEqual(responses.map(row => row.status).sort(), [200, 422]);
      const accepted = responses.find(row => row.status === 200);
      await auth({ action: 'dispatch', attemptId: accepted.data.attemptId, leaseToken: accepted.job.leaseToken });
      await auth({ action: 'finish', attemptId: accepted.data.attemptId, leaseToken: accepted.job.leaseToken, resultCode: 'completed', usage: { inputTokens: 0, outputTokens: 0 }, refundMicros: 1000000 });
      const result = await status(); assert.equal(result.authorization.reservedMicros, budget.upperBoundMicros(quote)); assert.equal(result.active, false);
    });
    await t.test('replayed consent keeps the same budget and stale consent cannot replace a newer authorization', async () => {
      const prior = (await status()).authorization;
      const command = { action: 'grant', conversationId: 'authorized-chat', consent: true, quoteId: quote.id, budgetMicros: 1000000,
        commandId: randomBytes(16).toString('hex'), expectedAuthorizationId: prior.id, expectedRevision: prior.revision };
      const first = await auth(command, 201), job = await claimed('idempotent-consent');
      await reserve(job);
      const duplicate = await auth(command, 201);
      assert.equal(duplicate.authorization.id, first.authorization.id);
      assert.equal(duplicate.authorization.reservedMicros, budget.upperBoundMicros(quote));
      assert.equal((await auth({ ...command, budgetMicros: 2000000 }, 422)).code, 'AI_CONSENT_CONFLICT');
      await grant();
      assert.equal((await auth(command, 422)).code, 'AI_AUTHORIZATION_STALE');
      assert.equal((await auth({ ...command, commandId: randomBytes(16).toString('hex') }, 422)).code, 'AI_AUTHORIZATION_STALE');
    });
    await t.test('pause or revoke after reservation prevents dispatch; restart requires explicit resume', async () => {
      const granted = await grant(), job = await claimed('pause-race'), permit = await reserve(job);
      await auth({ action: 'pause', authorizationId: granted.authorization.id });
      assert.equal((await auth({ action: 'dispatch', attemptId: permit.attemptId, leaseToken: job.leaseToken }, 422)).code, 'AI_AUTHORIZATION_PAUSED');
      await auth({ action: 'resume', authorizationId: granted.authorization.id }, 422);
      const paused = await status();
      await auth({ action: 'resume', authorizationId: granted.authorization.id, consent: true, expectedRevision: granted.authorization.revision }, 422);
      await auth({ action: 'resume', authorizationId: granted.authorization.id, consent: true, expectedRevision: paused.authorization.revision });
      const repeated = await claimed('new-job-same-source');
      assert.equal((await auth({ action: 'reserve', conversationId: repeated.conversationId, jobId: repeated.id, leaseToken: repeated.leaseToken }, 422)).code, 'AI_SOURCE_ALREADY_ATTEMPTED');
      await stop(); await start();
      const restarted = await status(); assert.equal(restarted.active, false); assert.equal(restarted.code, 'AI_AUTHORIZATION_RESTARTED');
      assert.equal(restarted.authorization.reservedMicros, budget.upperBoundMicros(quote));
      await auth({ action: 'resume', authorizationId: granted.authorization.id, consent: true, expectedRevision: restarted.authorization.revision });
      await auth({ action: 'revoke', authorizationId: granted.authorization.id });
      assert.equal((await auth({ action: 'dispatch', attemptId: permit.attemptId, leaseToken: job.leaseToken }, 422)).code, 'AI_AUTHORIZATION_PAUSED');
    });
    await t.test('real native coordinator uses the reserved server prompt once then existing analysis and CRM APIs', async () => {
      await grant(); const job = await claimed('native-end-to-end');
      await request('/api/state', { customers: [{ id: 'synthetic-customer', name: 'Synthetic customer', wsConversationId: 'authorized-chat', wsAccountId: accountId }], settings: { operatingTasks: [] }, tickets: [], deposits: [], followups: [], activities: [] });
      const localSdk = path.join(repo, '.tools/dotnet10/dotnet.exe');
      const dotnet = process.env.ZHIKE_TEST_DOTNET || (fs.existsSync(localSdk) ? localSdk : 'dotnet');
      const project = path.join(repo, 'desktop/tests/WsAutomaticAiRuntime/WsAutomaticAiRuntime.csproj');
      await run(dotnet, ['build', project, '-c', 'Release', '--ignore-failed-sources', '--nologo'], { cwd: repo });
      const dll = path.join(repo, 'desktop/tests/WsAutomaticAiRuntime/bin/Release/net10.0-windows/WsAutomaticAiRuntime.dll');
      const output = await run(dotnet, [dll, origin, token, accountId, job.id, job.leaseToken, nativeToken], { cwd: repo });
      const result = JSON.parse(output.trim().split(/\r?\n/).at(-1));
      // analyzeStoredConversation attaches the collected transcript metadata
      // after provider parsing. Keep that real direction/coverage contract;
      // a bare model result is intentionally ineligible for CRM writes.
      const analysis = { ...JSON.parse(result.text), transcriptInfo: { sourceFingerprint: 'saved-authorized-chat', directionVersion: 4,
        historyComplete: true, historyLoaded: 1, historyTotal: 1, included: 1, total: 1, truncated: false, chunkCount: 1, analyzedChunks: 1 } };
      const saved = await request('/api/ws/analyses', { accountId, conversationId: 'authorized-chat', jobId: job.id, leaseToken: job.leaseToken,
        result: analysis, providerName: result.providerName, model: result.model });
      assert.equal(saved.job.status, 'completed');
      const synced = await request('/api/ws/crm-sync', { accountId, conversationId: 'authorized-chat', analysisId: saved.id });
      assert.equal(synced.matched, true); assert.equal(synced.customer.occupation, 'Synthetic engineer');
      const final = await status(); assert.equal(final.authorization.reservedMicros, budget.upperBoundMicros(quote));
      assert.ok(final.audit.some(row => row.action === 'completed' && row.detail.usage.inputTokens === 100));
      assert.equal(JSON.stringify(final.audit).includes('SYNTHETIC_AUTHORIZED_CHAT'), false, 'audit does not copy chat bodies');
    });
    await t.test('restoring a scoped backup revokes automation and retains the spent audit ledger', async () => {
      const before = await status();
      const backup = await request('/api/ws/export?accountId=' + accountId);
      assert.equal(JSON.stringify(backup).includes('consent_key'), false);
      await request('/api/ws/import', { ...backup, accountId });
      const after = await status();
      assert.equal(after.active, false); assert.equal(after.authorization, null);
      assert.ok(after.audit.some(row => row.authorizationId === before.authorization.id && row.action === 'completed'));
      const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'), { readOnly: true });
      try {
        const preserved = db.prepare('SELECT status,reserved_micros FROM ws_ai_authorizations WHERE id=?').get(before.authorization.id);
        assert.equal(preserved.status, 'revoked'); assert.equal(preserved.reserved_micros, budget.upperBoundMicros(quote));
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ws_conversations WHERE account_id=?').get(otherAccount).n, 1);
      } finally { db.close(); }
    });
  } finally { await stop(); fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('actual renderer automatic branch sends only scope and lease while manual analysis stays separate', async () => {
  const source = fs.readFileSync(path.join(app, 'modules/ws-workbench.js'), 'utf8');
  const start = source.indexOf('  async function analyzeHistoryChunks('), end = source.indexOf('  async function markAnalysisRetryable(', start);
  const calls = [];
  const sandbox = { throwIfAiCancelled() {}, assertContext() {}, automaticAiGranted: () => true,
    core: { parseAiResult: () => ({ summary: 'Synthetic' }) }, window: { zhikeAI: { wsautomatic: async (body, options) => { calls.push({ body, options }); return { text: '{}', model: 'approved', providerName: 'OpenAI', attemptId: 'attempt' }; } } } };
  vm.runInNewContext(source.slice(start, end) + '\nthis.analyze = analyzeHistoryChunks;', sandbox);
  const result = await sandbox.analyze([{ text: 'FORGED_RENDERER_INPUT' }], { id: 'chat' }, { accountId: 'account' }, { id: 'job', leaseToken: 'lease' }, { automatic: true });
  assert.equal(result.automaticAttemptId, 'attempt');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].body)), { accountId: 'account', conversationId: 'chat', jobId: 'job', leaseToken: 'lease' });
  await assert.rejects(() => sandbox.analyze([{}, {}], { id: 'chat' }, { accountId: 'account' }, { id: 'job' }, { automatic: true }), /单段/);
  assert.match(source.slice(start, end), /window\.zhikeAI\.request/);
});

test('renderer ignores stale authorization reads and delayed resume after pause', async () => {
  const source = fs.readFileSync(path.join(app, 'modules/ws-workbench.js'), 'utf8');
  const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const pending = [], state = { aiAuthorizationOperation: 0, aiAuthorizationBusy: false,
    aiAuthorization: { active: true, authorization: { id: 'grant', accountId: 'account', revision: 1 } } };
  const sandbox = { state, captureContext: () => ({ accountId: 'account' }), contextCurrent: () => true, assertContext() {},
    modeAccount: () => true, activeConversation: () => null, render() {}, toast() {}, scheduleAiQueuePump() {},
    cancelBackgroundAiPump: () => Promise.resolve(), api: (_url, options) => new Promise(resolve => pending.push({ options, resolve })) };
  vm.runInNewContext(extract('  function automaticAiGranted(', '  function renderAiAuthorization(')
    + extract('  async function aiAuthorizationAction(', '  function scheduleAiQueuePump(')
    + '\nthis.refresh=refreshAiAuthorization;this.action=aiAuthorizationAction;', sandbox);
  const read = sandbox.refresh(), pause = sandbox.action('pause');
  pending[0].resolve({ active: true }); await read;
  assert.equal(state.aiAuthorization.active, false, 'old GET cannot restore active state');
  pending[1].resolve({ active: false, authorization: { id: 'grant', accountId: 'account', revision: 2 } }); await pause;
  const resume = sandbox.action('resume'), secondPause = sandbox.action('pause');
  pending[3].resolve({ active: false, authorization: { id: 'grant', accountId: 'account', revision: 3 } }); await secondPause;
  pending[2].resolve({ active: true, authorization: { id: 'grant', accountId: 'account', revision: 2 } }); await resume;
  assert.equal(state.aiAuthorization.active, false); assert.equal(state.aiAuthorizationBusy, false);
});

test('a cached completed automatic job does not continually reschedule state refresh', async () => {
  const source = fs.readFileSync(path.join(app, 'modules/ws-workbench.js'), 'utf8');
  const start = source.indexOf('  async function resumeQueuedAiJobs('), end = source.indexOf('  async function enqueueDiscoveredConversations(', start);
  const sandbox = { state: { aiEnabled: true, conversations: [{ id: 'chat' }], aiAuthorization: { authorization: { conversationId: 'chat' } } },
    refreshAiAuthorization: async () => {}, throwIfAiCancelled() {}, assertContext() {}, automaticAiGranted: () => true,
    analyzeStoredConversation: async () => ({ ok: true, resumed: true }) };
  vm.runInNewContext(source.slice(start, end) + '\nthis.resume=resumeQueuedAiJobs;', sandbox);
  const result = await sandbox.resume({ accountId: 'account' });
  assert.equal(result.succeeded, 0); assert.equal(result.processed, 1);
});
