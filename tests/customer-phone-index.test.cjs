'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const app = path.join(__dirname, '..', 'resources', 'app');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-phone-index-'));
const port = 4611;
const token = 'phone-index-test-token';
const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
  cwd: app,
  windowsHide: true,
  env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token },
  stdio: 'ignore',
});
const headers = { 'content-type': 'application/json', 'x-zhike-api-token': token, origin: `http://127.0.0.1:${port}` };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(pathname, init = {}) {
  // Migration 024 adds the AI/CRM review tables. Keep the startup probe
  // bounded but long enough for a cold clean database to finish all
  // additive migrations on slower CI and user machines.
  for (let attempt = 0; attempt < 1200; attempt++) {
    try { return await fetch(`http://127.0.0.1:${port}${pathname}`, { ...init, headers: { ...headers, ...(init.headers || {}) } }); }
    catch { await wait(40); }
  }
  throw new Error('phone index server did not become available');
}
const body = value => JSON.stringify(value);

(async () => {
  try {
    const initial = await request('/api/state');
    const state = await initial.json();
    state.customers = [{ id: 'PHONE-INDEX-1', name: '索引客户', phone: '+91 98765 43210', rawPhone: '+91 98765 43210', deleted: false }];
    const saved = await request('/api/state', {
      method: 'PUT',
      headers: { 'x-state-version': initial.headers.get('x-state-version') || String(state.version || '') },
      body: body(state),
    });
    assert.equal(saved.status, 200);
    const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'));
    const row = db.prepare('SELECT phone_normalized FROM customers WHERE id=?').get('PHONE-INDEX-1');
    assert.equal(row.phone_normalized, '9876543210', 'CRM index must store the canonical phone digits');
    const diagnostics = await (await request('/api/diagnostics')).json();
    assert.equal(diagnostics.anomalies.phoneIndexMismatch, 0);
    assert.equal(diagnostics.anomalies.wsOrphanedCustomerLinks, 0);
    db.close();
    console.log('customer-phone-index: canonical WS/CRM phone index and diagnostics pass');
  } finally {
    try { await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { ...headers, 'x-zhike-shutdown-token': token } }); } catch {}
    if (child.exitCode === null) child.kill();
    await wait(100);
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
