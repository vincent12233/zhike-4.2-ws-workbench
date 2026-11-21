'use strict';
// Real sidecar, temporary data root, synthetic groups. No real account,
// WhatsApp session, network or paid AI is used.
const nativeAuthorityToken = require('node:crypto').randomBytes(32).toString('hex');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const app = path.join(__dirname, '..', 'resources', 'app');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-group-channel-'));
const port = 4797;
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
  const raw = await response.text();
  let value; try { value = JSON.parse(raw); } catch { value = raw; }
  return { status: response.status, value, headers: response.headers };
}
const results = [];
async function check(name, fn) {
  try { await fn(); results.push(true); console.log('PASS ' + name); }
  catch (error) { results.push(false); console.log('FAIL ' + name + ' :: ' + error.message); }
}
const ACCOUNT = 'channel-dedicated';
const groups = [
  { conversationKey: '1203-a501@g.us', displayName: 'A-501 单导群', participantCount: 40, sourceId: 'collector-guess' },
  { conversationKey: '1203-f550@g.us', displayName: 'F-550 粉丝群', participantCount: 12 },
  { conversationKey: '1203-mix@g.us', displayName: 'A-560 与 F-502 合并群', participantCount: 9 },
  { conversationKey: '1203-plain@g.us', displayName: '未编号新群', participantCount: 3, source: 'ws-collector' },
];
async function ingest(list, capturedAt) {
  return api('/api/ws/ingest/batch', 'POST', {
    protocol: 'zhike.ws.ingest.batch.v1', accountId: ACCOUNT, capturedAt,
    checkpoints: list.map(item => ({ conversationType: 'group', isGroup: true, ...item })),
  });
}
const rowOf = (list, jid) => list.rows.find(row => row.groupJid === jid);

(async () => {
  try {
    const diagnostics = await (await request('/api/diagnostics')).json();
    const expectedSchemaVersion = Number(require('../resources/app/migrations/manifest.json').supportedSchemaVersion);
    assert.equal(Number(diagnostics.schemaVersion), expectedSchemaVersion, `schema ${expectedSchemaVersion} applied`);

    await check('API requires the session token', async () => {
      const response = await fetch(base + '/api/ws/group-channel-configs');
      assert.equal(response.status, 401);
    });

    await check('dedicated account groups are discovered from an empty local catalog', async () => {
      assert.equal((await api('/api/ws/accounts', 'POST', { id: ACCOUNT, workspaceMode: 'dedicated' })).status < 300, true);
      const empty = await api(`/api/ws/group-channel-configs?accountId=${ACCOUNT}`);
      assert.equal(empty.value.rows.length, 0);
      const result = await ingest(groups, '2026-11-21T01:00:00.000Z');
      assert.equal(result.status, 200, JSON.stringify(result.value).slice(0, 200));
      const list = await api(`/api/ws/group-channel-configs?accountId=${ACCOUNT}`);
      assert.equal(list.value.summary.total, 4);
      assert.equal(list.value.summary.pending, 4, 'every new group needs the user to confirm code and channel');
    });

    await check('codes are detected but not auto-confirmed; collector source is only a hint', async () => {
      const list = (await api(`/api/ws/group-channel-configs?accountId=${ACCOUNT}`)).value;
      const a501 = rowOf(list, '1203-a501@g.us');
      assert.equal(a501.detectedCode, 'A-501');
      assert.equal(a501.groupCode, '');
      assert.equal(a501.pendingReason, 'code-unconfirmed');
      assert.equal(a501.channel, '', 'collector sourceId is not an effective channel');
      assert.equal(a501.channelHint, 'collector-guess');
      assert.equal(rowOf(list, '1203-mix@g.us').detectedCodeStatus, 'ambiguous');
      assert.equal(rowOf(list, '1203-plain@g.us').channelHint, '', 'a discovery label in `source` is not a channel hint');
    });

    await check('single-group config writes and records history', async () => {
      const { status, value } = await api('/api/ws/group-channel-configs', 'POST', { accountId: ACCOUNT, groupJid: '1203-a501@g.us', groupCode: 'A-501', channel: '单导K', assistant: '小王', pageCategory: '落地页1', defaultTags: '新粉,单导', autoCreateCustomers: true, monitorMembership: true });
      assert.equal(status, 200);
      assert.equal(value.applied, 1);
      const row = rowOf((await api(`/api/ws/group-channel-configs?accountId=${ACCOUNT}`)).value, '1203-a501@g.us');
      assert.equal(row.pending, false);
      assert.equal(row.channel, '单导K');
      assert.equal(row.channelOrigin, 'manual');
      assert.deepEqual(row.defaultTags, ['新粉', '单导']);
      assert.equal(row.autoCreateCustomers, true);
      assert.equal(row.monitorActive, false, 'monitoring reflects real seats, not a config flag');
      assert.equal(Object.hasOwn(row, 'monitorMembership'), false);
      const history = (await api(`/api/ws/group-channel-configs/history?accountId=${ACCOUNT}&groupJid=1203-a501@g.us`)).value.history;
      assert.equal(history.length, 1);
      assert.equal(history[0].revision, 1);
      assert.deepEqual(history[0].changes.channel, { from: '', to: '单导K' });
    });

    await check('renaming a group keeps its channel, assistant and code', async () => {
      await ingest([{ conversationKey: '1203-a501@g.us', displayName: '单导K 新名字（原A-501）', participantCount: 41 }], '2026-11-21T02:00:00.000Z');
      const row = rowOf((await api(`/api/ws/group-channel-configs?accountId=${ACCOUNT}`)).value, '1203-a501@g.us');
      assert.equal(row.groupName, '单导K 新名字（原A-501）');
      assert.equal(row.groupCode, 'A-501');
      assert.equal(row.channel, '单导K');
      assert.equal(row.assistant, '小王');
    });

    await check('a later collector sourceId never overwrites the configured channel', async () => {
      await ingest([{ conversationKey: '1203-a501@g.us', displayName: '单导K 新名字（原A-501）', sourceId: 'something-else' }], '2026-11-21T02:30:00.000Z');
      const row = rowOf((await api(`/api/ws/group-channel-configs?accountId=${ACCOUNT}`)).value, '1203-a501@g.us');
      assert.equal(row.channel, '单导K');
      assert.equal(row.channelHint, 'something-else');
    });

    await check('duplicate group code is a conflict and is not written', async () => {
      const { status, value } = await api('/api/ws/group-channel-configs', 'POST', { accountId: ACCOUNT, groupJid: '1203-f550@g.us', groupCode: 'A-501' });
      assert.equal(status, 409);
      assert.equal(value.rows[0].status, 'conflict');
      assert.equal(rowOf((await api(`/api/ws/group-channel-configs?accountId=${ACCOUNT}`)).value, '1203-f550@g.us').groupCode, '');
    });

    await check('confirmed exact-code rule fills the channel; prefix F alone does not', async () => {
      assert.equal((await api('/api/ws/group-code-rules', 'POST', { groupCode: 'F-550', channel: 'FB群粉' })).status, 201);
      await api('/api/ws/group-channel-configs', 'POST', { accountId: ACCOUNT, groupJid: '1203-f550@g.us', groupCode: 'F-550' });
      const list = (await api(`/api/ws/group-channel-configs?accountId=${ACCOUNT}`)).value;
      const f550 = rowOf(list, '1203-f550@g.us');
      assert.equal(f550.channel, 'FB群粉');
      assert.equal(f550.channelOrigin, 'rule');
      await api('/api/ws/group-channel-configs', 'POST', { accountId: ACCOUNT, groupJid: '1203-mix@g.us', groupCode: 'F-502' });
      assert.equal(rowOf((await api(`/api/ws/group-channel-configs?accountId=${ACCOUNT}`)).value, '1203-mix@g.us').channel, '', 'F-502 has no rule, so no channel is guessed');
    });

    await check('batch set assistant on many groups changes only that field', async () => {
      const { value } = await api('/api/ws/group-channel-configs', 'POST', { patch: { assistant: '小李' }, groups: [{ accountId: ACCOUNT, groupJid: '1203-a501@g.us' }, { accountId: ACCOUNT, groupJid: '1203-f550@g.us' }] });
      assert.equal(value.applied, 2);
      const list = (await api(`/api/ws/group-channel-configs?accountId=${ACCOUNT}`)).value;
      assert.equal(rowOf(list, '1203-a501@g.us').assistant, '小李');
      assert.equal(rowOf(list, '1203-a501@g.us').channel, '单导K', 'channel untouched');
      assert.equal(rowOf(list, '1203-a501@g.us').autoCreateCustomers, true, 'switch untouched');
    });

    await check('search and filters', async () => {
      assert.equal((await api(`/api/ws/group-channel-configs?accountId=${ACCOUNT}&query=f-550`)).value.rows.length, 1);
      assert.equal((await api(`/api/ws/group-channel-configs?accountId=${ACCOUNT}&channel=${encodeURIComponent('单导K')}`)).value.rows.length, 1);
      assert.equal((await api(`/api/ws/group-channel-configs?accountId=${ACCOUNT}&assistant=${encodeURIComponent('小李')}`)).value.rows.length, 2);
      assert.equal((await api(`/api/ws/group-channel-configs?accountId=${ACCOUNT}&pending=1`)).value.rows.length, 2);
    });

    await check('CSV import previews by default and writes nothing', async () => {
      const csv = '群组ID,群组编号,渠道,跟进助理\n1203-plain@g.us,A-570,短信群粉,小赵\n1203-unknown@g.us,A-571,API群粉,\n1203-mix@g.us,A-501,,\n';
      const { status, value } = await api('/api/ws/group-channel-configs/import', 'POST', { accountId: ACCOUNT, csv });
      assert.equal(status, 200);
      assert.equal(value.dryRun, true);
      assert.deepEqual(value.rows.map(row => [row.line, row.status]), [[2, 'ok'], [3, 'rejected'], [4, 'conflict']]);
      assert.equal(rowOf((await api(`/api/ws/group-channel-configs?accountId=${ACCOUNT}`)).value, '1203-plain@g.us').groupCode, '');
    });

    await check('CSV import apply writes only clean rows', async () => {
      const csv = '群组ID,群组编号,渠道,跟进助理\n1203-plain@g.us,A-570,短信群粉,小赵\n1203-mix@g.us,A-501,,\n';
      const { value } = await api('/api/ws/group-channel-configs/import', 'POST', { accountId: ACCOUNT, csv, dryRun: false });
      assert.equal(value.applied, 1);
      const list = (await api(`/api/ws/group-channel-configs?accountId=${ACCOUNT}`)).value;
      assert.equal(rowOf(list, '1203-plain@g.us').channel, '短信群粉');
      assert.equal(rowOf(list, '1203-plain@g.us').channelOrigin, 'import');
      assert.equal(rowOf(list, '1203-mix@g.us').groupCode, 'F-502', 'conflicting row left unchanged');
      const history = (await api(`/api/ws/group-channel-configs/history?accountId=${ACCOUNT}&groupJid=1203-plain@g.us`)).value.history;
      assert.equal(history[0].origin, 'import');
    });

    await check('CSV export is Excel-friendly and exports stored values only', async () => {
      const response = await request(`/api/ws/group-channel-configs/export?accountId=${ACCOUNT}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/csv/);
      const csv = await response.text();
      assert.ok(csv.startsWith('所属账号,群组ID') || csv.charCodeAt(0) === 0xfeff, 'UTF-8 BOM for Excel');
      const f550Line = csv.split('\r\n').find(line => line.includes('1203-f550@g.us'));
      assert.match(f550Line, /F-550,,/, 'a rule-derived channel is not exported as a typed value');
    });

    await check('history is append-only with increasing revisions', async () => {
      const history = (await api(`/api/ws/group-channel-configs/history?accountId=${ACCOUNT}&groupJid=1203-a501@g.us`)).value.history;
      assert.deepEqual(history.map(row => row.revision), [2, 1]);
      assert.equal(history[0].origin, 'batch');
    });

    await check('schema keeps the catalog untouched and configs keyed by JID', async () => {
      const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'), { readOnly: true });
      try {
        const columns = db.prepare('PRAGMA table_info(ws_group_channel_configs)').all().map(col => col.name);
        for (const col of ['group_jid', 'group_code', 'channel', 'channel_origin', 'assistant', 'page_category', 'default_tags_json', 'auto_create_customers', 'monitor_membership', 'revision']) assert.ok(columns.includes(col), col);
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ws_group_catalog WHERE account_id=?').get(ACCOUNT).n, 4);
      } finally { db.close(); }
    });
  } finally {
    child.kill();
    await wait(300);
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
  const failed = results.filter(ok => !ok).length;
  console.log(`WS group channel config API: ${results.length - failed}/${results.length}; synthetic data, no real account or paid AI`);
  if (failed) process.exit(1);
})().catch(error => { console.error(error); child.kill(); process.exit(1); });
