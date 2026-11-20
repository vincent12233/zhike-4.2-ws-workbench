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
const { observeSidecarStartup, requestWithStartupDiagnostics } = require('./helpers/sidecar-startup-observer.cjs');
const app = path.resolve(__dirname, '../resources/app');
const accountId = 'ordinary-queue', now = '2026-11-20T05:00:00.000Z';
function seed(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'));
  try {
    runMigrations({ db, migrationDir: path.join(app, 'migrations'), lockPath: path.join(dataDir, 'seed.lock'), backup: false });
    db.prepare("INSERT INTO ws_accounts(id,display_name,workspace_mode,created_at,updated_at) VALUES(?,?,'ordinary',?,?)").run(accountId, accountId, now, now);
    for (const [id, type, jid, ready] of [['blocked-group', 'vip_group', 'saved@g.us', true], ['blocked-history', 'direct', '917000008001@s.whatsapp.net', false],
      ['ready-one', 'direct', '917000008002@s.whatsapp.net', true], ['ready-two', 'direct', '917000008003@s.whatsapp.net', true]]) {
      const data = { conversationType: type, historyLoaded: ready, directionVersion: 4, historyFingerprint: 'saved', lastMessageFingerprint: 'saved' };
      db.prepare('INSERT INTO ws_conversations(id,account_id,external_id,title,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
        .run(id, accountId, jid, id, JSON.stringify(data), now, now);
    }
    const job = db.prepare(`INSERT INTO ai_jobs(id,account_id,conversation_id,idempotency_key,payload_json,status,next_attempt_at,locked_at,lease_token,last_error,analysis_id,created_at,updated_at)
      VALUES(?,?,?,?,'{"sourceFingerprint":"saved"}','queued','','','','','',?,?)`);
    for (let index = 0; index < 25; index++) {
      const id = 'blocked-' + String(index).padStart(2, '0'); job.run(id, accountId, 'blocked-group', id, now, now);
    }
    job.run('blocked-history', accountId, 'blocked-history', 'blocked-history', now, now);
    job.run('ready-one', accountId, 'ready-one', 'ready-one', now, now);
    job.run('ready-two', accountId, 'ready-two', 'ready-two', now, now);
  } finally { db.close(); }
}
async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

test('production execution queue skips more than one page of blocked history before limiting', { timeout: 60000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-ai-execution-queue-'));
  seed(dataDir);
  const port = await freePort(), origin = 'http://127.0.0.1:' + port, token = randomBytes(24).toString('hex');
  const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
    cwd: app, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token,
      ZHIKE_PARENT_PID: '', ZHIKE_GROUP_MANAGER_MODE: '', ZHIKE_STAGE3_MOCK: '', ZHIKE_AI_PIPELINE_MODE: '', ZHIKE_STAGE4_MOCK: '', ZHIKE_FENCING_MODE: '' },
  });
  const closed = new Promise(resolve => child.once('close', resolve));
  const observation = observeSidecarStartup(child, { secrets: [token] });
  const request = async route => {
    const response = await fetch(origin + route, { headers: { origin, 'x-zhike-api-token': token }, signal: AbortSignal.timeout(5000) });
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
  };
  const snapshot = () => {
    const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'), { readOnly: true });
    try { return JSON.stringify(db.prepare('SELECT * FROM ai_jobs ORDER BY id').all()); } finally { db.close(); }
  };
  try {
    await requestWithStartupDiagnostics(() => request('/api/health'), observation);
    const before = snapshot(), route = '/api/ws/ai-jobs?accountId=' + accountId + '&status=queued,retryable';
    const history = await request(route + '&limit=12');
    assert.equal(history.jobs.length, 12); assert.ok(history.jobs.every(job => job.executionEligible === false));
    const execution = await request(route + '&executionEligible=1&limit=2');
    assert.deepEqual(execution.jobs.map(job => job.id), ['ready-one', 'ready-two']);
    assert.ok(execution.jobs.every(job => job.executionEligible === true));
    assert.deepEqual((await request(route + '&executionEligible=1&limit=1')).jobs.map(job => job.id), ['ready-one']);
    assert.equal((await request(route + '&executionEligible=1&conversationId=blocked-group')).jobs.length, 0);
    assert.deepEqual((await request(route + '&conversationId=blocked-group&limit=2')).jobs.map(job => job.id), ['blocked-00', 'blocked-01']);
    assert.equal(execution.stats.total, history.stats.total); assert.equal(snapshot(), before, 'execution and history queries never retire or claim jobs');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('actual renderer worker requests execution view and never runs an explicitly blocked job', async () => {
  const source = fs.readFileSync(path.join(app, 'modules/ws-workbench.js'), 'utf8');
  const start = source.indexOf('  async function resumeQueuedAiJobs(');
  const end = source.indexOf('  async function enqueueDiscoveredConversations(', start);
  assert.ok(start >= 0 && end > start);
  const requested = [], analyzed = [];
  const context = { accountId: 'ordinary' };
  const sandbox = {
    state: { aiEnabled: true, loading: false, aiBusy: false, collectionRun: null, conversations: [{ id: 'blocked' }, { id: 'ready' }] },
    captureContext: () => context, collectionCapability: () => ({ automaticAi: true }), throwIfAiCancelled() {}, assertContext() {},
    isAutomaticCollectibleConversation: () => true, fullHistorySourceFingerprint: () => 'saved', text: value => String(value || ''),
    api: async route => { requested.push(route); return route.includes('?') ? { jobs: [
      { conversationId: 'blocked', executionEligible: false, payload: { sourceFingerprint: 'saved' } },
      { conversationId: 'ready', executionEligible: true, payload: { sourceFingerprint: 'saved' } },
    ] } : {}; },
    analyzeStoredConversation: async row => { analyzed.push(row.id); return { ok: true }; },
  };
  vm.runInNewContext(source.slice(start, end) + '\nthis.resume = resumeQueuedAiJobs;', sandbox);
  const result = await sandbox.resume(context, { explicit: true });
  assert.ok(requested.includes('/api/ws/ai-jobs?status=queued,retryable&executionEligible=1&limit=12'));
  assert.deepEqual(analyzed, ['ready']); assert.equal(result.processed, 1); assert.equal(result.succeeded, 1);
});
