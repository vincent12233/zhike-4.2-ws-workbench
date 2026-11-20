const assert = require('node:assert/strict');
const { startServer } = require('./helpers/ws-account-test-sidecar.cjs');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function run() {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-ws-account-runtime-'));
  const server = await startServer(dataDir, 'runtime-token');
  try {
    const initial = await (await server.request('/api/ws/accounts')).json();
    const initialDefault = initial.accounts.find(account => account.id === 'default');
    assert.ok(initialDefault, 'first account list must contain the default account');
    assert.equal(initialDefault.lastSeen, null, 'never-connected accounts must use JSON null for lastSeen');
    async function patchSettings(body) {
      const result = await server.request('/api/ws/accounts/default', { method: 'PATCH', body: JSON.stringify(body) });
      assert.equal(result.status, 200);
      return (await result.json()).account.settings;
    }
    const original = { translationEnabled: false, aiEnabled: false, autoCollectionEnabled: true };
    assert.deepEqual(await patchSettings({ settings: original }), original);
    assert.deepEqual(await patchSettings({ translationEnabled: true }), { ...original, translationEnabled: true });
    assert.deepEqual(await patchSettings({ settings: { translationEnabled: false } }), original);
    assert.deepEqual(await patchSettings({ aiEnabled: true }), { ...original, aiEnabled: true });
    assert.deepEqual(await patchSettings({ autoCollectionEnabled: false }), { ...original, aiEnabled: true, autoCollectionEnabled: false });
    const connected = await server.request('/api/ws/accounts/default', { method: 'PATCH', body: JSON.stringify({ status: '已连接' }) });
    assert.equal(connected.status, 200);
    const connectedAccount = (await connected.json()).account;
    assert.equal(connectedAccount.status, '已连接');
    assert.equal(connectedAccount.lastKnownStatus, '已连接', 'last known status must be persisted separately from runtime status');
    assert.ok(connectedAccount.lastSeen, 'connected account must persist a last-seen timestamp');
  } finally {
    await server.stop();
  }

  const restarted = await startServer(dataDir, 'runtime-token-restart');
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
