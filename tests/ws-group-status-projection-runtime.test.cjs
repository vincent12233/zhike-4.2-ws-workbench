'use strict';
// Synthetic host authority for native-ingest positive fixtures; never a renderer fallback.
const nativeAuthorityToken = require('node:crypto').randomBytes(32).toString('hex');


const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const app = path.join(__dirname, '..', 'resources', 'app');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-group-status-projection-'));
const port = 4599;
const token = 'group-status-projection-token';
const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
  cwd: app,
  windowsHide: true,
  env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_NATIVE_WRITE_TOKEN: nativeAuthorityToken, ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token },
  stdio: 'ignore',
});
const headers = { 'content-type': 'application/json', 'x-zhike-native-token': nativeAuthorityToken, 'x-zhike-api-token': token, origin: `http://127.0.0.1:${port}` };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(pathname, init = {}) {
  for (let attempt = 0; attempt < 300; attempt++) {
    try { return await fetch(`http://127.0.0.1:${port}${pathname}`, { ...init, headers: { ...headers, ...(init.headers || {}) } }); }
    catch { await wait(40); }
  }
  throw new Error('group status projection server did not become available');
}
async function body(response) {
  const value = await response.json();
  assert.ok(response.ok, JSON.stringify(value));
  return value;
}
const payload = value => JSON.stringify(value);

(async () => {
  try {
    await body(await request('/api/ws/accounts', { method: 'POST', body: JSON.stringify({ id: 'status-dedicated', workspaceMode: 'dedicated' }) }));
    await body(await request('/api/state', { method: 'POST', headers: { ...headers, 'x-state-version': '' }, body: payload({
      schemaVersion: 4,
      customers: [{ id: 'C-1', name: '多群客户', phone: '9876543210', rawPhone: '+91 98765 43210', source: '群粉', status: '未进群', deleted: false, groupMemberships: [] }],
      savedViews: [], activities: [], tickets: [], deposits: [], followups: [], registrations: [], phoneRegistry: [], batchOperations: [],
      settings: { operatingTasks: [] }, channelAliases: {}, importIssues: [], qualityDecisions: {},
    }) }));
    const profile = (await body(await request('/api/ws/group-monitors/profiles', { method: 'POST', body: payload({ accountId: 'status-dedicated', slotKey: 'status-seat', enabled: true }) }))).profile;
    const targets = (await body(await request(`/api/ws/group-monitors/${profile.id}/targets/scan?accountId=status-dedicated`, { method: 'POST', body: payload({ accountId: 'status-dedicated', targets: [
      { groupJid: '1203-status-a@g.us', groupName: '渠道甲群', sourceId: 'channel-a', channelId: 'channel-a', channelName: '渠道甲群粉', enabled: true },
      { groupJid: '1203-status-b@g.us', groupName: '渠道乙群', sourceId: 'channel-b', channelId: 'channel-b', channelName: '渠道乙群粉', enabled: true },
    ] }) }))).targets;
    const event = (target, type, id) => ({ accountId: 'status-dedicated', profileId: profile.id, targetId: target.id, groupJid: target.groupJid, memberId: '919876543210@s.whatsapp.net', memberPhone: '9876543210', type, sourceEventId: id, eventAt: `2026-11-15T05:00:${id.endsWith('a') ? '00' : id.endsWith('b') ? '10' : id.endsWith('c') ? '20' : '30'}.000Z`, observedAt: `2026-11-15T05:00:${id.endsWith('a') ? '01' : id.endsWith('b') ? '11' : id.endsWith('c') ? '21' : '31'}.000Z`, confidence: 0.99 });
    const ingest = async item => body(await request('/api/ws/ingest/batch', { method: 'POST', body: payload({ accountId: 'status-dedicated', groupEvents: [item] }) }));
    await ingest(event(targets[0], 'joined', 'join-a'));
    await ingest(event(targets[1], 'joined', 'join-b'));
    let state = await body(await request('/api/state'));
    assert.equal(state.customers[0].status, '在群', 'two active relationships must be represented as in-group');
    await ingest(event(targets[0], 'left', 'left-a'));
    state = await body(await request('/api/state'));
    assert.equal(state.customers[0].status, '在群', 'leaving one group must not hide another active relationship');
    await ingest(event(targets[1], 'removed', 'removed-b'));
    state = await body(await request('/api/state'));
    assert.equal(state.customers[0].status, '已退群', 'only the final active relationship removal marks the customer left');
    console.log('ws-group-status-projection-runtime: pass');
  } finally {
    try { await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { ...headers, 'x-zhike-shutdown-token': token } }); } catch {}
    if (child.exitCode === null) child.kill();
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
