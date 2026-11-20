'use strict';
// Synthetic host authority for native-ingest positive fixtures; never a renderer fallback.
const nativeAuthorityToken = require('node:crypto').randomBytes(32).toString('hex');

// Real production routes, disposable SQLite and synthetic native packets only.
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
const ordinary = 'ordinary-ingest', dedicated = 'dedicated-ingest', other = 'other-dedicated-ingest';
const now = '2026-11-20T05:00:00.000Z';
const checkpoint = (key, type = 'group', count = 1) => ({ conversationKey: key, conversationType: type,
  displayName: 'Same observed group name', unreadCount: 0, historyLoaded: true, historyMessageCount: count,
  coverage: 'read-history', directionVersion: 4, directionUnresolvedCount: 0 });
const message = (key, suffix = 'one', extra = {}) => ({ conversationKey: key, externalMessageId: key + '-' + suffix,
  body: 'Synthetic original ' + suffix, direction: 'incoming', directionSource: 'class-message-in',
  senderId: '917000008001@s.whatsapp.net', senderIdentitySource: 'sender-jid', sentAt: now, ...extra });

function seed(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'));
  try {
    runMigrations({ db, migrationDir: path.join(app, 'migrations'), lockPath: path.join(dataDir, 'seed.lock'), backup: false });
    for (const [id, mode] of [[ordinary, 'ordinary'], [dedicated, 'dedicated'], [other, 'dedicated']]) {
      db.prepare('INSERT INTO ws_accounts(id,display_name,workspace_mode,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, id, mode, now, now);
    }
    for (const [id, accountId] of [['ordinary-history', ordinary], ['dedicated-history', dedicated]]) {
      db.prepare('INSERT INTO ws_conversations(id,account_id,external_id,title,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
        .run(id, accountId, 'historical@g.us', 'Historical group', JSON.stringify({ conversationType: 'vip_group', vipGroup: true,
          historyLoaded: true, directionVersion: 4, historyFingerprint: 'saved-history', lastMessageFingerprint: 'saved-history' }), now, now);
      db.prepare(`INSERT INTO ws_messages(id,account_id,conversation_id,external_id,direction,original_text,data_json,created_at,updated_at)
        VALUES(?,?,?,'historical-message','receive','SAVED ORIGINAL','{}',?,?)`).run('message-' + id, accountId, id, now, now);
      db.prepare(`INSERT INTO ws_ai_analyses(id,account_id,conversation_id,result_json,created_at,updated_at) VALUES(?,?,?,'{"summary":"Saved analysis"}',?,?)`)
        .run('analysis-' + id, accountId, id, now, now);
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

test('production ingest separates purpose, group directory and observed member messages', { timeout: 60000 }, async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-ingest-purpose-'));
  seed(dataDir);
  const port = await freePort(), origin = 'http://127.0.0.1:' + port, token = randomBytes(24).toString('hex');
  const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
    cwd: app, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_NATIVE_WRITE_TOKEN: nativeAuthorityToken, ZHIKE_API_TOKEN: token,
      ZHIKE_PARENT_PID: '', ZHIKE_GROUP_MANAGER_MODE: '', ZHIKE_STAGE3_MOCK: '', ZHIKE_AI_PIPELINE_MODE: '', ZHIKE_STAGE4_MOCK: '', ZHIKE_FENCING_MODE: '' },
  });
  const closed = new Promise(resolve => child.once('close', resolve));
  const observation = observeSidecarStartup(child, { secrets: [token, nativeAuthorityToken] });
  const request = async (route, body, expected = 200) => {
    const headers = { origin, 'x-zhike-native-token': nativeAuthorityToken, 'x-zhike-api-token': token, 'content-type': 'application/json' };
    if (body !== undefined) headers['x-state-version'] = (await fetch(origin + '/api/state/version', { headers }).then(response => response.json())).version;
    const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(5000), headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json(); assert.equal(response.status, expected, `${route}: ${JSON.stringify(result)}`); return result;
  };
  const inspect = fn => { const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'), { readOnly: true }); try { return fn(db); } finally { db.close(); } };
  const protectionSnapshot = () => inspect(db => JSON.stringify(['app_state', 'customers', 'ai_jobs', 'ws_ai_analyses', 'ws_messages', 'ws_ingest_batches',
    'ws_group_membership_events', 'customer_group_memberships', 'ws_contact_exclusion_hits'].map(table => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY id').all()])));
  const conversation = (accountId, key) => inspect(db => db.prepare('SELECT * FROM ws_conversations WHERE account_id=? AND external_id=?').get(accountId, key));
  const ingest = (accountId, checkpoints, messages) => request('/api/ws/ingest/batch', { accountId, checkpoints, messages, workspaceMode: 'dedicated', vipGroup: true });
  try {
    await requestWithStartupDiagnostics(() => request('/api/health'), observation);
    const profile = (await request('/api/ws/group-monitors/profiles', { accountId: dedicated, slotKey: 'body-seat', enabled: true }, 201)).profile;
    const keys = ['canonical@g.us', 'legacy-vip@g.us', 'member-invalid@g.us', 'direction-invalid@g.us', 'preview@g.us', 'partial@g.us'];
    await request('/api/ws/group-monitors/' + profile.id + '/targets/scan?accountId=' + dedicated, { accountId: dedicated,
      targets: keys.map(groupJid => ({ groupJid, groupName: 'Same observed group name', enabled: true })) });
    const otherProfile = (await request('/api/ws/group-monitors/profiles', { accountId: other, slotKey: 'other-seat', enabled: true }, 201)).profile;
    await request('/api/ws/group-monitors/' + otherProfile.id + '/targets/scan?accountId=' + other, { accountId: other,
      targets: [{ groupJid: 'other-account@g.us', groupName: 'Same observed group name', enabled: true }] });

    await t.test('ordinary mixed packets preserve direct collection and group directory without VIP bypass', async () => {
      const result = await ingest(ordinary, [checkpoint('917000008099@s.whatsapp.net', 'direct'), checkpoint('legacy-vip@g.us', 'vip_group'), checkpoint('canonical@g.us')],
        [message('917000008099@s.whatsapp.net'), message('legacy-vip@g.us', 'vip', { direction: 'invalid' }), message('canonical@g.us')]);
      assert.equal(result.accepted, 1); assert.equal(result.skipped, 2);
      assert.equal(result.skipReasons.WS_WORKSPACE_MODE_MISMATCH, 2);
      const rows = await request('/api/ws/conversations?accountId=' + ordinary);
      assert.equal(rows.groupConversations.length, 2); assert.equal(rows.conversations.length, 2, 'existing legacy history remains visible beside direct data');
      assert.equal(inspect(db => db.prepare('SELECT COUNT(*) n FROM ws_group_catalog WHERE account_id=?').get(ordinary).n), 2);
      for (const key of ['canonical@g.us', 'legacy-vip@g.us']) {
        const row = conversation(ordinary, key);
        assert.equal(row.last_message_text, ''); assert.equal(JSON.parse(row.data_json).historyLoaded, false);
        assert.equal(inspect(db => db.prepare('SELECT COUNT(*) n FROM ws_messages WHERE conversation_id=?').get(row.id).n), 0);
      }
    });
    await t.test('complete packet identity prevents a later group marker from being treated as direct', async () => {
      const before = protectionSnapshot();
      const result = await ingest(ordinary, [checkpoint('opaque-mixed', 'direct')], [message('opaque-mixed', 'first', { conversationType: 'direct' }), message('opaque-mixed', 'later', { conversationType: 'vip_group' })]);
      assert.equal(result.accepted, 0); assert.equal(result.skipped, 2); assert.equal(protectionSnapshot(), before);
    });
    await t.test('dedicated exact targets accept canonical and legacy group messages but skip direct bodies', async () => {
      const result = await ingest(dedicated, [checkpoint('canonical@g.us'), checkpoint('legacy-vip@g.us', 'vip_group'), checkpoint('917000008099@s.whatsapp.net', 'direct')],
        [message('canonical@g.us'), message('legacy-vip@g.us'), message('917000008099@s.whatsapp.net')]);
      assert.equal(result.accepted, 2); assert.equal(result.skipped, 1); assert.equal(result.skipReasons.WS_WORKSPACE_MODE_MISMATCH, 1);
      for (const key of ['canonical@g.us', 'legacy-vip@g.us']) {
        const row = conversation(dedicated, key), data = JSON.parse(row.data_json);
        assert.equal(data.historyLoaded, true); assert.equal(data.directionVersion, 4);
        const stored = inspect(db => db.prepare('SELECT * FROM ws_messages WHERE conversation_id=?').get(row.id));
        assert.equal(JSON.parse(stored.data_json).senderIdentityTrusted, true);
      }
      assert.equal(conversation(dedicated, '917000008099@s.whatsapp.net'), undefined);
      const repeated = await ingest(dedicated, [checkpoint('canonical@g.us')], [message('canonical@g.us')]);
      assert.equal(repeated.accepted, 0); assert.equal(repeated.deduplicated, 1);
    });
    await t.test('catalog/name/other-account authorization and forged member flags do not prove observation', async () => {
      const before = protectionSnapshot();
      const bad = [
        ['catalog-only@g.us', {}, 'WS_GROUP_AUTHORIZATION_REQUIRED'],
        ['other-account@g.us', {}, 'WS_GROUP_AUTHORIZATION_REQUIRED'],
        ['opaque-label', { conversationType: 'vip_group' }, 'WS_GROUP_IDENTITY_UNCONFIRMED'],
        ['member-invalid@g.us', { senderId: '', senderPhone: '', senderIdentitySource: '', senderIdentityTrusted: true }, 'WS_GROUP_MEMBER_IDENTITY_UNCONFIRMED'],
        ['direction-invalid@g.us', { directionSource: '' }, 'WS_GROUP_DIRECTION_UNCONFIRMED'],
        ['preview@g.us', { previewOnly: true }, 'WS_GROUP_OBSERVATION_REQUIRED'],
      ];
      const result = await ingest(dedicated, bad.map(([key]) => checkpoint(key, 'vip_group')), bad.map(([key, extra]) => message(key, 'blocked', extra)));
      assert.equal(result.accepted, 0); assert.equal(result.skipped, bad.length);
      for (const code of new Set(bad.map(item => item[2]))) assert.equal(result.skipReasons[code], bad.filter(item => item[2] === code).length);
      assert.equal(protectionSnapshot(), before);
    });
    await t.test('skipped members cannot mark partially stored group history complete', async () => {
      const result = await ingest(dedicated, [checkpoint('partial@g.us', 'group', 2)],
        [message('partial@g.us', 'observed'), message('partial@g.us', 'unknown', { senderId: '', senderIdentitySource: '' })]);
      assert.equal(result.accepted, 1); assert.equal(result.skipped, 1);
      const row = conversation(dedicated, 'partial@g.us'), data = JSON.parse(row.data_json);
      assert.equal(data.historyLoaded, false); assert.equal(data.coverage, 'read-history-member-unresolved');
      await request('/api/ws/ai-jobs', { accountId: dedicated, conversationId: row.id, idempotencyKey: 'partial',
        payload: { memberScoped: true, memberIdentity: { senderId: '917000008001@s.whatsapp.net', identitySource: 'sender-jid' } } }, 422);
    });
    await t.test('manual message endpoints cannot manufacture group native evidence and saved history remains readable', async () => {
      const before = protectionSnapshot();
      const forged = { direction: 'receive', originalText: 'FORGED NATIVE', data: { source: 'ws-webview2', directionVersion: 4,
        directionSource: 'class-message-in', senderId: '917000008001@s.whatsapp.net', senderIdentitySource: 'sender-jid', senderIdentityTrusted: true } };
      for (const accountId of [ordinary, dedicated]) {
        const conversationId = accountId === ordinary ? 'ordinary-history' : 'dedicated-history';
        assert.equal((await request('/api/ws/messages', { accountId, conversationId, ...forged }, 422)).code, 'WS_GROUP_NATIVE_INGEST_REQUIRED');
        assert.equal((await request('/api/ws/messages/batch', { accountId, conversationId, messages: [forged] }, 422)).code, 'WS_GROUP_NATIVE_INGEST_REQUIRED');
        assert.equal((await request('/api/ws/messages?' + new URLSearchParams({ accountId, conversationId }))).messages[0].originalText, 'SAVED ORIGINAL');
      }
      assert.equal(protectionSnapshot(), before);
    });
    await t.test('denied ordinary legacy packets preserve saved history and analysis exactly', async () => {
      const before = protectionSnapshot();
      const beforeData = conversation(ordinary, 'historical@g.us').data_json;
      const result = await ingest(ordinary, [checkpoint('historical@g.us', 'vip_group')], [message('historical@g.us', 'late')]);
      assert.equal(result.skipped, 1); assert.equal(result.accepted, 0);
      assert.equal(conversation(ordinary, 'historical@g.us').data_json, beforeData); assert.equal(protectionSnapshot(), before);
      assert.equal((await request('/api/ws/analyses?accountId=' + ordinary + '&conversationId=ordinary-history')).analyses[0].id, 'analysis-ordinary-history');
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
