'use strict';

const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { spawn } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const app = path.join(__dirname, '..', 'resources', 'app');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-group-summary-link-'));
const port = 4598;
const token = 'group-summary-link-token';
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
  throw new Error('group summary server did not become available');
}
async function body(response) {
  const value = await response.json();
  assert.ok(response.ok, JSON.stringify(value));
  return value;
}

(async () => {
  try {
    await body(await request('/api/ws/accounts', { method: 'POST', body: JSON.stringify({ id: 'summary-dedicated', workspaceMode: 'dedicated' }) }));
    const profile = (await body(await request('/api/ws/group-monitors/profiles', { method: 'POST', body: JSON.stringify({ accountId: 'summary-dedicated', slotKey: 'summary-seat', enabled: true }) }))).profile;
    const firstTargets = await body(await request(`/api/ws/group-monitors/${profile.id}/targets/scan?accountId=summary-dedicated`, {
      method: 'POST',
      body: JSON.stringify({ accountId: 'summary-dedicated', targets: [{ groupJid: '1203-summary@g.us', groupName: '统计群', sourceId: 'channel-fb', channelId: 'channel-fb', channelName: 'FB 群粉', enabled: true }] }),
    }));
    const target = firstTargets.targets[0];
    assert.equal(target.channelId, 'channel-fb');

    const event = { accountId: 'summary-dedicated', profileId: profile.id, targetId: target.id, groupJid: target.groupJid, memberId: '919876543210@s.whatsapp.net', type: 'joined', source: 'system-event', sourceEventId: 'summary-1', eventAt: '2026-11-15T05:00:00.000Z', observedAt: '2026-11-15T05:00:01.000Z', confidence: 0.99 };
    await body(await request('/api/ws/ingest/batch', { method: 'POST', body: JSON.stringify({ protocol: 'zhike.ws.ingest.batch.v1', accountId: 'summary-dedicated', capturedAt: event.observedAt, scope: 'background-group-monitor', messages: [], checkpoints: [], groupEvents: [event] }) }));

    const linked = await body(await request('/api/ws/group-membership-events?accountId=summary-dedicated&limit=20'));
    assert.equal(linked.events.length, 1, 'server-backed group event must be visible to group summary');
    assert.equal(linked.events[0].type, 'joined');
    assert.equal(linked.events[0].subgroup, '统计群');
    assert.equal(linked.events[0].source, 'FB 群粉');
    assert.equal(linked.events[0].channelId, 'channel-fb');

    // A list refresh that omits channelId must not erase the configured channel.
    const refreshed = await body(await request(`/api/ws/group-monitors/${profile.id}/targets/scan?accountId=summary-dedicated`, {
      method: 'POST',
      body: JSON.stringify({ accountId: 'summary-dedicated', targets: [{ groupJid: '1203-summary@g.us', groupName: '统计群', sourceId: 'manual-ws-monitor', enabled: true }] }),
    }));
    assert.equal(refreshed.targets[0].channelId, 'channel-fb', 'target channel id must remain stable when a refresh omits it');
    const afterRefresh = await body(await request('/api/ws/group-membership-events?accountId=summary-dedicated&limit=20'));
    assert.equal(afterRefresh.events[0].source, 'FB 群粉', 'target channel label must remain stable when a refresh omits metadata');

    console.log('group-summary-server-link: pass');
  } finally {
    try { await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { ...headers, 'x-zhike-shutdown-token': token } }); } catch {}
    if (child.exitCode === null) child.kill();
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
