'use strict';
// Synthetic host authority for native-ingest positive fixtures; never a renderer fallback.
const nativeAuthorityToken = require('node:crypto').randomBytes(32).toString('hex');


const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { spawn } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const app = path.join(__dirname, '..', 'resources', 'app');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-group-monitor-api-'));
const port = 4588;
const token = 'group-monitor-api-token';
const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
  cwd: app,
  windowsHide: true,
  env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_NATIVE_WRITE_TOKEN: nativeAuthorityToken, ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token },
  stdio: 'ignore',
});
const headers = { 'x-zhike-native-token': nativeAuthorityToken, 'x-zhike-api-token': token, origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(pathname, init = {}) {
  for (let attempt = 0; attempt < 300; attempt++) {
    try { return await fetch(`http://127.0.0.1:${port}${pathname}`, { ...init, headers: { ...headers, ...(init.headers || {}) } }); }
    catch { await wait(50); }
  }
  throw new Error('group monitor server did not become available');
}
async function body(response) { const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value; }

(async () => {
  try {
    await body(await request('/api/ws/accounts'));
    const unscopedProfiles = await request('/api/ws/group-monitors/profiles');
    assert.equal(unscopedProfiles.status, 400, 'profile listing must be account-scoped');
    const scopedProfiles = await body(await request('/api/ws/group-monitors/profiles?accountId=default'));
    assert.ok(Array.isArray(scopedProfiles.profiles));
    await body(await request('/api/ws/ingest/batch', { method: 'POST', body: JSON.stringify({
      protocol: 'zhike.ws.ingest.batch.v1',
      accountId: 'default',
      capturedAt: '2026-11-15T05:00:00.000Z',
      scope: 'background-collector',
      messages: [],
      checkpoints: [{ conversationKey: 'ordinary-group@g.us', conversationType: 'group', isGroup: true, displayName: '普通监测群', unreadCount: 0, coverage: 'excluded-group', collectionStatus: 'skipped-group' }],
      groupEvents: [],
    }) }));
    const discoveredGroups = await body(await request('/api/ws/conversations?accountId=default&limit=20'));
    assert.ok(discoveredGroups.groupConversations.some(item => item.externalId === 'ordinary-group@g.us'), 'ordinary group identity must remain available to the monitor picker');
    assert.equal(discoveredGroups.conversations.some(item => item.externalId === 'ordinary-group@g.us'), false, 'ordinary group must remain outside the customer/AI inventory');
    await body(await request('/api/ws/accounts', { method: 'POST', body: JSON.stringify({ id: 'monitor-primary', workspaceMode: 'dedicated' }) }));
    const profile = await body(await request('/api/ws/group-monitors/profiles', { method: 'POST', body: JSON.stringify({ accountId: 'monitor-primary', slotKey: 'fixed-group-seat', enabled: true }) }));
    assert.equal(profile.profile.accountId, 'monitor-primary');
    assert.equal(profile.profile.enabled, true);
    const secondAccount = await body(await request('/api/ws/accounts', { method: 'POST', body: JSON.stringify({ id: 'ws-second', displayName: '第二账号', workspaceMode: 'dedicated' }) }));
    assert.equal(secondAccount.account.id, 'ws-second');
    const secondProfile = await body(await request('/api/ws/group-monitors/profiles', { method: 'POST', body: JSON.stringify({ accountId: 'ws-second', slotKey: 'fixed-group-seat', enabled: true }) }));
    const secondProfileAgain = await body(await request('/api/ws/group-monitors/profiles', { method: 'POST', body: JSON.stringify({ accountId: 'ws-second', slotKey: 'fixed-group-seat', enabled: true }) }));
    assert.equal(secondProfileAgain.profile.id, secondProfile.profile.id, 'same account must reuse its fixed seat');
    assert.notEqual(secondProfile.profile.slotKey, 'fixed-group-seat', 'different WS accounts must receive distinct fixed seat keys');
    const crossAccountRead = await request(`/api/ws/group-monitors/${profile.profile.id}?accountId=ws-second`);
    assert.equal(crossAccountRead.status, 404, 'a monitor profile must not be readable through another WS account');
    const crossAccountWrite = await request(`/api/ws/group-monitors/${profile.profile.id}/targets/scan?accountId=ws-second`, { method: 'POST', body: JSON.stringify({ accountId: 'ws-second', targets: [{ groupJid: '1203-cross-account@g.us', groupName: '越权群' }] }) });
    assert.equal(crossAccountWrite.status, 404, 'a monitor profile must not be writable through another WS account');
    const targets = await body(await request(`/api/ws/group-monitors/${profile.profile.id}/targets/scan?accountId=monitor-primary`, { method: 'POST', body: JSON.stringify({ accountId: 'monitor-primary', targets: [{ groupJid: '1203-456@g.us', groupName: 'VIP A', sourceId: 'source-group', enabled: true }] }) }));
    assert.equal(targets.targets.length, 1);
    const target = targets.targets[0];
    assert.equal(target.enabled, true);
    const crossAccountToggle = await request(`/api/ws/group-monitors/${profile.profile.id}/targets/${target.id}/enable?accountId=ws-second`, { method: 'POST', body: JSON.stringify({ accountId: 'ws-second' }) });
    assert.equal(crossAccountToggle.status, 404, 'a monitor target must not be mutable through another WS account');
    const crossAccountEvents = await request(`/api/ws/group-monitors/${profile.profile.id}/events?status=all&accountId=ws-second`);
    assert.equal(crossAccountEvents.status, 404, 'monitor events must not be readable through another WS account');
    const secondTargets = await body(await request(`/api/ws/group-monitors/${secondProfile.profile.id}/targets/scan?accountId=ws-second`, { method: 'POST', body: JSON.stringify({ accountId: 'ws-second', targets: [{ groupJid: '1203-999@g.us', groupName: '第二群', sourceId: 'source-second', sourceName: '渠道甲群粉', enabled: true }] }) }));
    const secondTarget = secondTargets.targets[0];
    const version = await body(await request('/api/state/version'));
    await body(await request('/api/state', { method: 'PUT', headers: { 'x-state-version': version.version }, body: JSON.stringify({ schemaVersion: 4, customers: [{ id: 'C-1', name: '测试客户', rawPhone: '+91 98765 43210', phone: '9876543210', source: '群粉', status: '未进群', phase: '新客户', deleted: false }], settings: { operatingTasks: [] }, activities: [], tickets: [], deposits: [], followups: [], registrations: [], phoneRegistry: [], batchOperations: [], importIssues: [], savedViews: [], channelAliases: {} }) }));
    const event = { accountId: 'monitor-primary', profileId: profile.profile.id, targetId: target.id, groupJid: target.groupJid, memberId: '919876543210@s.whatsapp.net', type: 'joined', sourceEventId: 'sys-1', eventAt: '2026-11-14T05:00:00.000Z', observedAt: '2026-11-14T05:00:01.000Z', confidence: 0.99 };
    const first = await body(await request('/api/ws/ingest/batch', { method: 'POST', body: JSON.stringify({ protocol: 'zhike.ws.ingest.batch.v1', accountId: 'monitor-primary', capturedAt: event.observedAt, scope: 'background-group-monitor', messages: [], checkpoints: [], groupEvents: [event] }) }));
    assert.equal(first.groupEvents.applied, 1);
    const second = await body(await request('/api/ws/ingest/batch', { method: 'POST', body: JSON.stringify({ protocol: 'zhike.ws.ingest.batch.v1', accountId: 'monitor-primary', capturedAt: event.observedAt, scope: 'background-group-monitor', messages: [], checkpoints: [], groupEvents: [event] }) }));
    assert.equal(second.groupEvents.deduplicated, 1);
    const events = await body(await request(`/api/ws/group-monitors/${profile.profile.id}/events?status=all&accountId=monitor-primary`));
    assert.equal(events.events.length, 1);
    assert.equal(events.events[0].status, 'applied');
    const crossAccountResolve = await request(`/api/ws/group-monitors/${profile.profile.id}/events/${encodeURIComponent(events.events[0].id)}/resolve?accountId=ws-second`, { method: 'POST', body: JSON.stringify({ accountId: 'ws-second', action: 'ignore' }) });
    assert.equal(crossAccountResolve.status, 404, 'monitor events must not be mutable through another WS account');
    const state = await body(await request('/api/state'));
    assert.equal(state.customers[0].groupMemberships[0].status, '在群');
    assert.equal(state.customers[0].groupMemberships[0].groupJid, target.groupJid);
    const unmatched = await body(await request('/api/ws/ingest/batch', { method: 'POST', body: JSON.stringify({ protocol: 'zhike.ws.ingest.batch.v1', accountId: 'monitor-primary', capturedAt: event.observedAt, scope: 'background-group-monitor', messages: [], checkpoints: [], groupEvents: [{ ...event, sourceEventId: 'sys-2', memberId: '919876543211@s.whatsapp.net', memberPhone: '9876543211' }] }) }));
    assert.equal(unmatched.groupEvents.applied, 1);
    assert.equal(unmatched.groupEvents.autoRegistered, 1);
    const afterAuto = await body(await request('/api/state'));
    const autoCustomer = afterAuto.customers.find(item => item.phone === '9876543211');
    assert.ok(autoCustomer, 'confirmed joined member must be registered in the customer master');
    assert.equal(autoCustomer.status, '已进群');
    assert.equal(autoCustomer.source, '群粉', 'internal source IDs must resolve to the readable group-fan channel');
    assert.equal(autoCustomer.sourceId, 'source-group');
    assert.equal(autoCustomer.groupMemberships[0].status, '在群');
    const replayWithDifferentEventId = await body(await request('/api/ws/ingest/batch', { method: 'POST', body: JSON.stringify({ protocol: 'zhike.ws.ingest.batch.v1', accountId: 'monitor-primary', capturedAt: event.observedAt, scope: 'background-group-monitor', messages: [], checkpoints: [], groupEvents: [{ ...event, sourceEventId: 'sys-2-replay', memberId: '919876543211@s.whatsapp.net', memberPhone: '9876543211' }] }) }));
    assert.equal(replayWithDifferentEventId.groupEvents.deduplicated, 1, 'an already-active membership must not be counted twice when collectors emit a new DOM event id');
    const secondAccountEvent = await body(await request('/api/ws/ingest/batch', { method: 'POST', body: JSON.stringify({ protocol: 'zhike.ws.ingest.batch.v1', accountId: 'ws-second', capturedAt: event.observedAt, scope: 'background-group-monitor', messages: [], checkpoints: [], groupEvents: [{ ...event, accountId: 'ws-second', profileId: secondProfile.profile.id, targetId: secondTarget.id, groupJid: secondTarget.groupJid, memberId: '919876543211@s.whatsapp.net', memberPhone: '9876543211', sourceEventId: 'sys-second-account' }] }) }));
    assert.equal(secondAccountEvent.groupEvents.applied, 1);
    assert.equal(secondAccountEvent.groupEvents.autoRegistered, 0, 'the same phone across WS accounts must reuse one customer');
    const afterSecondAccount = await body(await request('/api/state'));
    assert.equal(afterSecondAccount.customers.filter(item => item.phone === '9876543211').length, 1);
    const customChannelEvent = await body(await request('/api/ws/ingest/batch', { method: 'POST', body: JSON.stringify({ protocol: 'zhike.ws.ingest.batch.v1', accountId: 'ws-second', capturedAt: event.observedAt, scope: 'background-group-monitor', messages: [], checkpoints: [], groupEvents: [{ ...event, accountId: 'ws-second', profileId: secondProfile.profile.id, targetId: secondTarget.id, groupJid: secondTarget.groupJid, memberId: '919876543214@s.whatsapp.net', memberPhone: '9876543214', sourceEventId: 'sys-custom-channel' }] }) }));
    assert.equal(customChannelEvent.groupEvents.autoRegistered, 1);
    const afterCustomChannel = await body(await request('/api/state'));
    const customChannelCustomer = afterCustomChannel.customers.find(item => item.phone === '9876543214');
    assert.equal(customChannelCustomer.source, '渠道甲群粉');
    assert.equal(customChannelCustomer.groupMonitorSourceId, 'source-second');
    assert.equal(customChannelCustomer.groupFanType, '渠道甲群粉');
    assert.equal(customChannelCustomer.isGroupFan, true);
    const pendingJoin = await body(await request('/api/ws/ingest/batch', { method: 'POST', body: JSON.stringify({ protocol: 'zhike.ws.ingest.batch.v1', accountId: 'monitor-primary', capturedAt: event.observedAt, scope: 'background-group-monitor', messages: [], checkpoints: [], groupEvents: [{ ...event, sourceEventId: 'sys-pending', memberId: '919876543212@s.whatsapp.net', memberPhone: '9876543212', pending: true }] }) }));
    assert.equal(pendingJoin.groupEvents.ignored, 1, 'approval state must be ignored');
    assert.equal(pendingJoin.groupEvents.autoRegistered, 0);
    const afterPending = await body(await request('/api/state'));
    assert.equal(afterPending.customers.filter(item => item.phone === '9876543212').length, 0, 'approval state must not create a customer');
    const leftBeforeJoin = await body(await request('/api/ws/ingest/batch', { method: 'POST', body: JSON.stringify({ protocol: 'zhike.ws.ingest.batch.v1', accountId: 'monitor-primary', capturedAt: event.observedAt, scope: 'background-group-monitor', messages: [], checkpoints: [], groupEvents: [{ ...event, sourceEventId: 'sys-left-before-join', memberId: '919876543213@s.whatsapp.net', memberPhone: '9876543213', type: 'left' }] }) }));
    assert.equal(leftBeforeJoin.groupEvents.pending, 1, 'a departure without a prior customer must remain pending');
    assert.equal(leftBeforeJoin.groupEvents.autoRegistered, 0);
    const afterLeft = await body(await request('/api/state'));
    assert.equal(afterLeft.customers.filter(item => item.phone === '9876543213').length, 0);
    console.log('ws-group-monitor-api: pass');
  } finally {
    try { await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { ...headers, 'x-zhike-shutdown-token': token } }); } catch {}
    if (child.exitCode === null) child.kill();
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
