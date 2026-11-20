'use strict';
// Production HTTP routes and disposable synthetic SQLite only; no WebView/account/network service.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { observeSidecarStartup, requestWithStartupDiagnostics } = require('./helpers/sidecar-startup-observer.cjs');
const app = path.resolve(__dirname, '../resources/app');
async function fixture(configured = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-native-authority-'));
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const base = 'http://127.0.0.1:' + port;
  const apiToken = randomBytes(32).toString('hex'), nativeToken = randomBytes(32).toString('hex');
  const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
    cwd: app, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, ZHIKE_DATA_DIR: dir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: apiToken,
      ZHIKE_NATIVE_WRITE_TOKEN: configured ? nativeToken : '', ZHIKE_SHUTDOWN_TOKEN: apiToken,
      ZHIKE_PARENT_PID: '', ZHIKE_GROUP_MANAGER_MODE: '', ZHIKE_STAGE3_MOCK: '', ZHIKE_FENCING_MODE: '',
      ZHIKE_AI_PIPELINE_MODE: '', ZHIKE_STAGE4_MOCK: '' },
  });
  const closed = new Promise(resolve => child.once('close', resolve));
  const observation = observeSidecarStartup(child, { secrets: [apiToken, nativeToken] });
  async function request(route, body, { native = false, nativeValue, raw, expected = 200 } = {}) {
    const headers = { 'x-zhike-api-token': apiToken, 'content-type': 'application/json', origin: base };
    if (native) headers['x-zhike-native-token'] = nativeToken;
    if (nativeValue !== undefined) headers['x-zhike-native-token'] = nativeValue;
    const response = await fetch(base + route, { method: body !== undefined || raw !== undefined ? 'POST' : 'GET', headers,
      body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json();
    assert.equal(response.status, expected, route + ': ' + JSON.stringify(value));
    return value;
  }
  try { await requestWithStartupDiagnostics(() => request('/api/health'), observation, { attempts: 120, retryDelayMs: 50 }); }
  catch (error) { child.kill(); await closed; fs.rmSync(dir, { recursive: true, force: true }); throw error; }
  return { request, nativeToken, apiToken,
    inspect(run) { const db = new DatabaseSync(path.join(dir, 'workspace.sqlite'), { readOnly: true }); try { return run(db); } finally { db.close(); } },
    async close() {
      try { await fetch(base + '/api/shutdown', { method: 'POST', headers: { 'x-zhike-api-token': apiToken, 'x-zhike-shutdown-token': apiToken } }); } catch {}
      const timer = setTimeout(() => child.kill(), 2500); await closed; clearTimeout(timer);
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 12, retryDelay: 50 });
    },
  };
}
const message = (key, id, body = 'Synthetic observed original') => ({ conversationKey: key, externalMessageId: id,
  direction: 'incoming', directionSource: 'class-message-in', body, senderId: '917000000001@s.whatsapp.net',
  senderIdentitySource: 'sender-jid', senderIdentityTrusted: true, sentAt: '2026-11-20T10:00:00.000Z' });
const checkpoint = (key, type = 'direct') => ({ conversationKey: key, conversationType: type, historyLoaded: true,
  historyMessageCount: 1, directionVersion: 4, directionUnresolvedCount: 0, coverage: 'read-history',
  lastMessageFingerprint: 'synthetic-history' });

test('native authority separates renderer requests, history and fresh observations', { timeout: 60000 }, async t => {
  const f = await fixture();
  const request = f.request;
  const packet = { accountId: 'default', protocol: 'zhike.ws.ingest.batch.v1', connectorId: 'desktop-webview2',
    scope: 'background-collector', checkpoints: [checkpoint('917000000001')], messages: [message('917000000001', 'native-one')] };
  try {
    await t.test('ordinary session and claimed native strings cannot write any capture state', async () => {
      const before = f.inspect(db => Object.fromEntries(['ws_messages', 'ws_conversations', 'ws_group_catalog', 'ws_group_membership_events']
        .map(table => [table, db.prepare('SELECT COUNT(*) n FROM ' + table).get().n])));
      for (const nativeValue of [undefined, '', 'wrong-token', f.apiToken]) {
        const result = await request('/api/ws/ingest/batch', { ...packet, nativeAuthorityVerified: true,
          checkpoints: [...packet.checkpoints, checkpoint('spoofed@g.us', 'group')],
          groupEvents: [{ groupJid: 'spoofed@g.us', type: 'joined', source: 'ws-native-group-monitor' }] }, { nativeValue, expected: 403 });
        assert.equal(result.code, 'WS_NATIVE_AUTHORITY_REQUIRED');
      }
      await request('/api/ws/ingest/batch', undefined, { raw: 'invalid json', expected: 403 });
      const after = f.inspect(db => Object.fromEntries(Object.keys(before).map(table => [table, db.prepare('SELECT COUNT(*) n FROM ' + table).get().n])));
      assert.deepEqual(after, before);
    });
    await t.test('authenticated native packet gets server-issued provenance and preserves replay', async () => {
      assert.equal((await request('/api/ws/ingest/batch', packet, { native: true })).accepted, 1);
      const again = await request('/api/ws/ingest/batch', packet, { native: true });
      assert.equal(again.accepted, 0); assert.equal(again.deduplicated, 1);
      const row = f.inspect(db => db.prepare("SELECT data_json FROM ws_messages WHERE external_id='native-one'").get());
      assert.equal(JSON.parse(row.data_json).nativeAuthorityVerified, true);
    });
    const conversation = (await request('/api/ws/conversations')).conversations.find(row => row.externalId === '917000000001');
    await t.test('single and batch manual messages cannot self-assert capture evidence', async () => {
      const data = { source: 'ws-webview2', nativeAuthorityVerified: true, directionVersion: 4,
        directionSource: 'class-message-in', senderIdentitySource: 'sender-jid', senderIdentityTrusted: true };
      const single = await request('/api/ws/messages', { conversationId: conversation.id, externalId: 'manual-one', direction: 'receive', originalText: 'Manual original', data });
      assert.equal(single.data.source, 'ws-manual'); assert.equal(single.data.nativeAuthorityVerified, false);
      await request('/api/ws/messages/batch', { conversationId: conversation.id, messages: [{ externalId: 'manual-batch', direction: 'receive', originalText: 'Manual batch', data }] });
      const rows = (await request('/api/ws/messages?conversationId=' + conversation.id)).messages.filter(row => row.externalId.startsWith('manual'));
      for (const row of rows) { assert.equal(row.data.nativeAuthorityVerified, false); assert.equal(row.data.directionSource, undefined); assert.equal(row.data.senderIdentityTrusted, false); }
    });
    await t.test('JSON restore retains originals but cannot retain or inject native authority', async () => {
      const exported = await request('/api/ws/export');
      for (const row of exported.messages) { row.data.nativeAuthorityVerified = true; row.data.source = 'ws-webview2'; }
      await request('/api/ws/import', { ...exported, accountId: 'default' });
      const rows = (await request('/api/ws/messages?conversationId=' + conversation.id)).messages;
      assert.equal(rows.length, 3);
      for (const row of rows) { assert.equal(row.data.source, 'ws-restored-history'); assert.equal(row.data.nativeAuthorityVerified, false); }
      await request('/api/ws/ingest/batch', packet, { native: true });
      const recaptured = (await request('/api/ws/messages?conversationId=' + conversation.id)).messages;
      assert.equal(recaptured.find(row => row.externalId === 'native-one').data.nativeAuthorityVerified, true);
      assert.equal(recaptured.find(row => row.externalId === 'manual-one').data.nativeAuthorityVerified, false);
    });
    await t.test('group recapture must agree on the exact member and original message', async () => {
      await request('/api/ws/accounts', { id: 'dedicated-provenance', displayName: 'Synthetic dedicated', workspaceMode: 'dedicated' }, { expected: 201 });
      const profile = (await request('/api/ws/group-monitors/profiles', { accountId: 'dedicated-provenance', slotKey: 'native-seat', enabled: true }, { expected: 201 })).profile;
      await request('/api/ws/group-monitors/' + profile.id + '/targets/scan?accountId=dedicated-provenance', { accountId: 'dedicated-provenance', targets: [{ groupJid: 'provenance@g.us', groupName: 'Synthetic group', enabled: true }] });
      const groupPacket = { accountId: 'dedicated-provenance', checkpoints: [checkpoint('provenance@g.us', 'group')], messages: [message('provenance@g.us', 'group-one')] };
      await request('/api/ws/ingest/batch', groupPacket, { native: true });
      const backup = await request('/api/ws/export?accountId=dedicated-provenance');
      assert.deepEqual(backup.accounts.map(account => account.id), ['dedicated-provenance']);
      const defaultBefore = f.inspect(db => db.prepare("SELECT id,data_json FROM ws_messages WHERE account_id='default' ORDER BY id").all());
      const wrongTarget = await request('/api/ws/import', { ...backup, accountId: 'default' }, { expected: 400 });
      assert.equal(wrongTarget.code, 'WORKSPACE_MODE_ACCOUNT_MISMATCH');
      assert.deepEqual(f.inspect(db => db.prepare("SELECT id,data_json FROM ws_messages WHERE account_id='default' ORDER BY id").all()), defaultBefore);
      await request('/api/ws/import', { ...backup, accountId: 'dedicated-provenance' });
      const row = () => f.inspect(db => JSON.parse(db.prepare("SELECT data_json FROM ws_messages WHERE account_id='dedicated-provenance' AND external_id='group-one'").get().data_json));
      assert.equal(row().nativeAuthorityVerified, false);
      for (const extra of [{ body: 'Different original' }, { senderId: '917000000002@s.whatsapp.net' }]) {
        await request('/api/ws/ingest/batch', { ...groupPacket, messages: [{ ...groupPacket.messages[0], ...extra }] }, { native: true });
        assert.equal(row().nativeAuthorityVerified, false);
      }
      await request('/api/ws/ingest/batch', groupPacket, { native: true });
      assert.equal(row().nativeAuthorityVerified, true);
    });
  } finally { await f.close(); }
});

test('standalone service without a configured native capability fails closed', { timeout: 30000 }, async () => {
  const f = await fixture(false);
  try {
    const response = await f.request('/api/ws/ingest/batch', { accountId: 'default', messages: [] }, { native: true, expected: 403 });
    assert.equal(response.code, 'WS_NATIVE_AUTHORITY_REQUIRED');
    assert.equal(f.inspect(db => db.prepare('SELECT COUNT(*) n FROM ws_messages').get().n), 0);
  } finally { await f.close(); }
});
