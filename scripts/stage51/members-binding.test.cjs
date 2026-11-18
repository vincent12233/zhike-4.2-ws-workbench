'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const repo = path.resolve(__dirname, '../..'), app = path.join(repo, 'resources/app');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() { const probe = createServer(); await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); }); const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); return port; }
async function apiRegression() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-stage51-members-')), port = await freePort(), token = 'stage51-members-synthetic';
  const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], { cwd: app, windowsHide: true, env: { ...process.env, ZHIKE_DATA_DIR: root, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token, ZHIKE_GROUP_MANAGER_MODE: 'isolated', ZHIKE_STAGE3_MOCK: '1' }, stdio: 'ignore' });
  const request = async (route, body, method = 'GET', more = {}) => { const response = await fetch('http://127.0.0.1:' + port + route, { method, headers: { origin: 'http://127.0.0.1:' + port, 'content-type': 'application/json', 'x-zhike-api-token': token, ...more }, ...(body == null ? {} : { body: JSON.stringify(body) }) }); return { response, value: await response.json() }; };
  try {
    let healthy = false; for (let attempt = 0; attempt < 1200; attempt++) { try { healthy = (await fetch('http://127.0.0.1:' + port + '/api/health')).ok; } catch {} if (healthy) break; await wait(25); } assert.equal(healthy, true);
    const state = (await request('/api/state')).value, version = (await request('/api/state/version')).value.version;
    const put = await request('/api/state', { ...state, customers: [{ id: 'C-member', name: 'Synthetic member', phone: '919000000061', rawPhone: '919000000061', deleted: false }] }, 'PUT', { 'x-state-version': String(version) }); assert.equal(put.response.status, 200);
    assert.equal((await request('/api/ws/accounts', { id: 'members-b', displayName: 'Synthetic B' }, 'POST')).response.status, 201);
    for (const accountId of ['default', 'members-b']) for (const groupJid of ['12035161@g.us', '12035162@g.us']) {
      assert.equal((await request('/api/ws/group-manager/groups?accountId=' + accountId, { groupJid, name: accountId + ' synthetic group' }, 'POST')).response.status, 201);
      const joined = await request('/api/ws/group-manager/members?accountId=' + accountId, { groupJid, memberJid: '919000000061@s.whatsapp.net', type: 'joined', approvalStatus: 'confirmed', sourceEventId: accountId + ':' + groupJid }, 'POST'); assert.equal(joined.response.status, 201, JSON.stringify(joined.value));
    }
    const allA = await request('/api/ws/group-manager/members?accountId=default'); assert.equal(allA.response.status, 200, JSON.stringify(allA.value)); assert.equal(allA.value.members.length, 2); assert.ok(allA.value.members.every(row => row.accountId === 'default' && row.customerId === 'C-member')); assert.equal(new Set(allA.value.members.map(row => row.id)).size, 2);
    const allB = await request('/api/ws/group-manager/members?accountId=members-b'); assert.equal(allB.value.members.length, 2); assert.ok(allB.value.members.every(row => row.accountId === 'members-b')); assert.equal(allB.value.members[0].groupName, 'members-b synthetic group');
    const one = await request('/api/ws/group-manager/members?accountId=default&groupJid=12035161%40g.us'); assert.equal(one.value.members.length, 1);
    assert.equal((await request('/api/ws/group-manager/members?accountId=default&limit=1')).value.members.length, 1);
    assert.equal((await request('/api/ws/group-manager/members?accountId=default&limit=99999')).value.limit, 1000);
    assert.equal((await request('/api/ws/group-manager/members?accountId=missing-account')).response.status, 404);
    assert.equal((await request('/api/ws/group-manager/members?accountId=default&groupJid=12999999%40g.us')).value.members.length, 0);
    assert.equal((await request('/api/state')).value.customers.length, 1, 'reads cannot create unknown customers');
    assert.equal((await request('/api/ws/accounts')).value.accounts.length, 2, 'unknown account reads cannot create accounts');
  } finally {
    try { await request('/api/shutdown', {}, 'POST', { 'x-zhike-shutdown-token': token }); } catch {}
    for (let attempt = 0; attempt < 100 && child.exitCode === null; attempt++) await wait(25);
    if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
async function controllerRegression() {
  const source = fs.readFileSync(path.join(app, 'modules/ws-workbench.js'), 'utf8'), start = source.indexOf('  async function loadGroupMembers('), end = source.indexOf('  async function refreshWorkspacePage(', start); assert.ok(start > 0 && end > start);
  const state = { activeAccountId: 'default', accountLoadSequence: 1, groupMembers: {} }, context = () => ({ accountId: state.activeAccountId, sequence: state.accountLoadSequence });
  const sandbox = { state, String, Array, captureContext: context, contextCurrent: c => c.accountId === state.activeAccountId && c.sequence === state.accountLoadSequence, assertContext(c) { if (!sandbox.contextCurrent(c)) throw new Error('stale'); }, api: async (url, init, c) => { assert.equal(c.accountId, 'default'); return { members: [{ accountId: 'default', memberJid: 'known', groupJid: 'g-a' }] }; } };
  vm.runInNewContext(source.slice(start, end) + '\nglobalThis.load=loadGroupMembers;', sandbox); await sandbox.load(context()); assert.equal(state.groupMembers.rows.length, 1);
  let resolve; sandbox.api = () => new Promise(done => { resolve = done; }); const task = sandbox.load(context()); state.activeAccountId = 'members-b'; state.accountLoadSequence++; state.groupMembers = { accountId: 'members-b', rows: [{ memberJid: 'B' }] }; resolve({ members: [{ accountId: 'default', memberJid: 'A' }] }); await task; assert.equal(state.groupMembers.rows[0].memberJid, 'B');
  sandbox.api = async () => { const error = new Error('disabled'); error.status = 404; error.code = 'GROUP_MANAGER_DISABLED'; throw error; }; await sandbox.load(context()); assert.equal(state.groupMembers.enabled, false); assert.equal(state.groupMembers.rows.length, 0);
  sandbox.api = async () => { const error = new Error('unknown account'); error.status = 404; throw error; }; await assert.rejects(() => sandbox.load(context()), /unknown account/);
  assert.match(source, /群成员明细/); assert.match(source, /已加载进退事件/); assert.match(source, /仅为既有监测服务已返回的历史范围/); assert.match(source, /state\.groupMembers/);
}
(async () => { await apiRegression(); await controllerRegression(); console.log('stage5.1 member binding: real account/group-scoped read API, CRM no-create, actual member rows, legacy disabled fallback and stale UI response rejection PASS'); })().catch(error => { console.error(error); process.exitCode = 1; });
