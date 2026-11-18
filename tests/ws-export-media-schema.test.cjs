'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const app = path.join(__dirname, '..', 'resources', 'app');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-ws-export-schema-'));
const port = 4597;
const token = 'ws-export-schema-token';
const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
  cwd: app,
  windowsHide: true,
  env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token },
  stdio: 'ignore',
});
const headers = { 'content-type': 'application/json', 'x-zhike-api-token': token, origin: `http://127.0.0.1:${port}` };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(pathname, init = {}) {
  for (let attempt = 0; attempt < 300; attempt++) {
    try { return await fetch(`http://127.0.0.1:${port}${pathname}`, { ...init, headers: { ...headers, ...(init.headers || {}) } }); }
    catch { await wait(40); }
  }
  throw new Error('export schema server did not become available');
}

(async () => {
  try {
    const health = await request('/api/health');
    assert.equal(health.status, 200);
    const diagnostics = await (await request('/api/ws/diagnostics')).json();
    assert.ok(diagnostics.schemaVersion >= 18, 'migration 018 must be applied before export APIs are served');
  } finally {
    try { await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { ...headers, 'x-zhike-shutdown-token': token } }); } catch {}
    if (child.exitCode === null) child.kill();
    await wait(100);
    try {
      const sqlite = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'));
      const tableNames = new Set(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
      for (const table of ['ws_media_assets', 'ws_send_attachments', 'ws_export_jobs']) assert.ok(tableNames.has(table), `${table} must exist`);
      const columns = table => new Set(sqlite.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
      for (const column of ['payload_kind', 'caption', 'attachment_ids_json']) assert.ok(columns('ws_send_audit').has(column), `ws_send_audit.${column} must exist`);
      for (const column of ['account_id', 'conversation_id', 'message_id', 'media_type', 'storage_path', 'status']) assert.ok(columns('ws_media_assets').has(column), `ws_media_assets.${column} must exist`);
      for (const column of ['account_id', 'send_audit_id', 'media_id', 'order_no', 'caption', 'status']) assert.ok(columns('ws_send_attachments').has(column), `ws_send_attachments.${column} must exist`);
      for (const column of ['id', 'scope', 'account_id', 'status', 'progress_total', 'progress_done', 'output_path', 'output_sha256']) assert.ok(columns('ws_export_jobs').has(column), `ws_export_jobs.${column} must exist`);
      sqlite.close();
    } finally {
      try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
