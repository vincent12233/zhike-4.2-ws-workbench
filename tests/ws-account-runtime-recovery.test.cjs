const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const app = path.join(__dirname, '..', 'resources', 'app');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function startServer(dataDir, port, token) {
  const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
    cwd: app,
    windowsHide: true,
    env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token },
    stdio: 'ignore',
  });
  const headers = { 'content-type': 'application/json', 'x-zhike-api-token': token, origin: `http://127.0.0.1:${port}` };
  async function request(pathname, init = {}) {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      try { return await fetch(`http://127.0.0.1:${port}${pathname}`, { ...init, headers: { ...headers, ...(init.headers || {}) } }); }
      catch { await wait(50); }
    }
    throw new Error('server did not become available');
  }
  return {
    request,
    stop: async () => {
      try { await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { ...headers, 'x-zhike-shutdown-token': token } }); } catch {}
      if (child.exitCode === null) {
        await Promise.race([new Promise(resolve => child.once('exit', resolve)), wait(1000)]);
        if (child.exitCode === null) child.kill();
      }
    },
  };
}

async function run() {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-ws-account-runtime-'));
  const server = await startServer(dataDir, 4491, 'runtime-token');
  try {
    const initial = await (await server.request('/api/ws/accounts')).json();
    const initialDefault = initial.accounts.find(account => account.id === 'default');
    assert.ok(initialDefault, 'first account list must contain the default account');
    assert.equal(initialDefault.lastSeen, null, 'never-connected accounts must use JSON null for lastSeen');
    const connected = await server.request('/api/ws/accounts/default', { method: 'PATCH', body: JSON.stringify({ status: '已连接' }) });
    assert.equal(connected.status, 200);
    const connectedAccount = (await connected.json()).account;
    assert.equal(connectedAccount.status, '已连接');
    assert.equal(connectedAccount.lastKnownStatus, '已连接', 'last known status must be persisted separately from runtime status');
    assert.ok(connectedAccount.lastSeen, 'connected account must persist a last-seen timestamp');
  } finally {
    await server.stop();
  }

  const restarted = await startServer(dataDir, 4492, 'runtime-token-restart');
  try {
    const payload = await (await restarted.request('/api/ws/accounts')).json();
    const account = payload.accounts.find(item => item.id === 'default');
    assert.ok(account, 'default account must survive a restart');
    assert.equal(account.status, '未连接', 'runtime status must not falsely claim a stale WebView is online');
    assert.equal(account.lastKnownStatus, '已连接', 'restart must retain the last observed status for reconnect guidance');
    assert.ok(account.lastSeen, 'restart must retain the last successful connection time');
  } finally {
    await restarted.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

run().then(() => console.log('ws-account-runtime-recovery: pass')).catch(error => { console.error(error); process.exitCode = 1; });
