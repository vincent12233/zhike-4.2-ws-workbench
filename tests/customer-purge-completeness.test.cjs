const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const app = path.join(__dirname, '..', 'resources', 'app');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-purge-completeness-'));
const port = 4488;
const token = 'purge-completeness-test-token';
const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
  cwd: app,
  windowsHide: true,
  env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token },
  stdio: 'ignore',
});
const headers = { 'content-type': 'application/json', 'x-zhike-api-token': token, origin: `http://127.0.0.1:${port}` };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(pathname, init = {}) {
  for (let i = 0; i < 1200; i++) {
    try {
      const nextHeaders = { ...headers, ...(init.headers || {}) };
      if (String(init.method || 'GET').toUpperCase() !== 'GET' && pathname !== '/api/state' && !Object.keys(nextHeaders).some(key => key.toLowerCase() === 'x-state-version')) {
        const version = await fetch(`http://127.0.0.1:${port}/api/state/version`, { headers }).then(response => response.json());
        nextHeaders['x-state-version'] = String(version.version || '');
      }
      return await fetch(`http://127.0.0.1:${port}${pathname}`, { ...init, headers: nextHeaders });
    } catch { await wait(50); }
  }
  throw new Error('isolated server did not become available');
}
const json = response => response.json();
const iso = '2026-11-15T00:00:00.000Z';

(async () => {
  try {
    const initial = {
      schemaVersion: 4,
      customers: [{ id: 'C-purge', name: '待彻底删除客户', phone: '9876500000', source: 'WS', status: '在群', deleted: false }],
      savedViews: [], activities: [], tickets: [], deposits: [], followups: [], registrations: [], phoneRegistry: [],
      batchOperations: [], settings: { operatingTasks: [{ id: 'task-purge', customerId: 'C-purge' }] }, channelAliases: {}, importIssues: [], qualityDecisions: {},
    };
    assert.equal((await request('/api/state', { method: 'POST', headers: { ...headers, 'x-state-version': '' }, body: JSON.stringify(initial) })).status, 200);
    const conversation = await json(await request('/api/ws/conversations', { method: 'POST', body: JSON.stringify({ externalId: 'purge-conversation', title: '待删除会话', customerId: 'C-purge', unreadCount: 0, data: { conversationType: 'direct', historyLoaded: true, historyFingerprint: 'purge-history', lastMessageFingerprint: 'purge-history', directionVersion: 4 } }) }));
    const analysis = await json(await request('/api/ws/analyses', { method: 'POST', body: JSON.stringify({ conversationId: conversation.id, result: { confidence: 0.9, summary: '待删除分析' } }) }));
    assert.ok(conversation.id, `conversation insert failed: ${JSON.stringify(conversation)}`);
    assert.ok(analysis.id, `analysis insert failed: ${JSON.stringify(analysis)}`);

    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'));
    db.exec('PRAGMA foreign_keys=ON');
    const put = (table, row) => {
      const keys = Object.keys(row);
      db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(key => row[key]));
    };
    put('ws_messages', { id: 'msg-purge', account_id: 'default', conversation_id: conversation.id, external_id: 'msg-purge', direction: 'receive', original_text: '敏感消息', translated_text: '', source_language: '', target_language: '', order_no: 1, data_json: '{}', created_at: iso, updated_at: iso, translation_status: 'none', translation_error: '', translation_attempts: 0, last_attempt_at: '' });
    put('ws_replies', { id: 'reply-purge', account_id: 'default', conversation_id: conversation.id, original_text: '回复', translated_text: '', status: 'draft', created_at: iso, updated_at: iso, idempotency_key: '' });
    put('ws_settings', { conversation_id: conversation.id, account_id: 'default', enabled: 1, receive_enabled: 1, send_enabled: 1, target_language: '中文', send_language: '', show_original: 1, ai_enabled: 1, status: '已连接', created_at: iso, updated_at: iso });
    put('ws_ingest_batches', { id: 'batch-purge', account_id: 'default', conversation_id: conversation.id, fingerprint: 'purge-fingerprint', message_count: 1, inserted_count: 1, message_ids_json: '["msg-purge"]', created_at: iso, updated_at: iso });
    put('ws_collection_runs', { id: 'run-purge', account_id: 'default', status: 'completed', total: 1, discovered: 1, completed: 1, analyzing: 1, analyzed: 1, failed: 0, skipped: 0, retryable: 0, last_error: '', checkpoint: '', cursor: '', resume_count: 0, last_success_at: iso, created_at: iso, updated_at: iso });
    put('ws_collection_items', { id: 'item-purge', account_id: 'default', run_id: 'run-purge', conversation_id: conversation.id, status: 'completed', attempts: 1, analysis_status: 'done', followup_status: 'scheduled', next_followup_at: iso, last_error: '', checkpoint: '', coverage_status: 'complete', created_at: iso, updated_at: iso });
    put('ai_jobs', { id: 'job-purge', account_id: 'default', conversation_id: conversation.id, idempotency_key: 'purge-job', payload_json: '{}', status: 'queued', attempts: 0, max_attempts: 5, next_attempt_at: iso, locked_at: '', lease_token: '', last_error: '', analysis_id: analysis.id, created_at: iso, updated_at: iso });
    put('ws_followup_alerts', { id: 'alert-purge', account_id: 'default', conversation_id: conversation.id, analysis_id: analysis.id, alert_key: 'purge-alert', priority: 'today', reason: '待删除', followup_time: iso, status: 'open', snoozed_until: '', data_json: '{}', created_at: iso, updated_at: iso });
    put('ws_send_audit', { id: 'send-purge', account_id: 'default', conversation_id: conversation.id, batch_id: '', operation: 'single', idempotency_key: '', original_text: '发送记录', translated_text: '', target_language: '', status: 'sent', error_message: '', native_result_json: '{}', created_at: iso, updated_at: iso });
    put('ai_customer_field_evidence', { id: 'evidence-purge', customer_id: 'C-purge', conversation_id: conversation.id, analysis_id: analysis.id, field_name: 'occupation', value_json: '"测试"', confidence: 0.9, source_text: '测试', status: 'accepted', created_at: iso, updated_at: iso });
    put('hot_chat_profiles', { id: 'profile-purge', customer_id: 'C-purge', account_id: 'default', conversation_id: conversation.id, status_color: 'gold', manual_color: '', manual_locked: 0, completeness: 10, version: 1, data_json: '{}', created_at: iso, updated_at: iso });
    put('hot_chat_profile_fields', { id: 'profile-field-purge', profile_id: 'profile-purge', field_key: 'occupation', value_json: '"测试"', state: 'known', confidence: 0.9, evidence_json: '[]', manual_locked: 0, created_at: iso, updated_at: iso });
    put('hot_chat_events', { id: 'profile-event-purge', profile_id: 'profile-purge', customer_id: 'C-purge', account_id: 'default', conversation_id: conversation.id, event_type: 'profile_updated', payload_json: '{}', source: 'AI', analysis_id: analysis.id, idempotency_key: '', created_at: iso });
    put('hot_chat_sync_outbox', { id: 'outbox-purge', profile_id: 'profile-purge', event_id: 'profile-event-purge', account_id: 'default', operation: 'upsert_profile', payload_json: '{}', status: 'pending', attempts: 0, next_attempt_at: '', last_error: '', created_at: iso, updated_at: iso });
    put('ws_group_monitor_profiles', { id: 'profile-group-purge', account_id: 'default', slot_key: 'purge-slot', status: 'paused', enabled: 0, poll_interval_sec: 45, last_heartbeat_at: '', last_error: '', data_json: '{}', created_at: iso, updated_at: iso });
    put('ws_group_monitor_targets', { id: 'target-group-purge', profile_id: 'profile-group-purge', account_id: 'default', group_jid: 'group@g.us', group_name: '删除测试群', source_id: '', channel_id: '', vip_only: 1, enabled: 0, last_snapshot_hash: '', last_seen_at: '', data_json: '{}', created_at: iso, updated_at: iso });
    put('ws_group_membership_events', { id: 'group-event-purge', account_id: 'default', profile_id: 'profile-group-purge', target_id: 'target-group-purge', group_jid: 'group@g.us', member_jid: '919876500000', member_phone: '9876500000', customer_id: 'C-purge', event_type: 'joined', event_at: iso, observed_at: iso, source: 'test', source_event_id: '', idempotency_key: 'purge-group-event', confidence: 0.9, evidence_hash: '', status: 'applied', review_reason: '', data_json: '{}', created_at: iso, updated_at: iso });
    db.close();

    const purgeRequest = await json(await request('/api/data-governance/customers/C-purge/purge-request', { method: 'POST', body: JSON.stringify({ reason: '完整性测试' }) }));
    const purged = await json(await request('/api/data-governance/customers/C-purge/purge-confirm', { method: 'POST', body: JSON.stringify({ confirmationToken: purgeRequest.confirmationToken }) }));
    assert.equal(purged.ok, true);

    const checkDb = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'));
    const counts = {
      conversations: checkDb.prepare('SELECT COUNT(*) AS n FROM ws_conversations WHERE customer_id=?').get('C-purge').n,
      messages: checkDb.prepare('SELECT COUNT(*) AS n FROM ws_messages WHERE conversation_id=?').get(conversation.id).n,
      analyses: checkDb.prepare('SELECT COUNT(*) AS n FROM ws_ai_analyses WHERE conversation_id=?').get(conversation.id).n,
      replies: checkDb.prepare('SELECT COUNT(*) AS n FROM ws_replies WHERE conversation_id=?').get(conversation.id).n,
      settings: checkDb.prepare('SELECT COUNT(*) AS n FROM ws_settings WHERE conversation_id=?').get(conversation.id).n,
      batches: checkDb.prepare('SELECT COUNT(*) AS n FROM ws_ingest_batches WHERE conversation_id=?').get(conversation.id).n,
      items: checkDb.prepare('SELECT COUNT(*) AS n FROM ws_collection_items WHERE conversation_id=?').get(conversation.id).n,
      runs: checkDb.prepare('SELECT COUNT(*) AS n FROM ws_collection_runs WHERE id=?').get('run-purge').n,
      aiJobs: checkDb.prepare('SELECT COUNT(*) AS n FROM ai_jobs WHERE conversation_id=?').get(conversation.id).n,
      alerts: checkDb.prepare('SELECT COUNT(*) AS n FROM ws_followup_alerts WHERE conversation_id=?').get(conversation.id).n,
      sends: checkDb.prepare('SELECT COUNT(*) AS n FROM ws_send_audit WHERE conversation_id=?').get(conversation.id).n,
      evidence: checkDb.prepare('SELECT COUNT(*) AS n FROM ai_customer_field_evidence WHERE customer_id=?').get('C-purge').n,
      profiles: checkDb.prepare('SELECT COUNT(*) AS n FROM hot_chat_profiles WHERE customer_id=?').get('C-purge').n,
      profileFields: checkDb.prepare('SELECT COUNT(*) AS n FROM hot_chat_profile_fields WHERE profile_id=?').get('profile-purge').n,
      profileEvents: checkDb.prepare('SELECT COUNT(*) AS n FROM hot_chat_events WHERE customer_id=?').get('C-purge').n,
      outbox: checkDb.prepare('SELECT COUNT(*) AS n FROM hot_chat_sync_outbox WHERE profile_id=?').get('profile-purge').n,
      groupEvents: checkDb.prepare('SELECT COUNT(*) AS n FROM ws_group_membership_events WHERE customer_id=?').get('C-purge').n,
      deleteRequests: checkDb.prepare('SELECT COUNT(*) AS n FROM customer_delete_requests WHERE customer_id=?').get('C-purge').n,
    };
    checkDb.close();
    for (const [name, count] of Object.entries(counts)) assert.equal(count, 0, `${name} should be purged, got ${count}`);
    const state = await json(await request('/api/state'));
    assert.equal(state.customers.some(item => item.id === 'C-purge'), false);
    console.log('customer purge completeness: all customer-linked WS, AI, task and group records removed');
  } finally {
    try { await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { ...headers, 'x-zhike-shutdown-token': token } }); } catch {}
    if (child.exitCode === null) child.kill();
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
