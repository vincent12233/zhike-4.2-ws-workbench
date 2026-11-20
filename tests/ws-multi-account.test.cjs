const assert = require('node:assert/strict');
const { startServer } = require('./helpers/ws-account-test-sidecar.cjs');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const app = path.join(__dirname, '..', 'resources', 'app');
async function run() {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-ws-multi-account-'));
  const token = 'ws-multi-account-token';
  const server = await startServer(dataDir, token);
  try {
    const accounts = await server.request('/api/ws/accounts');
    assert.equal(accounts.status, 200, 'account listing endpoint should exist');
    const defaultPayload = await accounts.json();
    assert.ok(defaultPayload.accounts.some(account => account.id === 'default'));

    const alpha = await server.request('/api/ws/accounts', { method: 'POST', body: JSON.stringify({ id: 'alpha', displayName: 'Alpha', provider: 'whatsapp', origin: 'https://web.whatsapp.com', partitionKey: 'persist:alpha' }) });
    assert.equal(alpha.status, 201);
    const alphaBody = await alpha.json();
    assert.equal(alphaBody.account.id, 'alpha');
    assert.equal(alphaBody.account.partitionKey, 'persist:alpha');
    assert.equal(Object.hasOwn(alphaBody.account, 'cookies'), false);

    const beta = await server.request('/api/ws/accounts', { method: 'POST', body: JSON.stringify({ id: 'beta', displayName: 'Beta', provider: 'whatsapp', origin: 'https://web.whatsapp.com', partitionKey: 'persist:beta' }) });
    assert.equal(beta.status, 201);

    const connected = await server.request('/api/ws/accounts/default', { method: 'PATCH', body: JSON.stringify({ status: '已连接' }) });
    assert.equal(connected.status, 200, 'account status PATCH should be accepted');
    assert.equal((await connected.json()).account.status, '已连接', 'connected status should persist in the account row');
    const statusList = await (await server.request('/api/ws/accounts')).json();
    assert.equal(statusList.accounts.find(account => account.id === 'default').status, '已连接', 'account listing should return persisted runtime status');

    const defaultConversation = await server.request('/api/ws/conversations', { method: 'POST', body: JSON.stringify({ externalId: 'same-external', title: 'Default title' }) });
    assert.equal(defaultConversation.status, 200);
    const defaultBody = await defaultConversation.json();
    assert.equal(defaultBody.accountId, 'default');

    const alphaConversation = await server.request('/api/ws/conversations', { method: 'POST', body: JSON.stringify({ accountId: 'alpha', externalId: 'same-external', title: 'Alpha title' }) });
    assert.equal(alphaConversation.status, 200);
    const alphaConversationBody = await alphaConversation.json();
    assert.equal(alphaConversationBody.accountId, 'alpha');
    assert.notEqual(alphaConversationBody.id, defaultBody.id);

    const alphaMessages = await server.request('/api/ws/messages', { method: 'POST', body: JSON.stringify({ accountId: 'alpha', conversationId: alphaConversationBody.id, externalId: 'm1', direction: 'receive', originalText: 'secret alpha' }) });
    assert.equal(alphaMessages.status, 200);
    const defaultMessages = await server.request(`/api/ws/messages?conversationId=${encodeURIComponent(defaultBody.id)}`);
    assert.equal((await defaultMessages.json()).messages.length, 0);

    const deleted = await server.request('/api/ws/accounts/alpha', { method: 'DELETE' });
    assert.equal(deleted.status, 200);
    const afterDelete = await (await server.request('/api/ws/conversations')).json();
    assert.equal(afterDelete.conversations.some(item => item.accountId === 'alpha'), false);
    assert.equal(afterDelete.conversations.some(item => item.accountId === 'default' && item.externalId === 'same-external'), true);

    const state = await (await server.request('/api/state')).json();
    assert.ok(Array.isArray(state.customers));
  } finally {
    await server.stop();
  }

  const restarted = await startServer(dataDir, 'ws-multi-account-restart-token');
  try {
    const afterRestart = await (await restarted.request('/api/ws/accounts')).json();
    assert.ok(afterRestart.accounts.every(account => account.status === '未连接'), 'server restart should clear stale runtime account statuses');
  } finally {
    await restarted.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }

  const legacyDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-ws-legacy-backfill-'));
  const db = new DatabaseSync(path.join(legacyDir, 'workspace.sqlite'));
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE app_state (id INTEGER PRIMARY KEY CHECK(id = 1), json TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE state_snapshots (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, reason TEXT NOT NULL, json TEXT NOT NULL);
    CREATE TABLE customers (id TEXT PRIMARY KEY, phone_normalized TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', assistant TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL DEFAULT '', deleted INTEGER NOT NULL DEFAULT 0, data_json TEXT NOT NULL);
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, description TEXT NOT NULL);
  `);
  db.exec(readFileSync(path.join(app, 'migrations', '005-ws-workbench.sql'), 'utf8'));
  db.exec(readFileSync(path.join(app, 'migrations', '006-ws-workbench-hardening.sql'), 'utf8'));
  db.exec(readFileSync(path.join(app, 'migrations', '007-ws-collection-followup.sql'), 'utf8'));
  db.exec('PRAGMA user_version = 7');
  const now = '2026-11-05T00:00:00.000Z';
  db.prepare('INSERT INTO customers(id,data_json) VALUES(?,?)').run('crm-1', '{}');
  db.prepare('INSERT INTO ws_conversations(id,external_id,title,customer_id,last_message_text,intent_level,data_json,created_at,updated_at,last_message_at,unread_count,language) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('legacy-conv', 'legacy-ext', 'Legacy', '', '', '', '{}', now, now, '', 0, '');
  db.prepare('INSERT INTO ws_messages(id,conversation_id,external_id,direction,original_text,translated_text,source_language,target_language,order_no,data_json,created_at,updated_at,translation_status,translation_error,translation_attempts,last_attempt_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('legacy-msg', 'legacy-conv', 'legacy-msg-ext', 'receive', 'Hi', '', '', '', 1, '{}', now, now, 'none', '', 0, '');
  db.prepare('INSERT INTO ws_collection_runs(id,status,created_at,updated_at) VALUES(?,?,?,?)').run('legacy-run', 'created', now, now);
  db.prepare('INSERT INTO ws_collection_items(id,run_id,conversation_id,created_at,updated_at) VALUES(?,?,?,?,?)').run('legacy-item', 'legacy-run', 'legacy-conv', now, now);
  db.close();
  const legacyServer = await startServer(legacyDir, 'legacy-token');
  try {
    const conversations = await (await legacyServer.request('/api/ws/conversations')).json();
    assert.equal(conversations.conversations[0].accountId, 'default');
    const diagnostics = await (await legacyServer.request('/api/ws/diagnostics')).json();
    assert.ok(diagnostics.schemaVersion >= 8);
  } finally {
    await legacyServer.stop();
    rmSync(legacyDir, { recursive: true, force: true });
  }
}

run().then(() => console.log('ws-multi-account: pass')).catch(error => { console.error(error); process.exitCode = 1; });
