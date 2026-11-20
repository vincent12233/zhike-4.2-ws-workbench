'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { observeSidecarStartup, requestWithStartupDiagnostics } = require('./helpers/sidecar-startup-observer.cjs');

const app = path.join(__dirname, '..', 'resources', 'app');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-data-archive-summary-'));
const port = 4599;
const token = 'data-archive-summary-token';
const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
  cwd: app,
  windowsHide: true,
  env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token },
  stdio: ['ignore', 'ignore', 'pipe'],
});
const startup = observeSidecarStartup(child, { secrets: [token, dataDir, app] });
const headers = { 'content-type': 'application/json', 'x-zhike-api-token': token, origin: `http://127.0.0.1:${port}` };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function request(pathname, init = {}) {
  return requestWithStartupDiagnostics(() => fetch(`http://127.0.0.1:${port}${pathname}`, {
    ...init, headers: { ...headers, ...(init.headers || {}) },
  }), startup, { attempts: 300, retryDelayMs: 40 });
}
const body = value => JSON.stringify(value);
async function stateVersion() { return (await (await request('/api/state/version')).json()).version; }

(async () => {
  try {
    const initial = {
      schemaVersion: 4,
      customers: [
        { id: 'ARCH-C1', name: '档案客户', phone: '9876543210', source: 'WS', deleted: false },
        { id: 'ARCH-C2', name: '未关联客户', phone: '9876543211', source: '导入', deleted: false },
      ],
      savedViews: [], activities: [], tickets: [], deposits: [], followups: [], registrations: [], phoneRegistry: [], batchOperations: [],
      settings: { operatingTasks: [] }, channelAliases: {}, importIssues: [], qualityDecisions: {},
    };
    assert.equal((await request('/api/state', { method: 'POST', headers: { ...headers, 'x-state-version': '' }, body: body(initial) })).status, 200);
    assert.equal((await request('/api/ws/accounts', { method: 'POST', body: body({ id: 'archive-two', displayName: '档案第二账号' }) })).status, 201);

    const direct = await (await request('/api/ws/conversations', { method: 'POST', body: body({ accountId: 'default', externalId: 'archive-direct', title: '档案客户', customerId: 'ARCH-C1', conversationType: 'direct', data: { historyLoaded: true, historyFingerprint: 'archive-history', lastMessageFingerprint: 'archive-history', directionVersion: 4, conversationType: 'direct', isGroup: false } }) })).json();
    const unlinked = await (await request('/api/ws/conversations', { method: 'POST', body: body({ accountId: 'default', externalId: 'archive-unlinked', title: '未关联会话', conversationType: 'direct', data: { historyLoaded: false, conversationType: 'direct', isGroup: false } }) })).json();
    for (const input of [
      { externalId: '1203archive@g.us', conversationType: 'direct' },
      { externalId: '1203archive@g.us', conversationType: 'vip_group', vipGroup: true },
      { externalId: 'archive-direct', data: { conversationType: 'vip_group' } },
    ]) {
      const refused = await request('/api/ws/conversations', { method: 'POST', body: body({ accountId: 'default', ...input }) });
      assert.equal(refused.status, 422);
      assert.equal((await refused.json()).code, 'WS_GROUP_EXCLUDED');
    }
    assert.ok(direct.id && unlinked.id);
    assert.equal((await request('/api/ws/messages/batch', { method: 'POST', body: body({ accountId: 'default', conversationId: direct.id, fingerprint: 'archive-batch', messages: [
      { externalId: 'archive-m1', direction: 'receive', originalText: '你好', order: 1 },
      { externalId: 'archive-m2', direction: 'send', originalText: '你好，已收到', order: 2 },
    ] }) })).status, 200);
    assert.equal((await request('/api/ws/conversations', { method: 'POST', body: body({ accountId: 'default', externalId: 'archive-direct', unreadCount: 0, data: { historyLoaded: true, historyFingerprint: 'archive-history', lastMessageFingerprint: 'archive-history', directionVersion: 4, conversationType: 'direct', isGroup: false } }) })).status, 200);
    assert.equal((await request('/api/ws/analyses', { method: 'POST', body: body({ accountId: 'default', conversationId: direct.id, result: { summary: '档案摘要', confidence: 0.95 } }) })).status, 200);

    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'));
    const now = new Date().toISOString();
    assert.equal(db.prepare('SELECT count(*) AS n FROM ws_conversations WHERE external_id=?').get('1203archive@g.us').n, 0);
    // Exercise archive compatibility with a record from the previous schema.
    db.prepare('INSERT INTO ws_conversations(id,account_id,external_id,title,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run('archive-legacy-group', 'default', '1203archive@g.us', '历史档案群', JSON.stringify({ conversationType:'vip_group', isGroup:true, vipGroup:true }), now, now);

    db.prepare('INSERT INTO ws_collection_runs(id,account_id,status,total,discovered,completed,analyzing,analyzed,failed,skipped,retryable,last_error,checkpoint,resume_count,last_success_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('archive-run', 'default', 'running', 2, 2, 1, 0, 1, 0, 0, 0, '', '', 0, now, now, now);
    db.prepare('INSERT INTO ws_collection_items(id,account_id,run_id,conversation_id,status,attempts,analysis_status,followup_status,next_followup_at,last_error,checkpoint,created_at,updated_at,coverage_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('archive-item', 'default', 'archive-run', direct.id, 'running', 1, 'pending', 'open', now, '', 'archive', now, now, 'full-history');
    db.prepare('INSERT INTO ws_followup_alerts(id,account_id,conversation_id,analysis_id,alert_key,priority,reason,followup_time,status,snoozed_until,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('archive-alert', 'default', direct.id, 'analysis-archive', 'archive-alert', 'today', '需要跟进', now, 'open', '', '{}', now, now);
    db.prepare('INSERT INTO ws_group_catalog(id,account_id,group_jid,group_name,channel_id,participant_count,last_message_at,discovery_source,status,data_json,first_seen_at,last_seen_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('archive-group', 'default', '1203archive@g.us', 'VIP 档案群', 'vip-channel', 5, now, 'test', 'active', '{}', now, now, now, now);
    db.prepare('INSERT INTO ws_media_assets(id,account_id,conversation_id,message_id,media_type,file_name,mime_type,size_bytes,sha256,storage_path,status,unavailable_reason,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('archive-media', 'default', direct.id, 'archive-m1', 'image', 'archive.png', 'image/png', 10, 'archive-sha', '', 'unavailable', '测试未提供文件', '{}', now, now);
    db.prepare('INSERT INTO ai_jobs(id,account_id,conversation_id,idempotency_key,payload_json,status,attempts,max_attempts,next_attempt_at,locked_at,lease_token,last_error,analysis_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('archive-ai-job', 'default', direct.id, 'archive-ai-key', '{}', 'queued', 0, 5, now, '', '', '', '', now, now);
    db.close();

    const all = await (await request('/api/data-archive/summary?allAccounts=1')).json();
    assert.equal(all.scope, 'all');
    assert.deepEqual(new Set(all.accountIds), new Set(['default', 'archive-two']));
    assert.equal(all.crm.activeCustomers, 2);
    assert.equal(all.ws.conversations, 3);
    assert.equal(all.ws.directContacts, 2);
    assert.equal(all.ws.groups, 1, 'a legacy vip-marked row is counted as an ordinary group');
    assert.equal(all.ws.vipGroups, undefined, 'there is no VIP group count');
    assert.equal(all.ws.messages, 2);
    assert.equal(all.ws.analyses, 1);
    assert.equal(all.ws.aiJobs, 1);
    assert.equal(all.ws.aiJobsPending, 1);
    assert.equal(all.ws.collectionPending, 1);
    assert.equal(all.ws.followupAlertsOpen, 1);
    assert.equal(all.ws.groups, 1);
    assert.equal(all.ws.mediaUnavailable, 1);
    assert.equal(all.links.linkedConversations, 1);
    assert.equal(all.links.unlinkedDirectConversations, 1);
    assert.equal(all.accounts.find(item => item.id === 'archive-two').conversations, 0);

    const account = await (await request('/api/data-archive/summary?accountId=default')).json();
    assert.equal(account.scope, 'account');
    assert.deepEqual(account.accountIds, ['default']);
    assert.equal(account.ws.messages, 2);
    assert.equal((await request('/api/data-archive/summary?accountId=missing')).status, 404);
    console.log('data archive summary: SQLite archive, CRM links, WS counts and account isolation pass');
  } finally {
    try { await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { ...headers, 'x-zhike-shutdown-token': token } }); } catch {}
    if (child.exitCode === null) child.kill();
    await wait(100);
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
