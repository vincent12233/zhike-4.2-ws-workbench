'use strict';
// Synthetic host authority for native-ingest positive fixtures; never a renderer fallback.
const nativeAuthorityToken = require('node:crypto').randomBytes(32).toString('hex');

// Real production routes, disposable SQLite and synthetic native packets only.
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
const ordinary = 'ordinary-ingest', dedicated = 'dedicated-ingest', other = 'other-dedicated-ingest';
const now = '2026-11-20T05:00:00.000Z';
const checkpoint = (key, type = 'group', count = 1) => ({ conversationKey: key, conversationType: type,
  displayName: 'Same observed group name', unreadCount: 0, historyLoaded: true, historyMessageCount: count,
  coverage: 'read-history', directionVersion: 4, directionUnresolvedCount: 0 });
const message = (key, suffix = 'one', extra = {}) => ({ conversationKey: key, externalMessageId: key + '-' + suffix,
  body: 'Synthetic original ' + suffix, direction: 'incoming', directionSource: 'class-message-in',
  senderId: '917000008001@s.whatsapp.net', senderIdentitySource: 'sender-jid', sentAt: now, ...extra });

function seed(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'));
  try {
    runMigrations({ db, migrationDir: path.join(app, 'migrations'), lockPath: path.join(dataDir, 'seed.lock'), backup: false });
    for (const [id, mode] of [[ordinary, 'ordinary'], [dedicated, 'dedicated'], [other, 'dedicated']]) {
      db.prepare('INSERT INTO ws_accounts(id,display_name,workspace_mode,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, id, mode, now, now);
    }
    for (const [id, accountId] of [['ordinary-history', ordinary], ['dedicated-history', dedicated]]) {
      db.prepare('INSERT INTO ws_conversations(id,account_id,external_id,title,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
        .run(id, accountId, 'historical@g.us', 'Historical group', JSON.stringify({ conversationType: 'vip_group', vipGroup: true,
          historyLoaded: true, directionVersion: 4, historyFingerprint: 'saved-history', lastMessageFingerprint: 'saved-history' }), now, now);
      db.prepare(`INSERT INTO ws_messages(id,account_id,conversation_id,external_id,direction,original_text,data_json,created_at,updated_at)
        VALUES(?,?,?,'historical-message','receive','SAVED ORIGINAL','{}',?,?)`).run('message-' + id, accountId, id, now, now);
      db.prepare(`INSERT INTO ws_ai_analyses(id,account_id,conversation_id,result_json,created_at,updated_at) VALUES(?,?,?,'{"summary":"Saved analysis"}',?,?)`)
        .run('analysis-' + id, accountId, id, now, now);
    }
  } finally { db.close(); }
}
async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

test('production ingest separates purpose, group directory and observed member messages', { timeout: 60000 }, async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-ingest-purpose-'));
  seed(dataDir);
  const port = await freePort(), origin = 'http://127.0.0.1:' + port, token = randomBytes(24).toString('hex');
  const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
    cwd: app, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_NATIVE_WRITE_TOKEN: nativeAuthorityToken, ZHIKE_API_TOKEN: token,
      ZHIKE_PARENT_PID: '', ZHIKE_GROUP_MANAGER_MODE: '', ZHIKE_STAGE3_MOCK: '', ZHIKE_AI_PIPELINE_MODE: '', ZHIKE_STAGE4_MOCK: '', ZHIKE_FENCING_MODE: '' },
  });
  const closed = new Promise(resolve => child.once('close', resolve));
  const observation = observeSidecarStartup(child, { secrets: [token, nativeAuthorityToken] });
  const request = async (route, body, expected = 200) => {
    const headers = { origin, 'x-zhike-native-token': nativeAuthorityToken, 'x-zhike-api-token': token, 'content-type': 'application/json' };
    if (body !== undefined) headers['x-state-version'] = (await fetch(origin + '/api/state/version', { headers }).then(response => response.json())).version;
    const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(5000), headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json(); assert.equal(response.status, expected, `${route}: ${JSON.stringify(result)}`); return result;
  };
  const inspect = fn => { const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'), { readOnly: true }); try { return fn(db); } finally { db.close(); } };
  const protectionSnapshot = () => inspect(db => JSON.stringify(['app_state', 'customers', 'ai_jobs', 'ws_ai_analyses', 'ws_messages', 'ws_ingest_batches',
    'ws_group_membership_events', 'customer_group_memberships', 'ws_contact_exclusion_hits'].map(table => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY id').all()])));
  const conversation = (accountId, key) => inspect(db => db.prepare('SELECT * FROM ws_conversations WHERE account_id=? AND external_id=?').get(accountId, key));
  const ingest = (accountId, checkpoints, messages) => request('/api/ws/ingest/batch', { accountId, checkpoints, messages, workspaceMode: 'dedicated', vipGroup: true });
  try {
    await requestWithStartupDiagnostics(() => request('/api/health'), observation);
    const profile = (await request('/api/ws/group-monitors/profiles', { accountId: dedicated, slotKey: 'body-seat', enabled: true }, 201)).profile;
    const keys = ['canonical@g.us', 'legacy-vip@g.us', 'member-invalid@g.us', 'direction-invalid@g.us', 'preview@g.us', 'partial@g.us'];
    await request('/api/ws/group-monitors/' + profile.id + '/targets/scan?accountId=' + dedicated, { accountId: dedicated,
      targets: keys.map(groupJid => ({ groupJid, groupName: 'Same observed group name', enabled: true })) });
    const otherProfile = (await request('/api/ws/group-monitors/profiles', { accountId: other, slotKey: 'other-seat', enabled: true }, 201)).profile;
    await request('/api/ws/group-monitors/' + otherProfile.id + '/targets/scan?accountId=' + other, { accountId: other,
      targets: [{ groupJid: 'other-account@g.us', groupName: 'Same observed group name', enabled: true }] });

    await t.test('ordinary mixed packets preserve direct collection and group directory without VIP bypass', async () => {
      const result = await ingest(ordinary, [checkpoint('917000008099@s.whatsapp.net', 'direct'), checkpoint('legacy-vip@g.us', 'vip_group'), checkpoint('canonical@g.us')],
        [message('917000008099@s.whatsapp.net'), message('legacy-vip@g.us', 'vip', { direction: 'invalid' }), message('canonical@g.us')]);
      assert.equal(result.accepted, 1); assert.equal(result.skipped, 2);
      assert.equal(result.skipReasons.WS_WORKSPACE_MODE_MISMATCH, 2);
      const rows = await request('/api/ws/conversations?accountId=' + ordinary);
      assert.equal(rows.groupConversations.length, 2); assert.equal(rows.conversations.length, 2, 'existing legacy history remains visible beside direct data');
      assert.equal(inspect(db => db.prepare('SELECT COUNT(*) n FROM ws_group_catalog WHERE account_id=?').get(ordinary).n), 2);
      for (const key of ['canonical@g.us', 'legacy-vip@g.us']) {
        const row = conversation(ordinary, key);
        assert.equal(row.last_message_text, ''); assert.equal(JSON.parse(row.data_json).historyLoaded, false);
        assert.equal(inspect(db => db.prepare('SELECT COUNT(*) n FROM ws_messages WHERE conversation_id=?').get(row.id).n), 0);
      }
    });
    await t.test('complete packet identity prevents a later group marker from being treated as direct', async () => {
      const before = protectionSnapshot();
      const result = await ingest(ordinary, [checkpoint('opaque-mixed', 'direct')], [message('opaque-mixed', 'first', { conversationType: 'direct' }), message('opaque-mixed', 'later', { conversationType: 'vip_group' })]);
      assert.equal(result.accepted, 0); assert.equal(result.skipped, 2); assert.equal(protectionSnapshot(), before);
    });
    await t.test('dedicated exact targets accept canonical and legacy group messages but skip direct bodies', async () => {
      const result = await ingest(dedicated, [checkpoint('canonical@g.us'), checkpoint('legacy-vip@g.us', 'vip_group'), checkpoint('917000008099@s.whatsapp.net', 'direct')],
        [message('canonical@g.us'), message('legacy-vip@g.us'), message('917000008099@s.whatsapp.net')]);
      assert.equal(result.accepted, 2); assert.equal(result.skipped, 1); assert.equal(result.skipReasons.WS_WORKSPACE_MODE_MISMATCH, 1);
      for (const key of ['canonical@g.us', 'legacy-vip@g.us']) {
        const row = conversation(dedicated, key), data = JSON.parse(row.data_json);
        assert.equal(data.historyLoaded, true); assert.equal(data.directionVersion, 4);
        const stored = inspect(db => db.prepare('SELECT * FROM ws_messages WHERE conversation_id=?').get(row.id));
        assert.equal(JSON.parse(stored.data_json).senderIdentityTrusted, true);
      }
      assert.equal(conversation(dedicated, '917000008099@s.whatsapp.net'), undefined);
      const repeated = await ingest(dedicated, [checkpoint('canonical@g.us')], [message('canonical@g.us')]);
      assert.equal(repeated.accepted, 0); assert.equal(repeated.deduplicated, 1);
    });
    await t.test('catalog/name/other-account authorization and forged member flags do not prove observation', async () => {
      const before = protectionSnapshot();
      const bad = [
        ['catalog-only@g.us', {}, 'WS_GROUP_AUTHORIZATION_REQUIRED'],
        ['other-account@g.us', {}, 'WS_GROUP_AUTHORIZATION_REQUIRED'],
        ['opaque-label', { conversationType: 'vip_group' }, 'WS_GROUP_IDENTITY_UNCONFIRMED'],
        ['member-invalid@g.us', { senderIdentityTrusted: false }, 'WS_GROUP_MEMBER_IDENTITY_UNCONFIRMED'],
        ['member-invalid@g.us', { senderId: '', senderPhone: '', senderIdentitySource: '', senderIdentityTrusted: true }, 'WS_GROUP_MEMBER_IDENTITY_UNCONFIRMED'],
        ['direction-invalid@g.us', { directionSource: '' }, 'WS_GROUP_DIRECTION_UNCONFIRMED'],
        ['preview@g.us', { previewOnly: true }, 'WS_GROUP_OBSERVATION_REQUIRED'],
      ];
      const result = await ingest(dedicated, bad.map(([key]) => checkpoint(key, 'vip_group')), bad.map(([key, extra]) => message(key, 'blocked', extra)));
      assert.equal(result.accepted, 0); assert.equal(result.skipped, bad.length);
      for (const code of new Set(bad.map(item => item[2]))) assert.equal(result.skipReasons[code], bad.filter(item => item[2] === code).length);
      assert.equal(protectionSnapshot(), before);
    });
    await t.test('skipped members cannot mark partially stored group history complete', async () => {
      const result = await ingest(dedicated, [checkpoint('partial@g.us', 'group', 2)],
        [message('partial@g.us', 'observed'), message('partial@g.us', 'unknown', { senderId: '', senderIdentitySource: '' })]);
      assert.equal(result.accepted, 1); assert.equal(result.skipped, 1);
      const row = conversation(dedicated, 'partial@g.us'), data = JSON.parse(row.data_json);
      assert.equal(data.historyLoaded, false); assert.equal(data.coverage, 'read-history-member-unresolved');
      await request('/api/ws/ai-jobs', { accountId: dedicated, conversationId: row.id, idempotencyKey: 'partial',
        payload: { memberScoped: true, memberIdentity: { senderId: '917000008001@s.whatsapp.net', identitySource: 'sender-jid' } } }, 422);
    });
    await t.test('manual message endpoints cannot manufacture group native evidence and saved history remains readable', async () => {
      const before = protectionSnapshot();
      const forged = { direction: 'receive', originalText: 'FORGED NATIVE', data: { source: 'ws-webview2', directionVersion: 4,
        directionSource: 'class-message-in', senderId: '917000008001@s.whatsapp.net', senderIdentitySource: 'sender-jid', senderIdentityTrusted: true } };
      for (const accountId of [ordinary, dedicated]) {
        const conversationId = accountId === ordinary ? 'ordinary-history' : 'dedicated-history';
        assert.equal((await request('/api/ws/messages', { accountId, conversationId, ...forged }, 422)).code, 'WS_GROUP_NATIVE_INGEST_REQUIRED');
        assert.equal((await request('/api/ws/messages/batch', { accountId, conversationId, messages: [forged] }, 422)).code, 'WS_GROUP_NATIVE_INGEST_REQUIRED');
        assert.equal((await request('/api/ws/messages?' + new URLSearchParams({ accountId, conversationId }))).messages[0].originalText, 'SAVED ORIGINAL');
      }
      assert.equal(protectionSnapshot(), before);
    });
    await t.test('denied ordinary legacy packets preserve saved history and analysis exactly', async () => {
      const before = protectionSnapshot();
      const beforeData = conversation(ordinary, 'historical@g.us').data_json;
      const result = await ingest(ordinary, [checkpoint('historical@g.us', 'vip_group')], [message('historical@g.us', 'late')]);
      assert.equal(result.skipped, 1); assert.equal(result.accepted, 0);
      assert.equal(conversation(ordinary, 'historical@g.us').data_json, beforeData); assert.equal(protectionSnapshot(), before);
      assert.equal((await request('/api/ws/analyses?accountId=' + ordinary + '&conversationId=ordinary-history')).analyses[0].id, 'analysis-ordinary-history');
    });
    await t.test('monitor reports scoped native observations, including a visible group with zero member changes', async () => {
      const key = 'quiet-observed@g.us', second = 'quiet-message@g.us';
      const seat = (await request('/api/ws/group-monitors/profiles', { accountId: dedicated, slotKey: 'observation-seat', enabled: true }, 201)).profile;
      const route = '/api/ws/group-monitors/' + seat.id, query = '?accountId=' + dedicated;
      const read = () => request(route + query);
      const packet = { accountId: dedicated, scope: 'background-collector', capturedAt: new Date(Date.now() - 1000).toISOString(),
        checkpoints: [{ conversationKey: key, conversationType: 'group', coverage: 'group-monitor-visible' }] };
      const stale = new Date(Date.now() - 600000).toISOString();
      const sample = extra => request('/api/ws/ingest/batch', { ...packet, ...extra });
      assert.equal(seat.observationState, 'no-targets');
      const targets = (await request(route + '/targets/scan' + query, { accountId: dedicated, targets: [key, second].map(groupJid => ({ groupJid, enabled: true })) })).targets;
      packet.capturedAt = new Date().toISOString();
      assert.equal((await read()).health.observationState, 'waiting');
      await sample({ accountId: other }); await sample({ accountId: ordinary }); await sample({ scope: 'visible-authorized-content' });
      await sample({ checkpoints: [{ ...packet.checkpoints[0], conversationKey: 'never-bound@g.us' }] });
      assert.equal((await read()).health.lastObservedAt, '');
      const protectedBefore = protectionSnapshot();
      await sample({ capturedAt: stale });
      let detail = await read();
      assert.equal(detail.profile.observationState, 'stale'); assert.equal(detail.health.status, 'degraded');
      assert.equal(detail.health.observedTargetCount, 1); assert.equal(detail.health.recentTargetCount, 0);
      await sample({}); await sample({ capturedAt: stale });
      detail = await read();
      for (const summary of [detail.profile, detail.health]) {
        assert.equal(summary.observationState, 'recent'); assert.equal(summary.lastObservedAt, packet.capturedAt);
        assert.equal(summary.recentTargetCount, 1); assert.equal(summary.targetCount, 2);
      }
      assert.equal(detail.health.eventCounts.applied, 0); assert.equal(detail.health.eventCounts.pending, 0);
      assert.equal(detail.profile.targets.find(target => target.groupJid === key).lastSeenAt, packet.capturedAt);
      assert.equal(conversation(dedicated, key), undefined); assert.equal(protectionSnapshot(), protectedBefore);
      await sample({ checkpoints: [], messages: [message(second, 'unverified', { senderId: '', senderIdentitySource: '' })] });
      assert.equal((await read()).health.recentTargetCount, 1);
      await sample({ checkpoints: [], messages: [message(second, 'verified', { observedAt: packet.capturedAt })] });
      assert.equal((await read()).health.recentTargetCount, 2);
      // Older native events can omit the profile id. A newly configured seat
      // on the same account must not intercept a different group's event.
      const newerSeat = (await request('/api/ws/group-monitors/profiles', { accountId: dedicated, slotKey: 'separate-seat', enabled: true }, 201)).profile;
      const event = { groupJid: key, memberId: 'example@lid', type: 'left', confidence: 0.9, sourceEventId: 'observed-left', eventAt: packet.capturedAt };
      assert.equal((await sample({ checkpoints: [], groupEvents: [event] })).groupEvents.accepted, 1);
      assert.equal((await read()).health.eventCounts.pending, 1);
      assert.equal((await request('/api/ws/group-monitors/' + newerSeat.id + '/health' + query)).health.lastObservedAt, '');
      for (const target of targets) await request(route + '/targets/' + target.id + '/disable' + query, { accountId: dedicated });
      await sample({});
      assert.equal((await read()).health.observationState, 'no-targets');
      await request(route + '/targets/' + targets.find(target => target.groupJid === key).id + '/enable' + query, { accountId: dedicated });
      await sample({});
      assert.equal((await read()).health.observationState, 'waiting', 'a packet from before re-enabling the target cannot establish current coverage');
      await sample({ capturedAt: new Date().toISOString() });
      assert.equal((await read()).health.observationState, 'recent');
      const saveSeat = enabled => request('/api/ws/group-monitors/profiles', { accountId: dedicated, slotKey: seat.slotKey, enabled });
      await saveSeat(false);
      assert.equal((await read()).health.observationState, 'paused');
      await saveSeat(true);
      assert.equal((await read()).health.observationState, 'waiting', 'resumed seat must wait for a new observation');
    });

    const visibleKey = 'live-panel-members@g.us', authorKey = 'live-author-members@g.us';
    const unselected = 'unselected-live-members@g.us', knownPhone = '7000000801', excludedPhone = '7000000802';
    const crmCustomer = (id, phone) => ({ id, name: id, phone, rawPhone: '+91' + phone, source: '群粉', status: '待跟进', deleted: false });
    const initial = await request('/api/state');
    await request('/api/state', { ...initial, customers: [...(initial.customers || []), crmCustomer('live-known', knownPhone), crmCustomer('live-excluded', excludedPhone)] });
    await request('/api/ws/contact-exclusions', { identity: '+91' + excludedPhone }, 201);
    const liveSeat = (await request('/api/ws/group-monitors/profiles', { accountId: dedicated, slotKey: 'live-member-seat', enabled: true }, 201)).profile;
    const boundLiveTargets = (await request('/api/ws/group-monitors/' + liveSeat.id + '/targets/scan?accountId=' + dedicated, {
      accountId: dedicated, targets: [visibleKey, authorKey].map(groupJid => ({ groupJid, groupName: 'Authorized group', enabled: true })),
    })).targets;
    const fixture = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'));
    try {
      fixture.prepare('DELETE FROM ws_group_catalog WHERE account_id=? AND group_jid IN (?,?)').run(dedicated, visibleKey, authorKey);
    } finally { fixture.close(); }
    const group = (accountId, key) => inspect(db => db.prepare('SELECT * FROM ws_group_catalog WHERE account_id=? AND group_jid=?').get(accountId, key));
    const members = async (accountId, key) => (await request('/api/ws/group-manager/members?accountId=' + accountId + '&groupJid=' + key)).members;
    const countMembers = (accountId, key) => inspect(db => db.prepare('SELECT count(*) AS n FROM ws_group_members WHERE account_id=? AND group_jid=?').get(accountId, key).n);
    const sideEffects = () => inspect(db => Object.fromEntries(['ws_group_membership_events', 'customer_group_memberships', 'ws_ai_analyses', 'ai_jobs', 'customers', 'app_state']
      .map(table => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY id').all()])));
    const baseline = sideEffects();
    const packet = extra => ({ accountId: dedicated, scope: 'background-collector', capturedAt: new Date().toISOString(), ...extra });
    const submit = body => request('/api/ws/ingest/batch', body);
    const person = (phone, displayName) => ({ memberId: '91' + phone + '@s.whatsapp.net', displayName });
    const panel = (key, observedMembers) => ({ conversationKey: key, displayName: 'Authorized group', conversationType: 'group', isGroup: true, coverage: 'group-monitor-visible', observedMembers });

    await t.test('an authorized target exposes an empty roster before it has any cached directory or member rows', async () => {
      assert.equal(group(dedicated, visibleKey), undefined);
      assert.equal(countMembers(dedicated, visibleKey), 0);
      assert.deepEqual(await members(dedicated, visibleKey), []);
      assert.equal(group(dedicated, visibleKey), undefined, 'reading must not manufacture a directory observation');
      for (const [accountId, groupJid] of [[other, visibleKey], [dedicated, unselected]]) {
        const invalid = await request('/api/ws/group-manager/members?accountId=' + accountId + '&groupJid=' + groupJid, undefined, 404);
        assert.equal(invalid.code, 'GROUP_MANAGER_GROUP_UNAVAILABLE');
      }
    });

    await t.test('only an authorized native collector writes observed roster identities', async () => {
      const people = [person(knownPhone, 'Real identity')];
      const body = packet({ checkpoints: [panel(visibleKey, people)] });
      const unauthenticated = await fetch(origin + '/api/ws/ingest/batch', { method: 'POST',
        headers: { origin, 'x-zhike-api-token': token, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(unauthenticated.status, 403);
      for (const override of [{ scope: 'visible-authorized-content' }, { accountId: ordinary }, { accountId: other }, { checkpoints: [panel(unselected, people)] },
        { checkpoints: [{ ...panel(visibleKey, people), accountId: other }], messages: [message(visibleKey, 'nested-other', { accountId: other })] },
        { capturedAt: new Date(Date.now() - 86400000).toISOString() }, { capturedAt: new Date(Date.now() + 86400000).toISOString() }]) {
        await submit({ ...body, ...override });
      }
      for (const [id, key] of [[dedicated, visibleKey], [dedicated, unselected], [ordinary, visibleKey], [other, visibleKey]]) {
        assert.equal(countMembers(id, key), 0);
        assert.equal(group(id, key), undefined);
      }
      assert.deepEqual(sideEffects(), baseline);
    });

    await t.test('paused targets and replay from before reauthorization cannot contribute member evidence', async () => {
      const id = boundLiveTargets.find(target => target.groupJid === authorKey).id;
      const toggle = action => request('/api/ws/group-monitors/' + liveSeat.id + '/targets/' + id + '/' + action + '?accountId=' + dedicated, { accountId: dedicated });
      const body = packet({ checkpoints: [panel(authorKey, [person(knownPhone, 'Previous authorization')])] });
      await toggle('disable');
      await submit(body);
      assert.equal(countMembers(dedicated, authorKey), 0);
      await toggle('enable');
      await submit(body);
      assert.equal(countMembers(dedicated, authorKey), 0);
      const stale = message(authorKey, 'stale-observation', { observedAt: body.capturedAt });
      await submit(packet({ messages: [stale] }));
      assert.equal(countMembers(dedicated, authorKey), 0);
    });

    await t.test('an incoming message alone discovers its author, rebuilds the missing directory and survives replay', async () => {
      const body = packet({ messages: [message(authorKey, 'verified-author', { senderId: person(knownPhone).memberId, senderName: 'Verified author' })] });
      assert.equal(group(dedicated, authorKey), undefined);
      assert.equal((await submit(body)).accepted, 1);
      const rows = await members(dedicated, authorKey);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].observedOnly, true);
      assert.equal(rows[0].customerId, 'live-known');
      assert.equal(rows[0].status, 'unknown');
      assert.equal(rows[0].evidence.kind, 'message-author');
      assert.equal(rows[0].evidence.completeness, 'partial');
      assert.equal((await submit(body)).deduplicated, 1);
      assert.deepEqual(await members(dedicated, authorKey), rows);
      assert.deepEqual(sideEffects(), baseline, 'observing an author cannot change CRM, enqueue AI or create a membership transition');
    });

    await t.test('a partial visible roster restores the group without messages, links verified CRM only and never infers departures', async () => {
      const known = person(knownPhone, 'Verified person'), excluded = person(excludedPhone, 'Excluded person');
      const opaque = { memberId: '7755588221@lid', displayName: 'live-known' };
      const body = packet({ checkpoints: [panel(visibleKey, [known, excluded, opaque, known, { memberId: '', displayName: 'live-known' }, { memberId: 'invalid', displayName: knownPhone }])] });
      await submit(body);
      assert.ok(group(dedicated, visibleKey));
      assert.equal(conversation(dedicated, visibleKey), undefined);
      const rows = await members(dedicated, visibleKey);
      assert.equal(rows.length, 3);
      for (const row of rows) {
        assert.equal(row.observedOnly, true); assert.equal(row.status, 'unknown');
        assert.equal(row.evidence.kind, 'visible-member-row'); assert.equal(row.evidence.completeness, 'partial');
      }
      assert.equal(rows.find(row => row.memberPhone === knownPhone).customerId, 'live-known');
      const blocked = rows.find(row => row.memberPhone === excludedPhone);
      assert.equal(blocked.customerId, ''); assert.equal(blocked.reviewReason, 'contact-excluded');
      const unknown = rows.find(row => row.memberJid === opaque.memberId);
      assert.equal(unknown.customerId, '');
      await submit(body);
      assert.deepEqual(await members(dedicated, visibleKey), rows);
      await submit(packet({ checkpoints: [panel(visibleKey, [known])] }));
      const reduced = await members(dedicated, visibleKey);
      assert.equal(reduced.length, 3);
      assert.deepEqual(reduced.find(row => row.id === blocked.id), blocked);
      assert.deepEqual(reduced.find(row => row.id === unknown.id), unknown);
      assert.deepEqual(sideEffects(), baseline);
    });

    await t.test('a later exclusion immediately hides an existing observed customer link', async () => {
      assert.equal((await members(dedicated, authorKey))[0].customerId, 'live-known');
      await request('/api/ws/contact-exclusions', { identity: '+91' + knownPhone }, 201);
      const auditCount = () => inspect(db => db.prepare('SELECT count(*) AS n FROM ws_contact_exclusion_hits').get().n);
      const before = auditCount();
      const [blocked] = await members(dedicated, authorKey);
      assert.equal(blocked.customerId, ''); assert.equal(blocked.data.customerId, '');
      assert.equal(blocked.data.observedCustomerId, ''); assert.equal(blocked.customerName, '');
      assert.equal(blocked.reviewReason, 'contact-excluded');
      assert.equal(blocked.observedOnly, true); assert.equal(blocked.status, 'unknown');
      const state = await request('/api/ws/group-manager/state?accountId=' + dedicated + '&groupJid=' + authorKey);
      assert.deepEqual(state.members, [blocked]);
      assert.equal(auditCount(), before, 'displaying a roster is a read-only operation');
    });
    await t.test('contacts observed in the ordinary account picker remain independent of chat, CRM and AI', async () => {
      const contact = '917000000801@c.us', opaque = '7000000801@lid', started = new Date(Date.now() - 1000).toISOString();
      const row = (key, extra = {}) => ({ accountId: ordinary, coverage: 'foreground-visible-contact', conversationType: 'contact', isGroup: false,
        conversationKey: key, displayName: 'Directory sample', ...extra });
      const packet = (checkpoints, extra = {}) => ({ scope: 'foreground-visible-directory', accountId: ordinary, capturedAt: started, checkpoints, ...extra });
      const save = body => request('/api/ws/ingest/batch', body);
      const read = async account => (await request('/api/ws/workspace/contacts?accountId=' + account + '&q=Directory%20sample')).rows;
      const stored = () => inspect(db => db.prepare('SELECT * FROM ws_contact_directory ORDER BY account_id,contact_key').all());
      const before = protectionSnapshot();
      const base = packet([row(contact), row(opaque), row('not-a-jid'), row('test@g.us'), row(contact, { accountId: other })]);
      await save(packet([row(contact)], { scope: 'background-collector' }));
      await save(packet([row(contact, { accountId: dedicated })], { accountId: dedicated }));
      await save(packet([row(contact)], { capturedAt: 'invalid-time' }));
      assert.deepEqual(stored(), []);
      const reply = await fetch(origin + '/api/ws/ingest/batch', { method: 'POST',
        headers: { origin, 'x-zhike-api-token': token, 'content-type': 'application/json' }, body: JSON.stringify(base) });
      assert.equal(reply.status, 403);
      await save(base);
      const rows = await read(ordinary);
      assert.equal(rows.length, 2);
      assert.ok(rows.every(entry => entry.source === 'foreground-visible-contact' && entry.observedAt === started && !entry.conversationId && !entry.customerId));
      assert.equal(rows.find(entry => entry.externalId === opaque).normalizedPhone, '');
      assert.deepEqual(await read(other), []);
      assert.equal(conversation(ordinary, contact), undefined); assert.equal(conversation(ordinary, opaque), undefined);
      assert.deepEqual(protectionSnapshot(), before);
      const first = stored();
      await save(base);
      await save(packet([row(contact, { displayName: 'Earlier observation' })], { capturedAt: new Date(Date.now() - 86400000).toISOString() }));
      assert.deepEqual(stored(), first);
      const fixture = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'));
      try {
        fixture.prepare(`INSERT INTO ws_conversations(id,account_id,external_id,title,customer_id,data_json,created_at,updated_at)
          VALUES('manual-directory-link',?,?,?,'live-known','{"conversationType":"direct"}',?,?)`)
          .run(ordinary, '917000000801@s.whatsapp.net', 'Directory sample manual title', started, started);
      } finally { fixture.close(); }
      await save(packet([row('917000000801@s.whatsapp.net', { displayName: 'Directory sample renamed' })], { capturedAt: new Date().toISOString() }));
      const merged = await read(ordinary);
      assert.equal(merged.length, 2, 'phone-JID aliases merge, LIDs remain separate');
      const linked = merged.find(entry => entry.conversationId === 'manual-directory-link');
      assert.equal(linked.name, 'Directory sample manual title'); assert.equal(linked.customerId, 'live-known');
      assert.equal(linked.crmLinkStatus, 'linked'); assert.equal(linked.source, 'foreground-visible-contact');
      assert.equal(stored().length, 2);
      const one = await request('/api/ws/export?accountId=' + ordinary);
      assert.equal(one.manifest.counts.contacts, one.contacts.length);
      const observed = one.contacts.filter(entry => entry.source === 'foreground-visible-contact');
      assert.equal(observed.length, 2);
      assert.equal(observed.find(entry => entry.externalId === opaque).conversationId, '');
      assert.equal(observed.find(entry => entry.externalId === opaque).phone, '');
      assert.equal(observed.find(entry => entry.conversationId === 'manual-directory-link').customerId, 'live-known');
      assert.ok(one.conversations.every(entry => entry.externalId !== opaque));
      const second = await request('/api/ws/export?accountId=' + dedicated);
      assert.ok(second.contacts.every(entry => entry.externalId !== opaque));
      const all = await request('/api/ws/export?allAccounts=1');
      assert.equal(all.manifest.counts.contacts, all.contacts.length);
      assert.deepEqual(all.contacts.filter(entry => entry.source === 'foreground-visible-contact'), observed);
    });

    await t.test('a native foreground snapshot builds an empty account directory without advancing history or starting AI', async () => {
      const project = (accountId, conversationKey, conversationType, extra = {}) => ({
        accountId, conversationKey, conversationType, displayName:'Same visible title', isGroup:conversationType === 'group',
        coverage:'foreground-visible-directory', ...extra,
      });
      const save = (accountId, checkpoints) => request('/api/ws/ingest/batch', {
        scope:'foreground-visible-directory', accountId, capturedAt:new Date().toISOString(), checkpoints,
      });
      const direct = project(ordinary, '910000000001@c.us', 'direct'), group = project(dedicated, 'live-same-1@g.us', 'group');
      const group2 = {...group, conversationKey:'live-same-2@g.us'};
      const baseline = protectionSnapshot();
      await save(ordinary, [direct, {...group, accountId:ordinary}]);
      await save(dedicated, [group, group2, {...direct, accountId:dedicated}, {...group, accountId:ordinary, conversationKey:'foreign@g.us'}]);
      const original = conversation(ordinary, direct.conversationKey);
      assert.ok(original); assert.equal(JSON.parse(original.data_json).historyLoaded, false);
      assert.equal(conversation(dedicated, direct.conversationKey), undefined);
      const readGroups = () => inspect(db => db.prepare("SELECT group_jid FROM ws_group_catalog WHERE account_id=? AND discovery_source='foreground-visible-directory' ORDER BY group_jid").all(dedicated).map(row => row.group_jid));
      assert.deepEqual(readGroups(), [group.conversationKey,group2.conversationKey]);
      await save(ordinary,[direct]); await save(dedicated,[group]);
      assert.equal(conversation(ordinary, direct.conversationKey).id, original.id);
      assert.equal(protectionSnapshot(), baseline);
      const temp = new DatabaseSync(path.join(dataDir,'workspace.sqlite'));
      try {
        temp.prepare('DELETE FROM ws_conversations WHERE account_id=? AND id=?').run(ordinary, original.id);
        temp.prepare('DELETE FROM ws_group_catalog WHERE account_id=? AND group_jid=?').run(dedicated, group.conversationKey);
      } finally { temp.close(); }
      await save(ordinary,[direct]); await save(dedicated,[group]);
      assert.ok(conversation(ordinary, direct.conversationKey));
      assert.deepEqual(readGroups(), [group.conversationKey,group2.conversationKey]);
      assert.equal(protectionSnapshot(), baseline);
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
