'use strict';
// Production HTTP and disposable SQLite. No model request or real WS session.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');
const { runMigrations } = require('../resources/app/migration-runner.cjs');
const { observeSidecarStartup, requestWithStartupDiagnostics } = require('./helpers/sidecar-startup-observer.cjs');
const app = path.resolve(__dirname, '../resources/app');
const ordinary = 'ordinary-ai', dedicated = 'dedicated-ai';
const now = '2026-11-20T05:00:00.000Z';
const member = { senderId: '917000008001@s.whatsapp.net', senderPhone: '7000008001', identitySource: 'sender-jid' };
const otherMember = { senderId: '917000008002@s.whatsapp.net', senderPhone: '7000008002', identitySource: 'sender-jid' };
const memberPayload = { memberScoped: true, memberIdentity: member };
const analysis = identity => ({ summary: 'Synthetic observed member', confidence: 0.95, memberIdentity: identity,
  transcriptInfo: { memberScoped: true, memberIdentity: identity, sourceFingerprint: 'observed-history', directionVersion: 4 },
  profileFacts: { occupation: { value: 'Shop manager', state: 'known', confidence: 0.95, evidence: 'I manage a shop', sourceRole: 'customer' } } });

function seed(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'));
  try {
    runMigrations({ db, migrationDir: path.join(app, 'migrations'), lockPath: path.join(dataDir, 'seed.lock'), backup: false });
    db.exec('PRAGMA foreign_keys=ON');
    for (const [id, mode] of [[ordinary, 'ordinary'], [dedicated, 'dedicated']]) {
      db.prepare('INSERT INTO ws_accounts(id,display_name,workspace_mode,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, id, mode, now, now);
    }
    db.prepare(`INSERT INTO ws_group_monitor_profiles(id,account_id,slot_key,status,enabled,created_at,updated_at)
      VALUES('ai-seat',?,'ai-seat','running',1,?,?)`).run(dedicated, now, now);
    const cases = [
      ['ordinary-direct', ordinary, '917000008003@s.whatsapp.net', 'direct', false, 'native'],
      ['dedicated-direct', dedicated, '917000008004@s.whatsapp.net', 'direct', false, 'native'],
      ['ordinary-group', ordinary, '120300008001@g.us', 'vip_group', false, 'native'],
      ['authorized-group', dedicated, '120300008002@g.us', 'vip_group', true, 'native'],
      ['canonical-group', dedicated, '120300008003@g.us', 'group', true, 'native'],
      ['unconfigured-group', dedicated, '120300008004@g.us', 'vip_group', false, 'native'],
      ['catalog-only-group', dedicated, '120300008005@g.us', 'vip_group', true, 'none'],
      ['manual-evidence-group', dedicated, '120300008006@g.us', 'vip_group', true, 'manual'],
      ['label-only-group', dedicated, 'synthetic-label', 'vip_group', false, 'native'],
    ];
    for (const [id, accountId, jid, kind, authorized, evidence] of cases) {
      const data = { conversationType: kind, isGroup: kind !== 'direct', vipGroup: kind === 'vip_group', historyLoaded: true,
        historyFingerprint: 'observed-history', lastMessageFingerprint: 'observed-history', directionVersion: 4 };
      db.prepare(`INSERT INTO ws_conversations(id,account_id,external_id,title,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`)
        .run(id, accountId, jid, 'Same synthetic label', JSON.stringify(data), now, now);
      if (kind !== 'direct' && jid.endsWith('@g.us')) {
        db.prepare(`INSERT INTO ws_group_catalog(id,account_id,group_jid,group_name,discovery_source,status,first_seen_at,last_seen_at,created_at,updated_at)
          VALUES(?,?,?,'Same synthetic label','monitor-target','active',?,?,?,?)`).run('catalog-' + id, accountId, jid, now, now, now, now);
      }
      if (authorized) db.prepare(`INSERT INTO ws_group_monitor_targets(id,profile_id,account_id,group_jid,enabled,created_at,updated_at)
        VALUES(?,'ai-seat',?,?,1,?,?)`).run('target-' + id, accountId, jid, now, now);
      if (evidence !== 'none') for (const [index, identity] of [member, otherMember].entries()) {
        const messageData = { source: evidence === 'native' ? 'ws-webview2' : 'manual-import', directionVersion: 4,
          directionSource: 'class-message-in', senderIdentityTrusted: true, ...identity, senderIdentitySource: identity.identitySource };
        db.prepare(`INSERT INTO ws_messages(id,account_id,conversation_id,external_id,direction,original_text,data_json,created_at,updated_at)
          VALUES(?,?,?,?,'receive','I manage a shop',?,?,?)`).run('message-' + id + '-' + index, accountId, id, 'native-' + index, JSON.stringify(messageData), now, now);
      }
      db.prepare(`INSERT INTO ws_ai_analyses(id,account_id,conversation_id,result_json,confidence,created_at,updated_at) VALUES(?,?,?,?,0.95,?,?)`)
        .run('history-' + id, accountId, id, JSON.stringify(analysis(member)), now, now);
      db.prepare(`INSERT INTO ai_jobs(id,account_id,conversation_id,idempotency_key,payload_json,status,next_attempt_at,locked_at,lease_token,last_error,analysis_id,created_at,updated_at)
        VALUES(?,?,?,?,?,'queued','','','','','',?,?)`).run('queued-' + id, accountId, id, 'legacy-' + id, JSON.stringify(memberPayload), now, now);
    }
  } finally { db.close(); }
}

async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

test('production AI execution enforces purpose and observed group-member scope without hiding history', { timeout: 60000 }, async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-ai-purpose-'));
  seed(dataDir);
  const port = await freePort(), origin = 'http://127.0.0.1:' + port, token = randomBytes(24).toString('hex');
  const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
    cwd: app, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token,
      ZHIKE_PARENT_PID: '', ZHIKE_GROUP_MANAGER_MODE: '', ZHIKE_STAGE3_MOCK: '', ZHIKE_AI_PIPELINE_MODE: '', ZHIKE_STAGE4_MOCK: '', ZHIKE_FENCING_MODE: '' },
  });
  const closed = new Promise(resolve => child.once('close', resolve));
  const observation = observeSidecarStartup(child, { secrets: [token] });
  const request = async (route, body, expected = 200) => {
    const headers = { origin, 'x-zhike-api-token': token, 'content-type': 'application/json' };
    if (body !== undefined) headers['x-state-version'] = (await fetch(origin + '/api/state/version', { headers }).then(response => response.json())).version;
    const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(5000), headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json(); assert.equal(response.status, expected, `${route}: ${JSON.stringify(result)}`); return result;
  };
  const inspect = fn => { const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'), { readOnly: true }); try { return fn(db); } finally { db.close(); } };
  const snapshot = () => inspect(db => JSON.stringify(['app_state', 'customers', 'ai_jobs', 'ws_ai_analyses', 'ws_conversations', 'ws_messages', 'ws_contact_exclusion_hits']
    .map(table => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY id').all()])));
  const query = (accountId, conversationId) => '?' + new URLSearchParams({ accountId, conversationId });
  try {
    await requestWithStartupDiagnostics(() => request('/api/health'), observation);
    await request('/api/state', { customers: [{ id: 'member-customer', name: 'Member', phone: member.senderPhone }], settings: { operatingTasks: [] }, tickets: [], deposits: [], followups: [], activities: [] });
    await t.test('all scoped analysis/message/job history stays visible without writes even when execution is denied', async () => {
      const before = snapshot();
      for (const [id, accountId] of [['ordinary-group', ordinary], ['dedicated-direct', dedicated], ['canonical-group', dedicated], ['label-only-group', dedicated]]) {
        assert.equal((await request('/api/ws/analyses' + query(accountId, id))).analyses[0].id, 'history-' + id);
        assert.equal((await request('/api/ws/messages' + query(accountId, id))).messages.length, 2);
        const jobs = await request('/api/ws/ai-jobs' + query(accountId, id));
        assert.equal(jobs.jobs.length, 1); assert.equal(jobs.jobs[0].id, 'queued-' + id);
        assert.equal(jobs.jobs[0].executionEligible, id === 'canonical-group');
      }
      assert.equal((await request('/api/ws/ai-jobs' + query(ordinary, 'authorized-group'))).jobs.length, 0);
      await request('/api/ws/analyses' + query(ordinary, 'authorized-group'), undefined, 400);
      assert.equal(snapshot(), before);
    });
    await t.test('wrong-purpose and unobserved or unauthorized groups cannot enqueue, claim, save or sync', async () => {
      for (const [id, accountId, code] of [
        ['ordinary-group', ordinary, 'WS_WORKSPACE_MODE_MISMATCH'], ['dedicated-direct', dedicated, 'WS_WORKSPACE_MODE_MISMATCH'],
        ['unconfigured-group', dedicated, 'WS_GROUP_AUTHORIZATION_REQUIRED'], ['catalog-only-group', dedicated, 'WS_GROUP_OBSERVATION_REQUIRED'],
        ['manual-evidence-group', dedicated, 'WS_GROUP_OBSERVATION_REQUIRED'], ['label-only-group', dedicated, 'WS_GROUP_IDENTITY_UNCONFIRMED'],
      ]) {
        const before = snapshot();
        for (const [route, body] of [
          ['/api/ws/ai-jobs', { conversationId: id, idempotencyKey: 'blocked-' + id, payload: memberPayload }],
          ['/api/ws/ai-jobs', { action: 'claim', jobId: 'queued-' + id, payload: memberPayload }],
          ['/api/ws/analyses', { conversationId: id, result: analysis(member) }],
          ['/api/ws/crm-sync', { conversationId: id, analysisId: 'history-' + id }],
        ]) assert.equal((await request(route, { ...body, accountId, workspaceMode: 'dedicated', vipGroup: true }, 422)).code, code);
        assert.equal(snapshot(), before, id);
      }
    });
    await t.test('group enqueue and analysis require an actually observed individual member', async () => {
      const before = snapshot(), conversationId = 'authorized-group', accountId = dedicated;
      assert.equal((await request('/api/ws/ai-jobs', { accountId, conversationId, idempotencyKey: 'whole-room' }, 422)).code, 'WS_GROUP_MEMBER_SCOPE_REQUIRED');
      assert.equal((await request('/api/ws/analyses', { accountId, conversationId, result: { summary: 'Whole group' } }, 422)).code, 'WS_GROUP_MEMBER_SCOPE_REQUIRED');
      const unknown = { senderId: '917000008099@s.whatsapp.net', identitySource: 'sender-jid', trusted: true };
      assert.equal((await request('/api/ws/analyses', { accountId, conversationId, result: analysis(unknown) }, 422)).code, 'WS_GROUP_MEMBER_IDENTITY_UNCONFIRMED');
      assert.equal(snapshot(), before);
    });
    await t.test('ordinary direct jobs preserve claims, leases and historical analysis behavior', async () => {
      const accountId = ordinary, conversationId = 'ordinary-direct';
      const queued = await request('/api/ws/ai-jobs', { accountId, conversationId, idempotencyKey: 'direct-new' }, 201);
      const claimed = await request('/api/ws/ai-jobs', { accountId, action: 'claim', jobId: queued.job.id });
      assert.equal(claimed.claimed, true); assert.ok(claimed.job.leaseToken);
      assert.equal((await request('/api/ws/analyses', { accountId, conversationId, jobId: queued.job.id, leaseToken: 'stale', result: { summary: 'Direct' } }, 409)).code, 'AI_JOB_LEASE_STALE');
      const saved = await request('/api/ws/analyses', { accountId, conversationId, jobId: queued.job.id, leaseToken: claimed.job.leaseToken, result: { summary: 'Direct', confidence: 0.8 } });
      assert.equal(saved.job.status, 'completed');
      assert.equal((await request('/api/ws/analyses' + query(accountId, conversationId))).total, 2);
    });
    await t.test('dedicated group jobs bind one observed member and preserve exclusion before CRM writes', async () => {
      const accountId = dedicated, conversationId = 'authorized-group';
      const queued = await request('/api/ws/ai-jobs', { accountId, conversationId, idempotencyKey: 'group-new', payload: memberPayload }, 201);
      assert.equal((await request('/api/ws/ai-jobs', { accountId, conversationId, idempotencyKey: 'group-new', payload: { ...memberPayload, memberIdentity: otherMember } }, 409)).code, 'AI_JOB_MEMBER_CONFLICT');
      const claimed = await request('/api/ws/ai-jobs', { accountId, action: 'claim', jobId: queued.job.id });
      assert.equal(claimed.claimed, true);
      assert.equal((await request('/api/ws/analyses', { accountId, conversationId, jobId: queued.job.id, leaseToken: claimed.job.leaseToken, result: analysis(otherMember) }, 409)).code, 'AI_JOB_MEMBER_CONFLICT');
      const saved = await request('/api/ws/analyses', { accountId, conversationId, jobId: queued.job.id, leaseToken: claimed.job.leaseToken, result: analysis(member) });
      assert.equal((await request('/api/ws/crm-sync', { accountId, conversationId, analysisId: saved.id, memberIdentity: otherMember }, 409)).code, 'AI_ANALYSIS_MEMBER_CONFLICT');
      const synced = await request('/api/ws/crm-sync', { accountId, conversationId, analysisId: saved.id });
      assert.equal(synced.matched, true); assert.equal(synced.customer.occupation, 'Shop manager');
      await request('/api/ws/contact-exclusions', { identity: member.senderPhone }, 201);
      const before = await request('/api/state');
      const blocked = await request('/api/ws/crm-sync', { accountId, conversationId, analysisId: saved.id });
      assert.equal(blocked.code, 'CONTACT_EXCLUDED'); assert.deepEqual(await request('/api/state'), before);
    });
    await t.test('canonical group encoding uses the same member gate rather than a VIP label', async () => {
      const saved = await request('/api/ws/analyses', { accountId: dedicated, conversationId: 'canonical-group', result: analysis(otherMember) });
      assert.ok(saved.id);
      assert.equal(inspect(db => JSON.parse(db.prepare('SELECT data_json FROM ws_conversations WHERE id=?').get('canonical-group').data_json).vipGroup), false);
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
