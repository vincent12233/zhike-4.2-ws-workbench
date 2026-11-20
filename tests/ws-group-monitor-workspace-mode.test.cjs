'use strict';
// Synthetic host authority for native-ingest positive fixtures; never a renderer fallback.
const nativeAuthorityToken = require('node:crypto').randomBytes(32).toString('hex');


// Real production HTTP routes, migrations and disposable SQLite only. This
// fixture never opens WhatsApp, copies profiles, or enables a stage mock mode.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');
const { runMigrations } = require('../resources/app/migration-runner.cjs');
const { observeSidecarStartup, requestWithStartupDiagnostics } = require('./helpers/sidecar-startup-observer.cjs');
const app = path.resolve(__dirname, '../resources/app');
const ordinary = 'historical-ordinary', dedicated = 'synthetic-dedicated';
const groupJid = '120300009001@g.us', otherJid = '120300009002@g.us';
const now = '2026-11-20T04:00:00.000Z';
const deniedCode = 'WS_WORKSPACE_MODE_MISMATCH';

async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

function seedHistoricalMonitor(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'));
  try {
    runMigrations({ db, migrationDir: path.join(app, 'migrations'), lockPath: path.join(dataDir, 'seed.lock'), backup: false });
    db.exec('PRAGMA foreign_keys=ON');
    // Omit workspace_mode exactly as an old fixture/installation would. The
    // schema default must remain ordinary even with a historical enabled seat.
    db.prepare('INSERT INTO ws_accounts(id,display_name,created_at,updated_at) VALUES(?,?,?,?)').run(ordinary, 'Historical ordinary', now, now);
    db.prepare(`INSERT INTO ws_group_monitor_profiles(id,account_id,slot_key,status,enabled,poll_interval_sec,last_heartbeat_at,created_at,updated_at)
      VALUES('historical-seat',?,'historical-seat','running',1,45,?,?,?)`).run(ordinary, now, now, now);
    db.prepare(`INSERT INTO ws_group_monitor_targets(id,profile_id,account_id,group_jid,group_name,enabled,created_at,updated_at)
      VALUES('historical-target','historical-seat',?,?,'Historical group',1,?,?)`).run(ordinary, groupJid, now, now);
    db.prepare(`INSERT INTO ws_group_membership_events(id,account_id,profile_id,target_id,group_jid,member_jid,event_type,event_at,observed_at,idempotency_key,status,created_at,updated_at)
      VALUES('historical-event',?,'historical-seat','historical-target',?,'917000009001@s.whatsapp.net','joined',?,?,'historical-event','pending',?,?)`)
      .run(ordinary, groupJid, now, now, now, now);
  } finally { db.close(); }
}

test('production group-monitor purpose gate preserves ordinary mixed ingest and dedicated safety', { timeout: 60000 }, async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-monitor-purpose-'));
  seedHistoricalMonitor(dataDir);
  const port = await freePort(), origin = 'http://127.0.0.1:' + port, token = randomBytes(24).toString('hex');
  const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
    cwd: app, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_NATIVE_WRITE_TOKEN: nativeAuthorityToken, ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token,
      ZHIKE_PARENT_PID: '', ZHIKE_GROUP_MANAGER_MODE: '', ZHIKE_STAGE3_MOCK: '', ZHIKE_AI_PIPELINE_MODE: '', ZHIKE_STAGE4_MOCK: '', ZHIKE_FENCING_MODE: '' },
  });
  const closed = new Promise(resolve => child.once('close', resolve));
  const observation = observeSidecarStartup(child, { secrets: [token, nativeAuthorityToken] });
  const request = async (route, method = 'GET', body, expected = 200) => {
    const response = await fetch(origin + route, { method, signal: AbortSignal.timeout(5000),
      headers: { origin, 'x-zhike-native-token': nativeAuthorityToken, 'x-zhike-api-token': token, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json();
    assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(value)}`);
    return value;
  };
  const inspect = callback => {
    const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'), { readOnly: true });
    try { return callback(db); } finally { db.close(); }
  };
  const protectedSnapshot = () => inspect(db => JSON.stringify([
    'app_state', 'customers', 'state_snapshots', 'customer_group_memberships', 'ws_group_membership_events',
    'ws_group_monitor_checkpoints', 'ws_group_monitor_profiles', 'ws_group_monitor_targets', 'ws_contact_exclusion_hits', 'ws_group_audit',
  ].map(table => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY id').all()])));
  const historicalRoute = '/api/ws/group-monitors/historical-seat';
  const ordinaryQuery = '?accountId=' + ordinary;
  const memberEvent = (overrides = {}) => ({ profileId: 'historical-seat', targetId: 'historical-target', groupJid,
    memberId: '917000009001@s.whatsapp.net', type: 'joined', confidence: 0.99, eventAt: now,
    source: 'ws-native-group-monitor', sourceEventId: 'ordinary-observed-join', ...overrides });
  try {
    await requestWithStartupDiagnostics(() => request('/api/health'), observation);
    await request('/api/ws/contact-exclusions', 'POST', { identity: '917000009001', displayName: 'Synthetic exclusion' }, 201);
    await t.test('historical ordinary monitor configuration, events and exports remain readable', async () => {
      const list = await request('/api/ws/group-monitors/profiles' + ordinaryQuery);
      assert.equal(list.profiles[0].id, 'historical-seat');
      assert.equal(list.profiles[0].enabled, true, 'stored history is not silently rewritten');
      assert.equal((await request(historicalRoute + ordinaryQuery)).profile.accountId, ordinary);
      assert.ok((await request(historicalRoute + '/health' + ordinaryQuery)).health);
      assert.equal((await request(historicalRoute + '/events' + ordinaryQuery)).events[0].id, 'historical-event');
      assert.equal((await request('/api/ws/export' + ordinaryQuery)).accounts[0].workspaceMode, 'ordinary');
    });
    await t.test('ordinary configuration rejects creation, inherited enablement, target scans and resolution without writes', async () => {
      const before = protectedSnapshot();
      for (const [route, method, body] of [
        ['/api/ws/group-monitors/profiles', 'POST', { slotKey: 'new-seat', enabled: true }],
        ['/api/ws/group-monitors/profiles', 'POST', { slotKey: 'new-disabled-seat', enabled: false }],
        ['/api/ws/group-monitors/profiles', 'POST', { slotKey: 'historical-seat' }],
        [historicalRoute + ordinaryQuery, 'PATCH', { enabled: true }],
        [historicalRoute + ordinaryQuery, 'PUT', { pollIntervalSec: 60 }],
        [historicalRoute + ordinaryQuery, 'PATCH', { status: 'running' }],
        [historicalRoute + '/targets/scan' + ordinaryQuery, 'POST', { targets: [{ groupJid: otherJid, enabled: false }] }],
        [historicalRoute + '/targets/historical-target/enable' + ordinaryQuery, 'POST', {}],
        [historicalRoute + '/events/historical-event/resolve' + ordinaryQuery, 'POST', { customerId: 'any-existing-id' }],
      ]) {
        const failure = await request(route, method, { ...body, accountId: ordinary, workspaceMode: 'dedicated' }, 403);
        assert.equal(failure.code, deniedCode);
        assert.equal(protectedSnapshot(), before, route);
      }
    });
    await t.test('ordinary mixed packets save direct messages and group discovery but skip all member effects', async () => {
      const before = protectedSnapshot();
      const packet = { accountId: ordinary, workspaceMode: 'dedicated', capturedAt: now,
        checkpoints: [
          { conversationKey: '917000009003@s.whatsapp.net', conversationType: 'direct', isGroup: false, displayName: 'Synthetic direct', unreadCount: 0 },
          { conversationKey: groupJid, conversationType: 'group', isGroup: true, displayName: 'Observed group', participantCount: 10 },
        ],
        messages: [{ conversationKey: '917000009003@s.whatsapp.net', externalMessageId: 'synthetic-direct-message', body: 'Synthetic direct body',
          direction: 'incoming', directionSource: 'class-message-in', sentAt: now }],
        groupEvents: [memberEvent(), memberEvent({ memberId: '917000009002@s.whatsapp.net', sourceEventId: 'ordinary-unlisted' })],
      };
      const first = await request('/api/ws/ingest/batch', 'POST', packet);
      assert.equal(first.accepted, 1);
      assert.equal(first.groupEvents.ignored, 2);
      assert.equal(first.groupEvents.accepted, 0);
      assert.ok(first.groupEvents.events.every(event => event.reason === 'workspace-purpose-blocked' && event.code === deniedCode));
      assert.equal(protectedSnapshot(), before, 'no CRM, ledger, snapshot, exclusion hit, cursor or monitor heartbeat changes');
      const catalog = await request('/api/ws/accounts/' + ordinary + '/groups');
      assert.ok(catalog.groups.some(group => group.groupJid === groupJid));
      assert.equal(inspect(db => db.prepare('SELECT COUNT(*) AS count FROM ws_messages WHERE account_id=?').get(ordinary).count), 1);
      const replay = await request('/api/ws/ingest/batch', 'POST', packet);
      assert.equal(replay.accepted, 0); assert.equal(replay.deduplicated, 1); assert.equal(replay.groupEvents.ignored, 2);
      assert.equal(protectedSnapshot(), before);
    });
    await t.test('event-only ordinary packets are acknowledged with no member-side effects', async () => {
      const before = protectedSnapshot();
      const result = await request('/api/ws/ingest/batch', 'POST', { accountId: ordinary, groupEvents: [memberEvent()] });
      assert.equal(result.accepted, 0); assert.equal(result.groupEvents.ignored, 1);
      assert.equal(result.groupEvents.events[0].code, deniedCode);
      assert.equal(protectedSnapshot(), before);
    });
    await t.test('ordinary safe stop and ignore remain available without changing configuration or purpose', async () => {
      const stopped = await request(historicalRoute + ordinaryQuery, 'PATCH', { accountId: ordinary, enabled: false, status: 'running', pollIntervalSec: 900 });
      assert.equal(stopped.profile.enabled, false); assert.equal(stopped.profile.status, 'paused'); assert.equal(stopped.profile.pollIntervalSec, 45);
      const again = await request('/api/ws/group-monitors/profiles', 'POST', { accountId: ordinary, slotKey: 'historical-seat', enabled: false, pollIntervalSec: 900 });
      assert.equal(again.profile.id, 'historical-seat'); assert.equal(again.profile.pollIntervalSec, 45);
      const inherited = await request(historicalRoute + ordinaryQuery, 'PATCH', { accountId: ordinary, pollIntervalSec: 60 }, 403);
      assert.equal(inherited.code, deniedCode, 'only an explicit safe stop is allowed even after the stored profile is disabled');
      assert.equal((await request(historicalRoute + '/targets/historical-target/disable' + ordinaryQuery, 'POST', { accountId: ordinary })).target.enabled, false);
      const crmBefore = inspect(db => JSON.stringify(db.prepare('SELECT * FROM customers ORDER BY id').all()));
      const ignored = await request(historicalRoute + '/events/historical-event/resolve' + ordinaryQuery, 'POST', { accountId: ordinary, action: 'ignore', reason: 'Synthetic safe ignore' });
      assert.equal(ignored.event.status, 'ignored');
      assert.equal(inspect(db => JSON.stringify(db.prepare('SELECT * FROM customers ORDER BY id').all())), crmBefore);
      assert.equal((await request('/api/ws/accounts/' + ordinary)).account.workspaceMode, 'ordinary');
    });
    await request('/api/ws/accounts', 'POST', { id: dedicated, workspaceMode: 'dedicated' }, 201);
    const profile = (await request('/api/ws/group-monitors/profiles', 'POST', { accountId: dedicated, slotKey: 'dedicated-seat', enabled: true }, 201)).profile;
    const dedicatedRoute = '/api/ws/group-monitors/' + profile.id, dedicatedQuery = '?accountId=' + dedicated;
    const target = (await request(dedicatedRoute + '/targets/scan' + dedicatedQuery, 'POST', { accountId: dedicated,
      targets: [{ groupJid, groupName: 'Synthetic dedicated group', enabled: true }] })).targets[0];
    const dedicatedEvent = overrides => memberEvent({ profileId: profile.id, targetId: target.id, sourceEventId: 'dedicated-event', ...overrides });
    await t.test('dedicated purpose does not bypass account scope or exact observed group identity', async () => {
      const before = protectedSnapshot();
      await request(dedicatedRoute + ordinaryQuery, 'PATCH', { accountId: ordinary, enabled: false }, 404);
      for (const wrongGroup of [otherJid, '', '917000009001@s.whatsapp.net']) {
        const result = await request('/api/ws/ingest/batch', 'POST', { accountId: dedicated,
          groupEvents: [dedicatedEvent({ groupJid: wrongGroup })] });
        assert.equal(result.groupEvents.accepted, 0); assert.equal(result.groupEvents.ignored, 1);
        assert.equal(result.groupEvents.events[0].reason, 'target-disabled-or-missing');
        assert.equal(protectedSnapshot(), before);
      }
    });
    await t.test('dedicated valid events retain exclusion audit and do not create excluded members', async () => {
      const beforeCustomers = inspect(db => db.prepare('SELECT COUNT(*) AS count FROM customers').get().count);
      const beforeHits = inspect(db => db.prepare('SELECT COUNT(*) AS count FROM ws_contact_exclusion_hits').get().count);
      const result = await request('/api/ws/ingest/batch', 'POST', { accountId: dedicated, workspaceMode: 'ordinary',
        groupEvents: [dedicatedEvent({ sourceEventId: 'dedicated-excluded' })] });
      assert.equal(result.groupEvents.accepted, 1); assert.equal(result.groupEvents.autoRegistered, 0);
      assert.equal(inspect(db => db.prepare('SELECT COUNT(*) AS count FROM customers').get().count), beforeCustomers);
      assert.equal(inspect(db => db.prepare('SELECT COUNT(*) AS count FROM ws_contact_exclusion_hits').get().count), beforeHits + 1);
    });
    await t.test('dedicated confirmed unlisted events apply once and delayed disabled packets stay ignored', async () => {
      const event = dedicatedEvent({ memberId: '917000009004@s.whatsapp.net', sourceEventId: 'dedicated-confirmed' });
      const first = await request('/api/ws/ingest/batch', 'POST', { accountId: dedicated, groupEvents: [event] });
      assert.equal(first.groupEvents.applied, 1); assert.equal(first.groupEvents.autoRegistered, 1);
      const before = protectedSnapshot();
      const replay = await request('/api/ws/ingest/batch', 'POST', { accountId: dedicated, groupEvents: [event] });
      assert.equal(replay.groupEvents.deduplicated, 1); assert.equal(protectedSnapshot(), before);
      await request(dedicatedRoute + dedicatedQuery, 'PATCH', { accountId: dedicated, enabled: false });
      const disabled = protectedSnapshot();
      const delayed = await request('/api/ws/ingest/batch', 'POST', { accountId: dedicated,
        groupEvents: [dedicatedEvent({ memberId: '917000009005@s.whatsapp.net', sourceEventId: 'dedicated-delayed' })] });
      assert.equal(delayed.groupEvents.ignored, 1); assert.equal(protectedSnapshot(), disabled);
      assert.equal((await request('/api/ws/accounts/' + dedicated)).account.workspaceMode, 'dedicated');
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
