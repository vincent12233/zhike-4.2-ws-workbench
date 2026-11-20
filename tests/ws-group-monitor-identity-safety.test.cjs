'use strict';

// Execute the production collector functions and production HTTP ingest against
// disposable synthetic state. No WhatsApp session, external service or profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { observeSidecarStartup, requestWithStartupDiagnostics } = require('./helpers/sidecar-startup-observer.cjs');
const root = path.resolve(__dirname, '..');
const host = fs.readFileSync(path.join(root, 'desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs'), 'utf8');
let passed = 0, failed = 0;
async function check(name, run) {
  try { await run(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
}
function sourceBetween(start, end) {
  const begin = host.indexOf(start), finish = host.indexOf(end, begin);
  assert.ok(begin >= 0 && finish > begin, 'production collector markers must remain identifiable');
  return host.slice(begin, finish);
}
function collectorFixture(targets, rows = []) {
  const scope = {
    groupMonitorState: { targets, enabled: true, status: 'running', profileId: 'synthetic-profile', seen: new Set() },
    backgroundCollectorRole: true,
    clean: value => String(value ?? '').trim(),
    readRows: () => rows,
    groupMonitorEventType: () => 'joined',
    groupMonitorPreviewMemberIdentity: () => ({ value: '9000000001', phone: '9000000001' }),
    groupMonitorHash: value => value,
  };
  vm.runInNewContext(
    sourceBetween('  const normalizeGroupMonitorKey =', '  const groupMonitorCurrentIdentity =')
    + sourceBetween('  const collectGroupMonitorPreviewEvents =', '  const collectGroupMonitorEvents =')
    + '\nglobalThis.lookup = groupMonitorTarget; globalThis.collect = collectGroupMonitorPreviewEvents;', scope);
  return scope;
}
const targetA = { targetId: 'target-a', groupJid: '120300000001@g.us', groupName: 'Shared group name', enabled: true };
const targetB = { targetId: 'target-b', groupJid: '120300000002@g.us', groupName: 'Shared group name', enabled: true };
const rowB = { conversationKey: targetB.groupJid, displayName: targetB.groupName, conversationType: 'group', lastMessagePreview: 'synthetic joined event', cursor: 'synthetic-preview-1' };

async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

(async () => {
  await check('native same-name groups resolve only the exact observed JID', () => {
    const fixture = collectorFixture([targetA, targetB], [rowB]);
    assert.equal(fixture.lookup(targetB.groupJid, targetB.groupName)?.targetId, targetB.targetId);
    const events = fixture.collect();
    assert.equal(events.length, 1);
    assert.equal(events[0].targetId, targetB.targetId);
    assert.equal(events[0].groupJid, targetB.groupJid);
  });
  await check('native unselected same-name group cannot be reassigned to a selected target', () => {
    const fixture = collectorFixture([targetA], [rowB]);
    assert.equal(fixture.lookup(targetB.groupJid, targetB.groupName), null);
    assert.equal(fixture.collect().length, 0);
  });
  await check('native names and missing or non-group identities cannot authorize membership events', () => {
    for (const conversationKey of ['', 'unresolved-group', '9000000001@s.whatsapp.net']) {
      const fixture = collectorFixture([targetA], [{ ...rowB, conversationKey }]);
      assert.equal(fixture.lookup(conversationKey, targetA.groupName), null);
      assert.equal(fixture.collect().length, 0);
    }
  });
  await check('native normalized exact JID survives renaming and disabled targets remain excluded', () => {
    const fixture = collectorFixture([targetA], [{ ...rowB, conversationKey: ' 120300000001@G.US ', displayName: 'Renamed group' }]);
    assert.equal(fixture.lookup(' 120300000001@G.US ', 'Renamed group')?.targetId, targetA.targetId);
    assert.equal(fixture.collect()[0].groupJid, targetA.groupJid);
    assert.equal(collectorFixture([{ ...targetA, enabled: false }], [rowB]).lookup(targetA.groupJid, targetA.groupName), null);
  });

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-monitor-identity-safety-'));
  const port = await freePort(), origin = 'http://127.0.0.1:' + port, token = randomBytes(24).toString('hex');
  const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
    cwd: path.join(root, 'resources/app'), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token,
      ZHIKE_PARENT_PID: '', ZHIKE_GROUP_MANAGER_MODE: '', ZHIKE_STAGE3_MOCK: '', ZHIKE_AI_PIPELINE_MODE: '', ZHIKE_STAGE4_MOCK: '', ZHIKE_FENCING_MODE: '' },
  });
  const closed = new Promise(resolve => child.once('close', resolve));
  const observation = observeSidecarStartup(child, { secrets: [token] });
  const request = async (route, method = 'GET', body) => {
    const response = await fetch(origin + route, { method, signal: AbortSignal.timeout(5000),
      headers: { origin, 'x-zhike-api-token': token, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    assert.ok(response.ok, `${method} ${route}: ${response.status} ${JSON.stringify(result)}`);
    return result;
  };
  const snapshot = () => {
    const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'), { readOnly: true });
    try {
      return JSON.stringify(['customers', 'customer_group_memberships', 'ws_group_membership_events', 'ws_group_monitor_checkpoints', 'ws_group_monitor_profiles', 'ws_group_monitor_targets']
        .map(table => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY id').all()]));
    } finally { db.close(); }
  };
  try {
    await requestWithStartupDiagnostics(() => request('/api/health'), observation);
    const accountId = 'synthetic-dedicated';
    await request('/api/ws/accounts', 'POST', { id: accountId, workspaceMode: 'dedicated' });
    const profile = (await request('/api/ws/group-monitors/profiles', 'POST', { accountId, slotKey: 'synthetic-seat', enabled: true })).profile;
    const profileRoute = '/api/ws/group-monitors/' + profile.id;
    const query = '?accountId=' + accountId;
    const target = (await request(profileRoute + '/targets/scan' + query, 'POST', { accountId,
      targets: [{ groupJid: targetA.groupJid, groupName: targetA.groupName, enabled: true }] })).targets[0];
    let sequence = 0;
    const ingest = (overrides = {}) => {
      sequence++;
      return request('/api/ws/ingest/batch', 'POST', { accountId, messages: [], checkpoints: [], groupEvents: [{
        profileId: profile.id, targetId: target.id, groupJid: target.groupJid,
        memberId: '9190000000' + String(sequence).padStart(2, '0') + '@s.whatsapp.net', type: 'joined', confidence: 0.99,
        source: 'ws-native-group-monitor', sourceEventId: 'synthetic-event-' + sequence, eventAt: '2026-11-20T01:00:00.000Z', ...overrides,
      }] });
    };
    await check('server rejects a target ID paired with another group JID without CRM or monitor writes', async () => {
      const before = snapshot();
      const result = await ingest({ groupJid: targetB.groupJid });
      assert.equal(result.groupEvents.ignored, 1); assert.equal(result.groupEvents.accepted, 0);
      assert.equal(snapshot(), before);
    });
    await check('server requires observed group identity even when a target ID is supplied', async () => {
      for (const groupJid of ['', '9000000001@s.whatsapp.net']) {
        const before = snapshot(); const result = await ingest({ groupJid });
        assert.equal(result.groupEvents.ignored, 1); assert.equal(result.groupEvents.accepted, 0);
        assert.equal(snapshot(), before);
      }
    });
    await check('disabled profile ignores delayed explicit-profile packets without changing durable state', async () => {
      await request(profileRoute + query, 'PATCH', { accountId, enabled: false, status: 'paused' });
      const before = snapshot(); const result = await ingest();
      assert.equal(result.groupEvents.ignored, 1); assert.equal(result.groupEvents.accepted, 0);
      assert.equal(snapshot(), before);
    });
    await check('resumed exact target processes one event, replays dedupe, and implicit profile still works', async () => {
      await request(profileRoute + query, 'PATCH', { accountId, enabled: true });
      const fixed = { memberId: '919000000090@s.whatsapp.net', sourceEventId: 'synthetic-confirmed-join' };
      const first = await ingest(fixed);
      assert.equal(first.groupEvents.applied, 1); assert.equal(first.groupEvents.autoRegistered, 1);
      const before = snapshot(); const replay = await ingest(fixed);
      assert.equal(replay.groupEvents.deduplicated, 1); assert.equal(snapshot(), before);
      const implicit = await ingest({ profileId: '', targetId: '' });
      assert.equal(implicit.groupEvents.applied, 1);
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(`ws-group-monitor-identity-safety: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
