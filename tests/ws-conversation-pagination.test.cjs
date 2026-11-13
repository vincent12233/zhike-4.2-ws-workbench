'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const app = path.join(__dirname, '..', 'resources', 'app');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-ws-pagination-'));
const port = 31000 + (process.pid % 15000);
const token = `ws-pagination-${process.pid}`;
const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
  cwd: app,
  windowsHide: true,
  env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token },
  stdio: 'ignore',
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const headers = { 'content-type': 'application/json', 'x-zhike-api-token': token, origin: `http://127.0.0.1:${port}` };
async function request(pathname, init = {}) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try { return await fetch(`http://127.0.0.1:${port}${pathname}`, { ...init, headers: { ...headers, ...(init.headers || {}) } }); }
    catch { await wait(40); }
  }
  throw new Error('isolated pagination server did not become available');
}

(async () => {
  try {
    assert.equal((await request('/api/health')).status, 200);
    const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'));
    const insert = db.prepare(`INSERT INTO ws_conversations(id,account_id,external_id,title,customer_id,last_message_text,intent_level,data_json,created_at,updated_at,last_message_at,unread_count,language)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    db.exec('BEGIN IMMEDIATE');
    try {
      for (let index = 0; index < 5205; index += 1) {
        const suffix = String(index).padStart(6, '0');
        const timestamp = new Date(Date.UTC(2026, 10, 14, 0, 0, index % 60, Math.floor(index / 60) % 1000)).toISOString();
        insert.run(`page-${suffix}`, 'default', `contact-${suffix}@c.us`, `客户 ${suffix}`, '', `message ${suffix}`, '', JSON.stringify({ conversationType: 'direct', isGroup: false }), timestamp, timestamp, timestamp, 0, '');
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    db.close();

    const ids = [];
    let cursor = '';
    for (let page = 0; page < 100; page += 1) {
      const response = await request(`/api/ws/conversations?limit=333${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      assert.equal(response.status, 200);
      const body = await response.json();
      ids.push(...body.conversations.map(item => item.id));
      cursor = body.nextCursor || '';
      if (!cursor) break;
    }
    assert.equal(ids.length, 5205, 'cursor paging must return every conversation beyond the old 5000 cap');
    assert.equal(new Set(ids).size, 5205, 'cursor paging must not duplicate conversations');
    assert.equal((await request('/api/ws/conversations?cursor=not-a-valid-cursor')).status, 400, 'invalid cursors fail explicitly instead of returning a partial first page');
    console.log('WS conversation pagination: 5205 conversations loaded without gaps or duplicates');
  } finally {
    try { await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { ...headers, 'x-zhike-shutdown-token': token } }); } catch {}
    if (child.exitCode === null) child.kill();
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
