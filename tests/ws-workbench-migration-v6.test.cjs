const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const app = path.join(__dirname, '..', 'resources', 'app');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-ws-v5-migration-'));
const dbPath = path.join(dataDir, 'workspace.sqlite');
const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE app_state (id INTEGER PRIMARY KEY CHECK(id = 1), json TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE state_snapshots (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, reason TEXT NOT NULL, json TEXT NOT NULL);
  CREATE TABLE customers (id TEXT PRIMARY KEY, phone_normalized TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', assistant TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL DEFAULT '', deleted INTEGER NOT NULL DEFAULT 0, data_json TEXT NOT NULL);
  CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, description TEXT NOT NULL);
`);
db.exec(readFileSync(path.join(app, 'migrations', '005-ws-workbench.sql'), 'utf8'));
db.exec('PRAGMA user_version = 5');
const now = '2026-11-05T00:00:00.000Z';
db.prepare('INSERT INTO ws_conversations(id,external_id,title,customer_id,last_message_text,intent_level,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('conv-v5', 'wa-v5', '旧会话', '', 'Hello', '', '{}', now, now);
db.prepare('INSERT INTO ws_settings(conversation_id,enabled,receive_enabled,send_enabled,target_language,show_original,ai_enabled,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('conv-v5', 0, 1, 0, '中文', 1, 1, '未连接', now, now);
db.prepare('INSERT INTO ws_messages(id,conversation_id,external_id,direction,original_text,translated_text,source_language,target_language,order_no,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('msg-v5', 'conv-v5', 'external-v5', 'receive', 'Hello', '你好', 'English', '中文', 1, '{}', now, now);
db.close();

const port = 4472;
const token = 'ws-v6-migration-token';
const child = spawn(process.execPath, ['server.mjs'], {
  cwd: app,
  windowsHide: true,
  env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token },
  stdio: 'ignore',
});
const headers = { 'x-zhike-api-token': token, origin: `http://127.0.0.1:${port}` };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(pathname, init = {}) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try { return await fetch(`http://127.0.0.1:${port}${pathname}`, { ...init, headers: { ...headers, ...(init.headers || {}) } }); }
    catch { await wait(50); }
  }
  throw new Error('migrated server did not become available');
}

(async () => {
  try {
    const diagnostics = await (await request('/api/ws/diagnostics')).json();
    assert.equal(diagnostics.schemaVersion, 6);
    const settings = await (await request('/api/ws/settings?conversationId=conv-v5')).json();
    assert.equal(settings.enabled, false);
    assert.equal(settings.receive, true);
    assert.equal(settings.send, false);
    assert.equal(settings.sendLanguage, '');
    const messages = await (await request('/api/ws/messages?conversationId=conv-v5')).json();
    assert.equal(messages.messages.length, 1);
    assert.equal(messages.messages[0].translationStatus, 'translated');
    assert.equal(messages.messages[0].translatedText, '你好');
    const exported = await (await request('/api/ws/export')).json();
    assert.equal(exported.schemaVersion, 6);
    assert.deepEqual(exported.batches, []);
    console.log('ws-workbench-migration-v6: pass');
  } finally {
    try { await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { ...headers, 'x-zhike-shutdown-token': token } }); } catch {}
    if (child.exitCode === null) child.kill();
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
