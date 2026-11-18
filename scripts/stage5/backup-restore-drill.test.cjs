'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('node:net');
const repo = path.resolve(__dirname, '..', '..');
const app = path.join(repo, 'resources/app');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() { const server = createServer(); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
async function request(port, token, route, init = {}) { const headers = { origin: `http://127.0.0.1:${port}`, 'x-zhike-api-token': token, 'content-type': 'application/json', ...(init.headers || {}) }; for (let attempt = 0; attempt < 1200; attempt += 1) { try { const response = await fetch(`http://127.0.0.1:${port}${route}`, { ...init, headers }); return { response, value: await response.json() }; } catch { await wait(25); } } throw new Error('stage5 backup sidecar unavailable'); }
(async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zhike-stage5-backup-')); const port = await freePort(); const token = 'stage5-backup';
  const child = spawn(process.execPath, ['server.mjs'], { cwd: app, windowsHide: true, env: { ...process.env, ZHIKE_DATA_DIR: root, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token }, stdio: 'ignore' }); let stopped = false;
  try {
    const current = await request(port, token, '/api/state'); assert.equal(current.response.status, 200);
    const initial = { ...current.value, customers: [{ id: 'stage5-backup-customer', name: '备份演练', phone: '919000000003', rawPhone: '919000000003', deleted: false }], settings: { ...current.value.settings, workspaceName: 'Stage5 backup' } };
    const version = (await request(port, token, '/api/state/version')).value.version;
    const put = await request(port, token, '/api/state', { method: 'PUT', headers: { 'x-state-version': String(version) }, body: JSON.stringify(initial) }); assert.equal(put.response.status, 200, JSON.stringify(put.value));
    const snapshot = await request(port, token, '/api/snapshot', { method: 'POST', body: JSON.stringify({ reason: 'stage5 backup' }) }); assert.equal(snapshot.response.status, 200);
    const snapshots = await request(port, token, '/api/snapshots'); assert.ok(snapshots.value.snapshots.length >= 1);
    const changedVersion = (await request(port, token, '/api/state/version')).value.version;
    const changed = await request(port, token, '/api/state', { method: 'PUT', headers: { 'x-state-version': String(changedVersion) }, body: JSON.stringify({ ...initial, customers: [], settings: { ...initial.settings, workspaceName: 'changed' } }) }); assert.equal(changed.response.status, 200);
    const restoreVersion = (await request(port, token, '/api/state/version')).value.version;
    const restored = await request(port, token, `/api/snapshots/${snapshots.value.snapshots[0].id}/restore`, { method: 'POST', headers: { 'x-state-version': String(restoreVersion) }, body: '{}' }); assert.equal(restored.response.status, 200, JSON.stringify(restored.value));
    const after = await request(port, token, '/api/state'); assert.equal(after.value.customers.length, 1); assert.equal(after.value.settings.workspaceName, 'Stage5 backup');
    await request(port, token, '/api/shutdown', { method: 'POST', body: '{}' }); stopped = true;
  } finally { if (!stopped) { try { await request(port, token, '/api/shutdown', { method: 'POST', body: '{}' }); } catch {} } if (child.exitCode === null) { child.kill('SIGTERM'); await wait(300); if (child.exitCode === null) child.kill('SIGKILL'); } rmSync(root, { recursive: true, force: true }); }
  console.log('stage5 backup and restore drill: isolated snapshot, state rollback and integrity boundary PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
