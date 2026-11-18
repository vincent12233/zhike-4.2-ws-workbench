'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const app = path.join(repo, 'resources', 'app');
const server = readFileSync(path.join(app, 'server.mjs'), 'utf8');
const renderer = readFileSync(path.join(app, 'app.js'), 'utf8');
const saveSnapshot = server.match(/function saveSnapshot\(reason\) \{[\s\S]*?\n\}/)?.[0] || '';
assert.match(saveSnapshot, /SAVEPOINT zhike_snapshot/, 'snapshot writes must use a savepoint so they are safe inside an active write transaction');
assert.doesNotMatch(saveSnapshot, /BEGIN IMMEDIATE/, 'snapshot writes must not open a nested top-level transaction');
assert.match(renderer, /result\.snapshotCreated!==true/, 'renderer must reject a false snapshot result before mutating data');

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-snapshot-'));
const port = 4482;
const token = 'snapshot-regression-token';
let child;
const headers = { 'content-type': 'application/json', 'x-zhike-api-token': token, origin: `http://127.0.0.1:${port}` };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function start() {
  child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
    cwd: app,
    windowsHide: true,
    env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token },
    stdio: 'ignore',
  });
}
async function request(pathname, init = {}) {
  for (let i = 0; i < 1200; i += 1) {
    try { return await fetch(`http://127.0.0.1:${port}${pathname}`, { ...init, headers: { ...headers, ...(init.headers || {}) } }); }
    catch { await wait(50); }
  }
  throw new Error('isolated server did not become available');
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  for (let i = 0; i < 80 && child.exitCode === null; i += 1) await wait(25);
  if (child.exitCode === null) child.kill('SIGKILL');
}

(async () => {
  try {
    start();
    const first = await request('/api/snapshot', { method: 'POST', body: JSON.stringify({ reason: '首次写入前自动快照' }) });
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.snapshotCreated, true, '首次写入前也必须能创建空工作区快照');
    const listed = await (await request('/api/snapshots')).json();
    assert.equal(listed.snapshots.length, 1);
    assert.equal(listed.snapshots[0].customers, 0);

    const version = await (await request('/api/state/version')).json();
    const state = { schemaVersion: 4, customers: [], savedViews: [], activities: [], tickets: [], deposits: [], followups: [], registrations: [], phoneRegistry: [], batchOperations: [], settings: { snapshotRetention: 20 }, channelAliases: {}, importIssues: [], qualityDecisions: {} };
    const saved = await request('/api/state', { method: 'PUT', headers: { 'x-state-version': version.version }, body: JSON.stringify(state) });
    assert.equal(saved.status, 200);
    const second = await request('/api/snapshot', { method: 'POST', body: JSON.stringify({ reason: '删除渠道前自动快照' }) });
    assert.equal(second.status, 200);
    assert.equal((await second.json()).snapshotCreated, true);
    const finalList = await (await request('/api/snapshots')).json();
    assert.equal(finalList.snapshots.length, 2, 'repeated snapshot creation must retain both pre-write checkpoints');
    console.log('snapshot before-write regression: empty workspace, first write and repeated channel-write snapshots passed');
  } finally {
    await stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
