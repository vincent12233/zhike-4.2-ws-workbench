'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const app = path.join(__dirname, '..', 'resources', 'app');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-group-monitor-ingest-'));
const port = 4592;
const token = 'group-monitor-ingest-token';
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
  throw new Error('group monitor ingest server did not become available');
}
const json = response => response.json();
const body = value => JSON.stringify(value);

(async () => {
  try {
    const initial = {
      schemaVersion: 4,
      customers: [{ id: 'C-1', name: '已有客户', phone: '9876543210', rawPhone: '+91 98765 43210', source: '群粉', status: '待跟进', deleted: false }],
      savedViews: [], activities: [], tickets: [], deposits: [], followups: [], registrations: [], phoneRegistry: [], batchOperations: [],
      settings: { operatingTasks: [], groupMembershipMappings: [{ accountId: 'default', groupJid: '1203-456@g.us', memberId: 'manual-member', customerId: 'C-1' }] }, channelAliases: {}, importIssues: [], qualityDecisions: {},
    };
    assert.equal((await request('/api/state', { method: 'POST', headers: { ...headers, 'x-state-version': '' }, body: body(initial) })).status, 200);
    const profile = (await json(await request('/api/ws/group-monitors/profiles', { method: 'POST', body: body({ accountId: 'default', slotKey: 'fixed-seat', enabled: true }) }))).profile;
    const target = (await json(await request(`/api/ws/group-monitors/${profile.id}/targets/scan?accountId=default`, { method: 'POST', body: body({ accountId: 'default', targets: [{ groupJid: '1203-456@g.us', groupName: 'VIP 群', sourceId: 'source-group', vipOnly: true }] }) }))).targets[0];
    await request(`/api/ws/group-monitors/${profile.id}/targets/${target.id}/enable?accountId=default`, { method: 'POST', body: body({ accountId: 'default' }) });

    const event = { targetId: target.id, groupJid: target.groupJid, memberId: '919876543210@s.whatsapp.net', type: 'joined', sourceEventId: 'system-1', eventAt: '2026-11-14T05:00:00.000Z', confidence: 0.99 };
    const first = await json(await request('/api/ws/ingest/batch', { method: 'POST', body: body({ accountId: 'default', groupEvents: [event], checkpoints: [{ targetId: target.id, cursor: 'cursor-1', eventAt: event.eventAt }] }) }));
    assert.equal(first.groupEvents.accepted, 1);
    assert.equal(first.groupEvents.applied, 1);
    const events = await json(await request(`/api/ws/group-monitors/${profile.id}/events?status=applied&accountId=default`));
    assert.equal(events.events.length, 1);
    assert.equal(events.events[0].customerId, 'C-1');
    const state = await json(await request('/api/state'));
    assert.equal(state.customers[0].groupMemberships.length, 1);
    assert.equal(state.customers[0].groupMemberships[0].status, '在群');
    assert.equal(state.customers[0].statusHistory.length, 1);

    const replay = await json(await request('/api/ws/ingest/batch', { method: 'POST', body: body({ accountId: 'default', groupEvents: [event] }) }));
    assert.equal(replay.groupEvents.deduplicated, 1);
    const afterReplay = await json(await request('/api/state'));
    assert.equal(afterReplay.customers[0].statusHistory.length, 1, 'replay must not append a second status event');

    const manual = await json(await request('/api/ws/ingest/batch', { method: 'POST', body: body({ accountId: 'default', groupEvents: [{ ...event, memberId: 'manual-member', sourceEventId: 'system-manual', type: 'joined' }] }) }));
    assert.ok(manual.groupEvents, `manual group event request failed: ${JSON.stringify(manual)}`);
    assert.equal(manual.groupEvents.applied, 1, 'legacy groupMembershipMappings must resolve an existing customer');

    const unknown = await json(await request('/api/ws/ingest/batch', { method: 'POST', body: body({ accountId: 'default', groupEvents: [{ ...event, memberId: 'unknown@lid', sourceEventId: 'system-unknown', type: 'left' }] }) }));
    assert.equal(unknown.groupEvents.pending, 1);
    const pending = await json(await request(`/api/ws/group-monitors/${profile.id}/events?status=pending&accountId=default`));
    assert.equal(pending.events.length, 1);
    const noNewCustomer = await json(await request('/api/state'));
    assert.equal(noNewCustomer.customers.length, 1);
    const unsupported = await json(await request('/api/ws/ingest/batch', { method: 'POST', body: body({ accountId: 'default', groupEvents: [{ ...event, sourceEventId: 'system-unsupported', type: 'message' }] }) }));
    assert.equal(unsupported.groupEvents.ignored, 1);
    const allEvents = await json(await request(`/api/ws/group-monitors/${profile.id}/events?status=all&accountId=default`));
    assert.equal(allEvents.events.length, 3, 'unsupported event must not be persisted as a membership transition');
    console.log('ws-group-monitor-ingest: pass');
  } finally {
    try { await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { ...headers, 'x-zhike-shutdown-token': token } }); } catch {}
    if (child.exitCode === null) child.kill();
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
