'use strict';
// Synthetic host authority for native-ingest positive fixtures; never a renderer fallback.
const nativeAuthorityToken = require('node:crypto').randomBytes(32).toString('hex');


const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { createHash, webcrypto } = require('node:crypto');
const vm = require('node:vm');
const os = require('node:os');
const path = require('node:path');

process.env.TZ = 'Asia/Kolkata';
const app = path.join(__dirname, '..', 'resources', 'app');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-group-monitor-ingest-'));
const port = 4592;
const token = 'group-monitor-ingest-token';
const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
  cwd: app,
  windowsHide: true,
  env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_NATIVE_WRITE_TOKEN: nativeAuthorityToken, ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token },
  stdio: 'ignore',
});
const headers = { 'content-type': 'application/json', 'x-zhike-native-token': nativeAuthorityToken, 'x-zhike-api-token': token, origin: `http://127.0.0.1:${port}` };
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

async function verifyHistoryBackup(customer, day) {
  const source = readFileSync(path.join(app, 'app.js'), 'utf8').replace(/\r/g, '');
  function declaration(name) {
    const start = source.search(new RegExp('^  (?:async )?function ' + name + '\\(', 'm'));
    assert.notEqual(start, -1, name);
    const tail = source.slice(start + 2);
    return tail.slice(0, tail.search(/\n  (?:async function |function |const |let )/));
  }
  const ui = vm.createContext({ today: day, window: { ZhikeBusinessRules: require('../resources/app/modules/business-rule-core.js') },
    crypto: webcrypto, TextEncoder, normalizeObjectRows: rows => rows, isGroupFanSource: label => label === '群粉' });
  vm.runInContext(['normalizeCustomerRows', 'sha256Text', 'decodeWorkspaceBackupFile', 'validateBackupData', 'validateStatusHistoryData',
    'todayStatusCounts', 'isStatusBaseline'].map(declaration).join('\n'), ui);
  const legacy = customer.statusHistory.map(event => {
    const { type, membershipEventType, from, to, initial, source, group, ...previous } = event;
    return { ...previous, type: membershipEventType, date: previous.at.slice(0, 10) };
  });
  for (const history of [customer.statusHistory, legacy]) {
    const backup = { backupFormat: 'zhike-6-workspace', version: 6, customers: [{ ...customer, statusHistory: history }] };
    backup.integrity = { algorithm: 'SHA-256', payloadSha256: createHash('sha256').update(JSON.stringify(backup)).digest('hex') };
    const decoded = await ui.decodeWorkspaceBackupFile(JSON.stringify(backup));
    ui.validateBackupData(decoded);
    ui.validateStatusHistoryData(decoded);
    const rows = ui.normalizeCustomerRows(decoded.customers);
    assert.deepEqual(Array.from(rows[0].statusHistory, event => event.type), ['joined', 'left', 'joined', 'left']);
    const removal = rows[0].statusHistory.at(-1);
    assert.equal(removal.to, '被移除');
    assert.equal(removal.membershipEventType, 'removed');
    assert.equal(removal.initial, false);
    const counts = ui.todayStatusCounts(rows);
    assert.equal(counts.groupJoined, 1); assert.equal(counts.groupLeft, 1);
  }
  assert.throws(() => ui.validateStatusHistoryData({ customers: [{statusHistory: [{ ...legacy[0], status: '意外值' }]}] }), /历史格式异常/);
}

(async () => {
  try {
    assert.equal((await request('/api/ws/accounts', { method: 'POST', body: JSON.stringify({ id: 'ingest-dedicated', workspaceMode: 'dedicated' }) })).status, 201);
    const initial = {
      schemaVersion: 4,
      customers: [{ id: 'C-1', name: '已有客户', phone: '9876543210', rawPhone: '+91 98765 43210', source: '群粉', status: '待跟进', deleted: false }],
      savedViews: [], activities: [], tickets: [], deposits: [], followups: [], registrations: [], phoneRegistry: [], batchOperations: [],
      settings: { operatingTasks: [], groupMembershipMappings: [{ accountId: 'ingest-dedicated', groupJid: '1203-456@g.us', memberId: 'manual-member', customerId: 'C-1' }] }, channelAliases: {}, importIssues: [], qualityDecisions: {},
    };
    assert.equal((await request('/api/state', { method: 'POST', headers: { ...headers, 'x-state-version': '' }, body: body(initial) })).status, 200);
    const profile = (await json(await request('/api/ws/group-monitors/profiles', { method: 'POST', body: body({ accountId: 'ingest-dedicated', slotKey: 'fixed-seat', enabled: true }) }))).profile;
    const target = (await json(await request(`/api/ws/group-monitors/${profile.id}/targets/scan?accountId=ingest-dedicated`, { method: 'POST', body: body({ accountId: 'ingest-dedicated', targets: [{ groupJid: '1203-456@g.us', groupName: 'VIP 群', sourceId: 'source-group', vipOnly: true }] }) }))).targets[0];
    await request(`/api/ws/group-monitors/${profile.id}/targets/${target.id}/enable?accountId=ingest-dedicated`, { method: 'POST', body: body({ accountId: 'ingest-dedicated' }) });

    const event = { targetId: target.id, groupJid: target.groupJid, memberId: '919876543210@s.whatsapp.net', type: 'joined', sourceEventId: 'system-1', eventAt: '2026-11-14T05:00:00.000Z', confidence: 0.99 };
    const first = await json(await request('/api/ws/ingest/batch', { method: 'POST', body: body({ accountId: 'ingest-dedicated', groupEvents: [event], checkpoints: [{ targetId: target.id, cursor: 'cursor-1', eventAt: event.eventAt }] }) }));
    assert.equal(first.groupEvents.accepted, 1);
    assert.equal(first.groupEvents.applied, 1);
    const events = await json(await request(`/api/ws/group-monitors/${profile.id}/events?status=applied&accountId=ingest-dedicated`));
    assert.equal(events.events.length, 1);
    assert.equal(events.events[0].customerId, 'C-1');
    const state = await json(await request('/api/state'));
    assert.equal(state.customers[0].groupMemberships.length, 1);
    assert.equal(state.customers[0].groupMemberships[0].status, '在群');
    assert.equal(state.customers[0].statusHistory.length, 1);

    const replay = await json(await request('/api/ws/ingest/batch', { method: 'POST', body: body({ accountId: 'ingest-dedicated', groupEvents: [event] }) }));
    assert.equal(replay.groupEvents.deduplicated, 1);
    const afterReplay = await json(await request('/api/state'));
    assert.equal(afterReplay.customers[0].statusHistory.length, 1, 'replay must not append a second status event');

    const manual = await json(await request('/api/ws/ingest/batch', { method: 'POST', body: body({ accountId: 'ingest-dedicated', groupEvents: [{ ...event, memberId: 'manual-member', sourceEventId: 'system-manual', type: 'joined' }] }) }));
    assert.ok(manual.groupEvents, `manual group event request failed: ${JSON.stringify(manual)}`);
    assert.equal(manual.groupEvents.applied, 1, 'legacy groupMembershipMappings must resolve an existing customer');

    const unknown = await json(await request('/api/ws/ingest/batch', { method: 'POST', body: body({ accountId: 'ingest-dedicated', groupEvents: [{ ...event, memberId: 'unknown@lid', sourceEventId: 'system-unknown', type: 'left' }] }) }));
    assert.equal(unknown.groupEvents.pending, 1);
    const pending = await json(await request(`/api/ws/group-monitors/${profile.id}/events?status=pending&accountId=ingest-dedicated`));
    assert.equal(pending.events.length, 1);
    const noNewCustomer = await json(await request('/api/state'));
    assert.equal(noNewCustomer.customers.length, 1);
    const unsupported = await json(await request('/api/ws/ingest/batch', { method: 'POST', body: body({ accountId: 'ingest-dedicated', groupEvents: [{ ...event, sourceEventId: 'system-unsupported', type: 'message' }] }) }));
    assert.equal(unsupported.groupEvents.ignored, 1);
    const allEvents = await json(await request(`/api/ws/group-monitors/${profile.id}/events?status=all&accountId=ingest-dedicated`));
    assert.equal(allEvents.events.length, 3, 'unsupported event must not be persisted as a membership transition');
    // Just after local midnight: the UTC date still belongs to the previous day.
    const time = new Date('2026-11-16T19:00:00.000Z');
    const sequence = ['joined', 'left', 'joined', 'removed'].map((type, i) => ({
      ...event, type, memberId: '919876543229@s.whatsapp.net', sourceEventId: 'backup-' + i, eventAt: new Date(+time + i * 1000).toISOString(),
    }));
    const transitions = await json(await request('/api/ws/ingest/batch', { method: 'POST', body: body({ accountId: 'ingest-dedicated', groupEvents: sequence }) }));
    assert.equal(transitions.groupEvents.applied, 4);
    const recorded = (await json(await request('/api/state'))).customers.find(customer => customer.phone === '9876543229');
    assert.equal(recorded.statusHistory[1].from, '在群');
    assert.equal(recorded.statusHistory[1].group, 'VIP 群');
    await verifyHistoryBackup(recorded, '2026-11-17');
    console.log('ws-group-monitor-ingest: pass');
  } finally {
    try { await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { ...headers, 'x-zhike-shutdown-token': token } }); } catch {}
    if (child.exitCode === null) child.kill();
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
