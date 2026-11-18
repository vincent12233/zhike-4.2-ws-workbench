'use strict';

const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { spawn } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const app = path.join(__dirname, '..', 'resources', 'app');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-group-monitor-migration-'));
const port = 4587;
const token = 'group-monitor-migration-token';
const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
  cwd: app,
  windowsHide: true,
  env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token },
  stdio: 'ignore',
});
const headers = { 'x-zhike-api-token': token, origin: `http://127.0.0.1:${port}` };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(pathname, init = {}) {
  for (let attempt = 0; attempt < 300; attempt++) {
    try { return await fetch(`http://127.0.0.1:${port}${pathname}`, { ...init, headers: { ...headers, ...(init.headers || {}) } }); }
    catch { await wait(50); }
  }
  throw new Error('group monitor server did not become available');
}

(async () => {
  try {
    const diagnostics = await (await request('/api/diagnostics')).json();
    assert.ok(Number(diagnostics.schemaVersion) >= 15);
    const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'));
    for (const table of ['ws_group_monitor_profiles', 'ws_group_monitor_targets', 'ws_group_membership_events', 'ws_group_monitor_checkpoints']) {
      assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?").get(table).count), 1, `missing ${table}`);
    }
    const profileColumns = db.prepare('PRAGMA table_info(ws_group_monitor_profiles)').all().map(row => row.name);
    assert.ok(profileColumns.includes('slot_key'));
    const eventColumns = db.prepare('PRAGMA table_info(ws_group_membership_events)').all().map(row => row.name);
    for (const column of ['account_id', 'target_id', 'member_jid', 'event_type', 'source_event_id', 'customer_id', 'status', 'confidence']) assert.ok(eventColumns.includes(column), `missing ${column}`);
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_ws_group_%'").all().map(row => row.name);
    assert.ok(indexes.length >= 4);
    db.close();
    console.log('ws-group-monitor-migration: pass');
  } finally {
    try { await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { ...headers, 'x-zhike-shutdown-token': token } }); } catch {}
    if (child.exitCode === null) child.kill();
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
