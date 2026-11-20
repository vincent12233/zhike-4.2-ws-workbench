'use strict';
// Dedicated WS: group config drives auto-provisioning and channel attribution.
// Real sidecar, temporary data root, synthetic join/leave events only.
const nativeAuthorityToken = require('node:crypto').randomBytes(32).toString('hex');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const app = path.join(__dirname, '..', 'resources', 'app');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-group-provision-'));
const port = 4798;
const token = require('node:crypto').randomBytes(24).toString('hex');
const base = `http://127.0.0.1:${port}`;
const headers = { 'content-type': 'application/json', 'x-zhike-native-token': nativeAuthorityToken, 'x-zhike-api-token': token, origin: base };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
  cwd: app, windowsHide: true,
  env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_NATIVE_WRITE_TOKEN: nativeAuthorityToken, ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token },
  stdio: 'ignore',
});
async function request(pathname, init = {}) {
  for (let attempt = 0; attempt < 400; attempt++) {
    try { return await fetch(base + pathname, { ...init, headers: { ...headers, ...(init.headers || {}) } }); }
    catch { await wait(50); }
  }
  throw new Error('sidecar did not become available');
}
async function api(pathname, method = 'GET', body) {
  const response = await request(pathname, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, value: await response.json().catch(() => ({})) };
}
const results = [];
async function check(name, fn) {
  try { await fn(); results.push(true); console.log('PASS ' + name); }
  catch (error) { results.push(false); console.log('FAIL ' + name + ' :: ' + error.message); }
}
const ACCOUNT = 'provision-dedicated';
const G1 = 'prov-a501@g.us', G2 = 'prov-f550@g.us', G3 = 'prov-off@g.us';
async function customers() {
  const state = (await api('/api/state')).value;
  const list = Array.isArray(state?.data?.customers) ? state.data.customers : Array.isArray(state?.customers) ? state.customers : [];
  return list.filter(customer => customer && customer.deleted !== true);
}
// The existing identity rules store a phone-JID member as its normalized phone.
const memberKey = member => member.replace(/@.*$/, '').replace(/^91(?=\d{10}$)/, '');
const byMember = async member => (await customers()).find(customer => customer.wsExternalId === memberKey(member) || customer.phone === memberKey(member));
let eventSeq = 0;
async function event(groupJid, memberId, type, eventAt, memberName = '') {
  const { status, value } = await api('/api/ws/ingest/batch', 'POST', {
    accountId: ACCOUNT,
    groupEvents: [{ groupJid, memberId, type, eventAt, sourceEventId: `prov-evt-${++eventSeq}`, confidence: 0.95, memberName }],
  });
  assert.equal(status, 200, JSON.stringify(value).slice(0, 200));
  return value.groupEvents;
}

(async () => {
  try {
    await check('prepare dedicated account, seat, three monitored groups and their configs', async () => {
      assert.equal((await api('/api/ws/accounts', 'POST', { id: ACCOUNT, workspaceMode: 'dedicated' })).status, 201);
      const seat = await api('/api/ws/group-monitors/profiles', 'POST', { accountId: ACCOUNT, slotKey: 'provision-seat', enabled: true });
      assert.ok([200, 201].includes(seat.status));
      const profileId = seat.value.profile.id;
      const scan = await api(`/api/ws/group-monitors/${profileId}/targets/scan?accountId=${ACCOUNT}`, 'POST', {
        accountId: ACCOUNT,
        targets: [
          { groupJid: G1, groupName: 'A-501 单导群', enabled: true },
          { groupJid: G2, groupName: 'F-550 粉丝群', enabled: true },
          { groupJid: G3, groupName: 'A-599 不建档群', enabled: true },
        ],
      });
      assert.ok([200, 201].includes(scan.status), 'targets ' + scan.status);
      const config = await api('/api/ws/group-channel-configs', 'POST', { items: [
        { accountId: ACCOUNT, groupJid: G1, groupCode: 'A-501', channel: '单导K', assistant: '小王', pageCategory: '落地页1', defaultTags: '新粉,单导' },
        { accountId: ACCOUNT, groupJid: G2, groupCode: 'F-550', channel: 'FB群粉', assistant: '小李' },
        { accountId: ACCOUNT, groupJid: G3, groupCode: 'A-599', channel: 'API群粉', autoCreateCustomers: false },
      ] });
      assert.equal(config.value.applied, 3, JSON.stringify(config.value.rows?.map(row => [row.status, row.errors])));
    });

    const M1 = '917100000001@s.whatsapp.net';
    await check('confirmed join auto-creates a customer with the group channel, assistant, page, code and tags', async () => {
      const result = await event(G1, M1, 'joined', '2026-11-21T03:00:00.000Z', 'Ravi');
      assert.equal(result.autoRegistered, 1);
      const customer = await byMember(M1);
      assert.ok(customer, 'customer created');
      assert.equal(customer.source, '单导K');
      assert.equal(customer.firstSourceChannel, '单导K');
      assert.deepEqual(customer.currentChannels, ['单导K']);
      assert.equal(customer.assistant, '小王');
      assert.equal(customer.page, '落地页1');
      assert.equal(customer.groupCode, 'A-501');
      assert.deepEqual(customer.tags, ['新粉', '单导']);
      assert.equal(customer.firstSourceGroupJid, G1);
      assert.equal(customer.sourceAccountId, ACCOUNT);
      assert.equal(customer.phone, '7100000001', 'Indian +91 number normalized by the existing identity rules');
    });

    await check('joining a second group keeps first channel and owner, adds current channel', async () => {
      const before = (await customers()).length;
      await event(G2, M1, 'joined', '2026-11-21T04:00:00.000Z', 'Ravi');
      assert.equal((await customers()).length, before, 'same person is not duplicated across groups');
      const customer = await byMember(M1);
      assert.equal(customer.firstSourceChannel, '单导K', 'first source channel is never overwritten');
      assert.deepEqual([...customer.currentChannels].sort(), ['FB群粉', '单导K'].sort());
      assert.deepEqual(customer.channelHistory, ['单导K', 'FB群粉']);
      assert.equal(customer.assistant, '小王', 'cross-group join does not reassign the owner');
      assert.equal(customer.groupMemberships.filter(item => item.status === '在群').length, 2);
    });

    await check('leaving one group keeps the other relation and recomputes current channel', async () => {
      await event(G1, M1, 'left', '2026-11-21T05:00:00.000Z');
      const customer = await byMember(M1);
      assert.deepEqual(customer.currentChannels, ['FB群粉']);
      assert.equal(customer.firstSourceChannel, '单导K');
      assert.deepEqual(customer.channelHistory, ['单导K', 'FB群粉'], 'history is kept after leaving');
      assert.notEqual(customer.groupStatus, '已退群', 'still in another group');
      assert.equal(customer.groupMemberships.find(item => item.groupJid === G1).status, '已退群');
      assert.equal(customer.groupMemberships.find(item => item.groupJid === G2).status, '在群');
    });

    await check('leaving every group marks 已退群 but keeps the CRM record and attribution', async () => {
      await event(G2, M1, 'left', '2026-11-21T06:00:00.000Z');
      const customer = await byMember(M1);
      assert.ok(customer, 'customer is never deleted by leaving');
      assert.equal(customer.groupStatus, '已退群');
      assert.deepEqual(customer.currentChannels, []);
      assert.equal(customer.firstSourceChannel, '单导K');
    });

    await check('a group with 自动建档 off records the event but does not create a customer', async () => {
      const before = (await customers()).length;
      const result = await event(G3, '917100000003@s.whatsapp.net', 'joined', '2026-11-21T07:00:00.000Z', 'NoAuto');
      assert.equal(result.accepted, 1, 'event is still recorded');
      assert.equal(result.autoRegistered, 0);
      assert.equal((await customers()).length, before);
    });

    await check('an existing customer joining a no-auto group still gets the relation', async () => {
      await event(G3, M1, 'joined', '2026-11-21T08:00:00.000Z');
      const customer = await byMember(M1);
      assert.equal(customer.groupMemberships.find(item => item.groupJid === G3)?.status, '在群');
      assert.deepEqual(customer.currentChannels, ['API群粉']);
      assert.equal(customer.firstSourceChannel, '单导K');
    });

    await check('an unconfigured monitored group keeps the previous auto-create behaviour without inventing a channel', async () => {
      const profiles = (await api(`/api/ws/group-monitors/profiles?accountId=${ACCOUNT}`)).value;
      const profileId = (profiles.profiles || profiles.items || [profiles.profile]).find(Boolean)?.id;
      assert.ok(profileId, 'profile listed');
      await api(`/api/ws/group-monitors/${profileId}/targets/scan?accountId=${ACCOUNT}`, 'POST', { accountId: ACCOUNT, targets: [{ groupJid: 'prov-none@g.us', groupName: '未配置群', enabled: true }] });
      const result = await event('prov-none@g.us', '917100000004@s.whatsapp.net', 'joined', '2026-11-21T09:00:00.000Z', 'Plain');
      assert.equal(result.autoRegistered, 1);
      const customer = await byMember('917100000004@s.whatsapp.net');
      assert.equal(customer.firstSourceChannel, '', 'no channel is guessed for an unconfigured group');
      assert.deepEqual(customer.currentChannels, []);
      assert.equal(customer.assistant, '未分配');
    });
  } finally {
    child.kill();
    await wait(300);
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
  const failed = results.filter(ok => !ok).length;
  console.log(`WS group config provisioning: ${results.length - failed}/${results.length}; synthetic events, no real account or paid AI`);
  if (failed) process.exit(1);
})().catch(error => { console.error(error); child.kill(); process.exit(1); });
