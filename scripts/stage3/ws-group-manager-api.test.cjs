'use strict';

// Stage 3 isolated API integration.  This starts the real sidecar only with a
// temporary data root and the explicit Mock/isolated gate.  It never opens a
// production database, credentials, WebView profile, or real WS session.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createServer: createTcpServer } = require('node:net');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMockTransport } = require('../../resources/app/modules/ws-group-mock-transport.js');

const repo = path.resolve(__dirname, '..', '..');
const app = path.join(repo, 'resources', 'app');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function freePort() {
  const probe = createTcpServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const address = probe.address();
  const port = Number(address && typeof address === 'object' ? address.port : 0);
  await new Promise(resolve => probe.close(resolve));
  if (!port) throw new Error('failed to allocate test port');
  return port;
}

function startServer(dataDir, port, isolated) {
  const token = `stage3-api-${isolated ? 'isolated' : 'disabled'}`;
  const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
    cwd: app,
    windowsHide: true,
    env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token, ...(isolated ? { ZHIKE_GROUP_MANAGER_MODE: 'isolated', ZHIKE_STAGE3_MOCK: '1' } : {}) },
    stdio: 'ignore',
  });
  return { child, token };
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  for (let attempt = 0; attempt < 120 && child.exitCode === null; attempt += 1) await wait(25);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function request(port, token, pathname, init = {}) {
  const headers = { origin: `http://127.0.0.1:${port}`, 'x-zhike-api-token': token, 'content-type': 'application/json', ...(init.headers || {}) };
  for (let attempt = 0; attempt < 1200; attempt += 1) {
    try { return await fetch(`http://127.0.0.1:${port}${pathname}`, { ...init, headers }); }
    catch { await wait(25); }
  }
  throw new Error('stage3 isolated sidecar did not become available');
}

async function json(response) { return { response, value: await response.json() }; }

(async () => {
  const mock = createMockTransport({ fixtures: { a: { groups: [{ groupJid: '100@g.us', name: 'Mock A' }] }, b: { groups: [{ groupJid: '100@g.us', name: 'Mock B' }] } } });
  assert.deepEqual(mock.accounts(), ['a', 'b']);
  assert.equal(mock.connect('a').credentials, false);
  assert.equal(mock.listGroups('a')[0].name, 'Mock A');
  assert.equal(mock.listGroups('b')[0].name, 'Mock B');

  const disabledRoot = mkdtempSync(path.join(os.tmpdir(), 'zhike-stage3-group-api-disabled-'));
  const disabledPort = await freePort();
  const disabled = startServer(disabledRoot, disabledPort, false);
  try {
    const local = await json(await request(disabledPort, disabled.token, '/api/ws/group-manager/groups?accountId=default'));
    assert.equal(local.response.status, 200);
    assert.deepEqual(local.value.groups, []);
    const blocked = await json(await request(disabledPort, disabled.token, '/api/ws/group-manager/groups?accountId=default', { method: 'POST', body: '{}' }));
    assert.equal(blocked.response.status, 405);
    assert.equal(blocked.value.code, 'GROUP_MANAGER_WRITE_DISABLED');
  } finally {
    await stopServer(disabled.child);
    rmSync(disabledRoot, { recursive: true, force: true });
  }

  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-stage3-group-api-'));
  const port = await freePort();
  const isolated = startServer(dataDir, port, true);
  try {
    const added = await json(await request(port, isolated.token, '/api/ws/accounts', { method: 'POST', body: JSON.stringify({ id: 'account-b', displayName: '测试账号 B' }) }));
    assert.equal(added.response.status, 201);
    const groupBody = { groupJid: '1203-api@g.us', name: 'API 测试群', channelId: 'channel-a', participantCount: 2 };
    const createdGroupA = await json(await request(port, isolated.token, '/api/ws/group-manager/groups?accountId=default', { method: 'POST', body: JSON.stringify(groupBody) }));
    assert.equal(createdGroupA.response.status, 201);
    assert.equal((await json(await request(port, isolated.token, '/api/ws/group-manager/groups?accountId=account-b', { method: 'POST', body: JSON.stringify({ ...groupBody, name: '账号 B 同 JID' }) }))).response.status, 201);
    const groupsA = await json(await request(port, isolated.token, '/api/ws/group-manager/groups?accountId=default'));
    const groupsB = await json(await request(port, isolated.token, '/api/ws/group-manager/groups?accountId=account-b'));
    assert.equal(groupsA.value.groups.length, 1);
    assert.equal(groupsB.value.groups.length, 1);
    assert.equal(groupsA.value.groups[0].name, 'API 测试群');
    assert.equal(groupsB.value.groups[0].name, '账号 B 同 JID');

    const pending = await json(await request(port, isolated.token, '/api/ws/group-manager/members', { method: 'POST', body: JSON.stringify({ groupJid: groupBody.groupJid, memberJid: '919999990001@s.whatsapp.net', type: 'joined', approvalStatus: 'pending', sourceEventId: 'pending-1', eventAt: '2026-11-16T01:00:00.000Z' }) }));
    assert.equal(pending.response.status, 202);
    const stateAfterPending = await json(await request(port, isolated.token, '/api/state'));
    assert.equal(stateAfterPending.value.customers.length, 0, 'pending join must not create CRM customer');

    const joinedPayload = { groupJid: groupBody.groupJid, memberJid: '919999990001@s.whatsapp.net', type: 'joined', approvalStatus: 'confirmed', sourceEventId: 'joined-1', eventAt: '2026-11-16T01:01:00.000Z' };
    const joined = await json(await request(port, isolated.token, '/api/ws/group-manager/members', { method: 'POST', body: JSON.stringify(joinedPayload) }));
    assert.equal(joined.response.status, 201);
    assert.equal(joined.value.member.status, 'active');
    assert.ok(joined.value.customer?.id, 'confirmed join should link the existing CRM authority');
    const stateAfterJoin = await json(await request(port, isolated.token, '/api/state'));
    assert.equal(stateAfterJoin.value.customers.length, 1);
    assert.equal(stateAfterJoin.value.customers[0].source, '未分类，待绑定');
    const duplicate = await json(await request(port, isolated.token, '/api/ws/group-manager/members', { method: 'POST', body: JSON.stringify(joinedPayload) }));
    assert.equal(duplicate.response.status, 200);
    assert.equal(duplicate.value.status, 'duplicate');
    const members = await json(await request(port, isolated.token, `/api/ws/group-manager/members?accountId=default&groupJid=${encodeURIComponent(groupBody.groupJid)}`));
    assert.equal(members.value.members.length, 1);
    assert.equal(members.value.members[0].customerId, joined.value.customer.id);
    const foreignMembers = await json(await request(port, isolated.token, `/api/ws/group-manager/members?accountId=account-b&groupJid=${encodeURIComponent(groupBody.groupJid)}`));
    assert.equal(foreignMembers.value.members.length, 0);

    const message = { groupJid: groupBody.groupJid, messageId: 'api-message-1', senderJid: '919999990001@s.whatsapp.net', sentAt: '2026-11-16T01:02:00.000Z', type: 'text', sourceEvidence: 'mock-fixture' };
    const captured = await json(await request(port, isolated.token, '/api/ws/group-manager/messages?accountId=default', { method: 'POST', body: JSON.stringify(message) }));
    assert.equal(captured.response.status, 201);
    const duplicateMessage = await json(await request(port, isolated.token, '/api/ws/group-manager/messages?accountId=default', { method: 'POST', body: JSON.stringify(message) }));
    assert.equal(duplicateMessage.response.status, 200);
    assert.equal(duplicateMessage.value.status, 'duplicate');
    const invalidMessage = await json(await request(port, isolated.token, '/api/ws/group-manager/messages?accountId=default', { method: 'POST', body: JSON.stringify({ groupJid: groupBody.groupJid }) }));
    assert.equal(invalidMessage.response.status, 400);
    assert.equal(invalidMessage.value.code, 'MESSAGE_ID_REQUIRED');
    const foreignMessages = await json(await request(port, isolated.token, `/api/ws/group-manager/messages?accountId=account-b&groupJid=${encodeURIComponent(groupBody.groupJid)}`));
    assert.equal(foreignMessages.value.messages.length, 0);
    const evidence = await json(await request(port, isolated.token, '/api/ws/group-manager/read-evidence?accountId=default', { method: 'POST', body: JSON.stringify({ ...message, memberJid: '919999990001@s.whatsapp.net', status: 'read', evidence: 'mock-receipt-1' }) }));
    assert.equal(evidence.response.status, 200);
    assert.equal(evidence.value.evidence.status, 'read');
    const duplicateEvidence = await json(await request(port, isolated.token, '/api/ws/group-manager/read-evidence?accountId=default', { method: 'POST', body: JSON.stringify({ ...message, memberJid: '919999990001@s.whatsapp.net', status: 'read', evidence: 'mock-receipt-1' }) }));
    assert.equal(duplicateEvidence.response.status, 200);
    assert.equal(duplicateEvidence.value.status, 'duplicate');
    const readEvidence = await json(await request(port, isolated.token, `/api/ws/group-manager/read-evidence?accountId=default&groupJid=${encodeURIComponent(groupBody.groupJid)}`));
    assert.equal(readEvidence.value.evidence.length, 1);
    const state = await json(await request(port, isolated.token, `/api/ws/group-manager/state?accountId=default&groupJid=${encodeURIComponent(groupBody.groupJid)}`));
    assert.equal(state.response.status, 200);
    assert.equal(state.value.members.length, 1);
    assert.equal(state.value.messages.length, 1);
    assert.equal(state.value.readEvidence.length, 1);

    const sync = await json(await request(port, isolated.token, '/api/ws/group-manager/sync?accountId=default', { method: 'POST', body: JSON.stringify({ groupJid: groupBody.groupJid, kind: 'full', runId: 'sync-1' }) }));
    assert.equal(sync.response.status, 201);
    const syncDuplicate = await json(await request(port, isolated.token, '/api/ws/group-manager/sync?accountId=default', { method: 'POST', body: JSON.stringify({ groupJid: groupBody.groupJid, kind: 'full', runId: 'sync-1' }) }));
    assert.equal(syncDuplicate.response.status, 200);
    assert.equal(syncDuplicate.value.duplicate, true);
    const audit = await json(await request(port, isolated.token, '/api/ws/group-manager/audit?accountId=default'));
    assert.equal(audit.response.status, 200);
    assert.ok(audit.value.audit.some(item => item.action === 'message.capture'));
  } finally {
    await stopServer(isolated.child);
    rmSync(dataDir, { recursive: true, force: true });
  }
  console.log('stage3 group manager API, account isolation, CRM gate, idempotency and mock transport: pass');
})().catch(error => { console.error(error); process.exitCode = 1; });
