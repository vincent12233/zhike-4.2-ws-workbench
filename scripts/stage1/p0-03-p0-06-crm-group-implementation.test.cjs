'use strict';
// Synthetic host authority for native-ingest positive fixtures; never a renderer fallback.
const nativeAuthorityToken = require('node:crypto').randomBytes(32).toString('hex');


/*
 * P0-03/P0-06 implementation gate. This test exercises the real sidecar
 * against an isolated temporary workspace. It never opens the user's
 * production database, starts a Worker, logs in to WS, or writes a production
 * queue.
 */

const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const app = path.join(repoRoot, 'resources', 'app');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-stage1-p0-crm-group-'));
const port = 4697;
const token = 'stage1-p0-crm-group-token';
const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
  cwd: app,
  windowsHide: true,
  env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_NATIVE_WRITE_TOKEN: nativeAuthorityToken, ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token },
  stdio: 'ignore',
});
const headers = { 'x-zhike-native-token': nativeAuthorityToken, 'x-zhike-api-token': token, origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(pathname, init = {}) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try { return await fetch(`http://127.0.0.1:${port}${pathname}`, { ...init, headers: { ...headers, ...(init.headers || {}) } }); }
    catch { await wait(50); }
  }
  throw new Error('isolated P0 CRM/group server did not become available');
}
async function json(response) { return response.json(); }
async function stateVersion() { return json(await request('/api/state/version')); }
async function putState(state) {
  const version = await stateVersion();
  return request('/api/state', { method: 'PUT', headers: { 'x-state-version': version.version }, body: JSON.stringify(state) });
}
function stateWith(customers) {
  return {
    schemaVersion: 4,
    customers,
    settings: { operatingTasks: [], sourceDefinitions: [] },
    activities: [], tickets: [], deposits: [], followups: [], registrations: [],
    phoneRegistry: [], batchOperations: [], importIssues: [], savedViews: [], channelAliases: {},
  };
}
function customer(id, phone, extra = {}) {
  return { id, name: id, rawPhone: phone, phone, source: '', status: '', phase: '新客户', deleted: false, ...extra };
}
async function post(pathname, payload) {
  return json(await request(pathname, { method: 'POST', body: JSON.stringify(payload) }));
}

(async () => {
  let shutdown = false;
  try {
    // The CRM master must reject canonical-phone collisions atomically and
    // provide a conflict report; it may not silently overwrite or merge.
    const duplicateResponse = await putState(stateWith([
      customer('C-duplicate-a', '+91 98765 43210'),
      customer('C-duplicate-b', '0091-9876543210'),
    ]));
    const duplicateBody = await json(duplicateResponse);
    assert.equal(duplicateResponse.status, 409, `duplicate phone write must be rejected, got ${duplicateResponse.status}: ${JSON.stringify(duplicateBody)}`);
    assert.equal(duplicateBody.code, 'CRM_PHONE_CONFLICT');
    assert.ok(Array.isArray(duplicateBody.conflicts) && duplicateBody.conflicts.length === 1, 'conflict report must name one canonical phone collision');
    const afterRejected = await json(await request('/api/state'));
    assert.equal(afterRejected.customers.length, 0, 'rejected duplicate write changed CRM state');

    // A missing source binding remains explicitly unclassified; it must never
    // be silently collapsed into the generic 群粉 channel.
    await putState(stateWith([customer('C-existing', '+91 98765 40000', { status: '未进群' })]));
    const profile = await post('/api/ws/group-monitors/profiles', { accountId: 'default', slotKey: 'p0-group-seat', enabled: true });
    const targetPayload = await post(`/api/ws/group-monitors/${profile.profile.id}/targets/scan?accountId=default`, {
      accountId: 'default',
      targets: [{ groupJid: '1203-unclassified@g.us', groupName: '未绑定来源群', enabled: true }],
    });
    const target = targetPayload.targets.find(item => item.groupJid === '1203-unclassified@g.us');
    assert.ok(target, 'scan response must return the newly configured unclassified group');
    const pendingJoin = await post('/api/ws/ingest/batch', {
      protocol: 'zhike.ws.ingest.batch.v1', accountId: 'default', capturedAt: '2026-11-15T05:59:00.000Z',
      scope: 'background-group-monitor', messages: [], checkpoints: [], groupEvents: [{
        accountId: 'default', profileId: profile.profile.id, targetId: target.id, groupJid: target.groupJid,
        memberId: '919876543297@s.whatsapp.net', memberPhone: '9876543297', type: 'joined', pending: true,
        sourceEventId: 'p0-pending-join', eventAt: '2026-11-15T05:59:00.000Z', observedAt: '2026-11-15T05:59:01.000Z', confidence: 0.99,
      }],
    });
    assert.equal(pendingJoin.groupEvents.autoRegistered, 0, 'pending approval must not auto-register a customer');
    const afterPending = await json(await request('/api/state'));
    assert.ok(!afterPending.customers.some(item => item.phone === '9876543297'), 'pending approval created a CRM row');
    const joinPayload = await post('/api/ws/ingest/batch', {
      protocol: 'zhike.ws.ingest.batch.v1', accountId: 'default', capturedAt: '2026-11-15T06:00:00.000Z',
      scope: 'background-group-monitor', messages: [], checkpoints: [], groupEvents: [{
        accountId: 'default', profileId: profile.profile.id, targetId: target.id, groupJid: target.groupJid,
        memberId: '919876543299@s.whatsapp.net', memberPhone: '9876543299', type: 'joined', sourceEventId: 'p0-missing-source-1',
        eventAt: '2026-11-15T06:00:00.000Z', observedAt: '2026-11-15T06:00:01.000Z', confidence: 0.99,
      }],
    });
    assert.equal(joinPayload.groupEvents.autoRegistered, 1);
    const afterUnclassified = await json(await request('/api/state'));
    const unclassified = afterUnclassified.customers.find(item => item.phone === '9876543299');
    assert.ok(unclassified, 'confirmed joined member should be auto-registered');
    assert.equal(unclassified.source, '', 'missing source must stay unclassified');
    assert.equal(unclassified.groupFanType, '', 'missing source must not invent a group-fan type');
    assert.equal(unclassified.groupMonitorSourceId, '', 'missing source must not invent a source id');

    // A relation ledger is authoritative for group membership.  Leaving one
    // group cannot erase an active relationship in another group.
    const targetBPayload = await post(`/api/ws/group-monitors/${profile.profile.id}/targets/scan?accountId=default`, {
      accountId: 'default', targets: [{ groupJid: '1203-second@g.us', groupName: '第二群', enabled: true }],
    });
    const targetB = targetBPayload.targets.find(item => item.groupJid === '1203-second@g.us');
    assert.ok(targetB, 'scan response must return the newly configured second group');
    const relationMemberId = '919876543298@s.whatsapp.net';
    const relationPhone = '9876543298';
    const relationEvents = [
      { targetId: target.id, groupJid: target.groupJid, sourceEventId: 'p0-rel-a-join', type: 'joined' },
      { targetId: targetB.id, groupJid: targetB.groupJid, sourceEventId: 'p0-rel-b-join', type: 'joined' },
      { targetId: target.id, groupJid: target.groupJid, sourceEventId: 'p0-rel-a-left', type: 'left' },
    ];
    for (const [index, item] of relationEvents.entries()) {
      const result = await post('/api/ws/ingest/batch', {
        protocol: 'zhike.ws.ingest.batch.v1', accountId: 'default', capturedAt: `2026-11-15T06:0${index + 1}:00.000Z`,
        scope: 'background-group-monitor', messages: [], checkpoints: [], groupEvents: [{
          accountId: 'default', profileId: profile.profile.id, ...item, memberId: relationMemberId,
          memberPhone: relationPhone, eventAt: `2026-11-15T06:0${index + 1}:00.000Z`, observedAt: `2026-11-15T06:0${index + 1}:01.000Z`, confidence: 0.99,
        }],
      });
      assert.equal(result.groupEvents.applied, 1, `relation event ${item.sourceEventId} was not applied`);
    }
    const afterRelations = await json(await request('/api/state'));
    const related = afterRelations.customers.find(item => item.phone === relationPhone);
    assert.equal(related.status, '在群', 'active membership in a second group must preserve global in-group status');
    assert.ok(related.groupMemberships.some(item => item.groupJid === targetB.groupJid && item.status === '在群'));
    assert.ok(related.groupMemberships.some(item => item.groupJid === target.groupJid && item.status === '已退群'));

    const shutdownResponse = await request('/api/shutdown', { method: 'POST', headers: { 'x-zhike-shutdown-token': token } });
    shutdown = true;
    assert.equal(shutdownResponse.status, 200);
    await wait(100);
    const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'));
    try {
      const count = Number(db.prepare('SELECT COUNT(*) AS count FROM customer_group_memberships WHERE customer_id=?').get(related.id).count || 0);
      assert.ok(count >= 2, `durable group relation ledger must contain both groups, got ${count}`);
    } finally { db.close(); }
    console.log('P0-03/P0-06 CRM authority and group identity: pass');
  } finally {
    if (!shutdown) { try { await request('/api/shutdown', { method: 'POST', headers: { 'x-zhike-shutdown-token': token } }); } catch {} }
    if (child.exitCode === null) child.kill();
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
