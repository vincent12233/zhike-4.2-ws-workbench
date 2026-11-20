'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const app = path.join(__dirname, '..', 'resources', 'app');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-group-catalog-'));
const port = 4594;
const token = 'group-catalog-token';
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
  throw new Error('group catalog server did not become available');
}
const json = response => response.json();
const body = value => JSON.stringify(value);

(async () => {
  try {
    const initial = await request('/api/ws/accounts');
    assert.equal(initial.status, 200);

    const discovered = await request('/api/ws/accounts/default/groups');
    assert.equal(discovered.status, 200, 'group catalog must be available immediately after login');
    const empty = await json(discovered);
    assert.deepEqual(empty.groups, []);

    const ingest = await request('/api/ws/ingest/batch', {
      method: 'POST',
      body: body({
        protocol: 'zhike.ws.ingest.batch.v1',
        accountId: 'default',
        capturedAt: '2026-11-15T05:00:00.000Z',
        checkpoints: [
          { conversationKey: '1203-visible@g.us', conversationType: 'group', isGroup: true, displayName: '可见群', participantCount: 15, lastMessageAt: '2026-11-15T04:59:00.000Z', sourceId: 'channel-single' },
          { conversationKey: '1203-hidden@g.us', conversationType: 'group', isGroup: true, displayName: '未渲染群', participantCount: 31, lastMessageAt: '2026-11-15T04:58:00.000Z', sourceId: 'channel-fb' },
        ],
        messages: [],
        groupEvents: [],
      }),
    });
    assert.equal(ingest.status, 200);

    const catalog = await json(await request('/api/ws/accounts/default/groups'));
    assert.equal(catalog.groups.length, 2, 'all discovered groups must be returned, not only the rendered list');
    assert.equal(catalog.groups.find(item => item.groupJid === '1203-hidden@g.us').groupName, '未渲染群');
    assert.equal(catalog.groups.find(item => item.groupJid === '1203-hidden@g.us').channelId, 'channel-fb');

    assert.equal((await request('/api/ws/accounts', { method: 'POST', body: body({ id: 'catalog-dedicated', workspaceMode: 'dedicated' }) })).status, 201);
    const profile = (await json(await request('/api/ws/group-monitors/profiles', { method: 'POST', body: body({ accountId: 'catalog-dedicated', slotKey: 'catalog-seat', enabled: true }) }))).profile;
    const targets = await json(await request(`/api/ws/group-monitors/${profile.id}/targets/scan?accountId=catalog-dedicated`, {
      method: 'POST',
      body: body({ accountId: 'catalog-dedicated', targets: [{ groupJid: '1203-hidden@g.us', groupName: '未渲染群', channelId: 'channel-fb', sourceId: 'channel-fb', enabled: true }] }),
    }));
    assert.equal(targets.targets[0].channelId, 'channel-fb');

    const other = await json(await request('/api/ws/accounts', { method: 'POST', body: body({ id: 'catalog-other', displayName: '其他账号' }) }));
    assert.equal(other.account.id, 'catalog-other');
    const cross = await request('/api/ws/accounts/default/groups?accountId=catalog-other');
    assert.equal(cross.status, 404, 'group catalog must be account scoped');

    console.log('ws-group-catalog-runtime: pass');
  } finally {
    try { await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { ...headers, 'x-zhike-shutdown-token': token } }); } catch {}
    if (child.exitCode === null) child.kill();
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
