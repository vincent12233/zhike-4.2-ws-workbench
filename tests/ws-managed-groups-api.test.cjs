'use strict';
// Real sidecar, temporary data root, synthetic rows. No account or WhatsApp.
const nativeToken = require('node:crypto').randomBytes(32).toString('hex');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const app = path.join(__dirname, '..', 'resources', 'app');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-managed-groups-'));
const port = 4799;
const token = require('node:crypto').randomBytes(24).toString('hex');
const base = `http://127.0.0.1:${port}`;
const headers = { 'content-type': 'application/json', 'x-zhike-native-token': nativeToken, 'x-zhike-api-token': token, origin: base };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
  cwd: app, windowsHide: true,
  env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_NATIVE_WRITE_TOKEN: nativeToken, ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token, ZHIKE_STORAGE_MODE: 'local' },
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
  const text = await response.text();
  let value; try { value = JSON.parse(text); } catch { value = text; }
  return { status: response.status, value };
}
const results = [];
async function check(name, fn) {
  try { await fn(); results.push(true); console.log('PASS ' + name); }
  catch (error) { results.push(false); console.log('FAIL ' + name + ' :: ' + error.message); }
}

(async () => {
  try {
    const created = await api('/api/ws/managed-groups', 'POST', { channel: 'FB群粉', groupName: 'A-501 交流群', groupAlias: 'A-501' });
    await check('create stores only the three business fields', async () => {
      assert.equal(created.status, 200);
      const g = created.value.group;
      assert.equal(g.channel, 'FB群粉');
      assert.equal(g.groupAlias, 'A-501');
      assert.equal(g.jid, null);
      assert.equal('assistant' in g, false);
    });
    await check('alias uniqueness ignores case and extra spaces', async () => {
      const dup = await api('/api/ws/managed-groups', 'POST', { channel: '单导K', groupName: '别的群', groupAlias: '  a-501 ' });
      assert.equal(dup.status, 409);
    });
    await check('duplicate group names are allowed', async () => {
      const same = await api('/api/ws/managed-groups', 'POST', { channel: '单导K', groupName: 'A-501 交流群', groupAlias: 'A-502' });
      assert.equal(same.status, 200);
    });
    await check('missing channel is rejected and never inferred from the alias', async () => {
      const bad = await api('/api/ws/managed-groups', 'POST', { channel: '', groupName: 'x', groupAlias: 'A-999' });
      assert.equal(bad.status, 400);
    });
    await check('import previews, commits and is idempotent', async () => {
      const rows = [{ channel: '短信群粉', groupName: 'B群', groupAlias: 'B-1' }, { channel: '短信群粉', groupName: 'B群2', groupAlias: 'b-1' }];
      const preview = await api('/api/ws/managed-groups/import', 'POST', { rows, dryRun: true });
      assert.equal(preview.value.accepted.length, 1);
      assert.equal(preview.value.rejected[0].errors[0].code, 'DUPLICATE_IN_FILE');
      const commit = await api('/api/ws/managed-groups/import', 'POST', { rows, dryRun: false });
      assert.equal(commit.value.created, 1);
      const again = await api('/api/ws/managed-groups/import', 'POST', { rows: [{ channel: '短信群粉', groupName: 'B群', groupAlias: 'B-1' }], dryRun: true });
      assert.equal(again.value.accepted.length, 0);
      assert.equal(again.value.rejected[0].skipped, true);
    });
    await check('alias resolution is exact and channel comes from the record', async () => {
      const hit = await api('/api/ws/managed-groups/resolve?alias=b-1');
      assert.equal(hit.value.status, 'matched');
      assert.equal(hit.value.group.channel, '短信群粉');
      const miss = await api('/api/ws/managed-groups/resolve?alias=B-');
      assert.equal(miss.value.status, 'missing');
    });
    await check('confirmation requires a real JID; alias is refused', async () => {
      const id = created.value.group.id;
      const bad = await api('/api/ws/managed-groups/match/confirm', 'POST', { id, jid: 'A-501' });
      assert.equal(bad.status, 400);
      const ok = await api('/api/ws/managed-groups/match/confirm', 'POST', { id, jid: '120363000000000001@g.us' });
      assert.equal(ok.value.group.matchStatus, 'confirmed');
      const un = await api('/api/ws/managed-groups/match/unbind', 'POST', { id });
      assert.equal(un.value.group.jid, null);
      assert.equal(un.value.group.matchStatus, 'unmatched');
    });
    await check('editing the alias keeps the same record id', async () => {
      const id = created.value.group.id;
      const edited = await api('/api/ws/managed-groups/' + id, 'PATCH', { groupAlias: 'A-501X', channel: '单导B' });
      assert.equal(edited.value.group.id, id);
      assert.equal(edited.value.group.groupAlias, 'A-501X');
      assert.equal(edited.value.group.channel, '单导B');
    });
    await check('disable hides the group from the default list but keeps history', async () => {
      const id = created.value.group.id;
      await api('/api/ws/managed-groups/' + id, 'DELETE');
      const list = await api('/api/ws/managed-groups');
      assert.ok(!list.value.groups.some(g => g.id === id));
      const all = await api('/api/ws/managed-groups?includeDisabled=1');
      assert.ok(all.value.groups.some(g => g.id === id && g.enabled === false));
    });
    await check('every write leaves an audit record', async () => {
      const audit = await api('/api/ws/managed-groups/audit?groupId=' + created.value.group.id);
      const actions = audit.value.rows.map(row => row.action);
      for (const action of ['create', 'match-confirm', 'match-unbind', 'update', 'disable']) assert.ok(actions.includes(action), action);
    });
  } finally {
    child.kill();
    await wait(300);
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
  const failed = results.filter(ok => !ok).length;
  console.log(`Managed groups API: ${results.length - failed}/${results.length}; synthetic rows only`);
  if (failed) process.exit(1);
})().catch(error => { console.error(error); child.kill(); process.exit(1); });
