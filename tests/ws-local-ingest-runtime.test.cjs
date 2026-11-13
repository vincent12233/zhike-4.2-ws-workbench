'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync, mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const wsCore = require('../resources/app/modules/ws-workbench-core.js');

const app = path.join(__dirname, '..', 'resources', 'app');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-ws-ingest-'));
const port = 46321;
const token = 'ws-local-ingest-test-token';
const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
  cwd: app,
  windowsHide: true,
  env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token, ZHIKE_PARENT_PID: String(process.pid), ZHIKE_STORAGE_MODE: 'local' },
  stdio: 'ignore',
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const headers = { 'content-type': 'application/json', 'x-zhike-api-token': token, origin: `http://127.0.0.1:${port}` };
async function stopSidecar() {
  try { await request('/api/shutdown', { method: 'POST', headers: { 'x-zhike-shutdown-token': token } }); } catch {}
  // Wait for server.close() and db.close() before removing SQLite WAL/SHM files.
  // Immediate SIGKILL is flaky on Windows and can leave handles locked (EPERM).
  const deadline = Date.now() + 3000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await wait(50);
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill('SIGTERM'); } catch {}
    const termDeadline = Date.now() + 1000;
    while (child.exitCode === null && child.signalCode === null && Date.now() < termDeadline) await wait(50);
  }
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill('SIGKILL'); } catch {}
    await wait(100);
  }
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
      if (!existsSync(dataDir)) return;
    } catch (error) {
      if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error;
      await wait(50);
    }
  }
  rmSync(dataDir, { recursive: true, force: true });
}
async function request(route, init = {}) {
  for (let i = 0; i < 300; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${route}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
      return { response, body: await response.json().catch(() => ({})) };
    } catch { await wait(50); }
  }
  throw new Error('isolated local sidecar did not start');
}

(async () => {
  try {
    const health = await request('/api/health');
    assert.equal(health.response.status, 200);
    const mismatchedDirection = await request('/api/ws/ingest/batch', { method:'POST', body:JSON.stringify({
      accountId:'default', checkpoints:[{ conversationType: 'direct', conversationKey:'direction-mismatch', historyLoaded:true, historyMessageCount:1, directionVersion:4 }],
      messages:[{ conversationType: 'direct', conversationKey:'direction-mismatch', externalMessageId:'bad-direction-1', body:'must stay isolated', direction:'incoming', directionSource:'icon-tail-out' }],
    }) });
    assert.equal(mismatchedDirection.response.status,422,'incoming message cannot claim outgoing DOM evidence');
    const arbitraryDirectionSource = await request('/api/ws/ingest/batch', { method:'POST', body:JSON.stringify({
      accountId:'default', messages:[{ conversationType: 'direct', conversationKey:'direction-mismatch', externalMessageId:'bad-direction-2', body:'must stay isolated too', direction:'outgoing', directionSource:'arbitrary-secret-source' }],
    }) });
    assert.equal(arbitraryDirectionSource.response.status,422,'unknown direction evidence is rejected before transaction');
    const rejectedDirectionRows = await request('/api/ws/conversations?limit=20');
    assert.equal(rejectedDirectionRows.body.conversations.some(item=>item.externalId==='direction-mismatch'),false,'rejected direction batch cannot create a conversation or v4 checkpoint');
    const payload = {
      protocol: 'zhike.ws.ingest.batch.v1',
      connectorId: 'desktop-webview2',
      accountId: 'default',
      capturedAt: '2026-11-10T10:00:00.000Z',
      scope: 'visible-authorized-content',
      checkpoints: [
        { accountId: 'default', conversationType: 'direct', conversationKey: 'wa-001', displayName: '张三', lastMessagePreview: '列表预览：我想了解产品价格', lastMessageAt: '2026-11-10T09:59:00.000Z', unreadCount: 3, cursor: 'c1', lastMessageFingerprint: 'f1', updatedAt: '2026-11-10T10:00:00.000Z' },
        { accountId: 'default', conversationType: 'direct', conversationKey: 'wa-002', displayName: '李四', lastMessagePreview: '未打开会话的最新预览', lastMessageAt: '2026-11-10T09:58:00.000Z', unreadCount: 4, cursor: 'c2', lastMessageFingerprint: 'f2', updatedAt: '2026-11-10T10:00:00.000Z' },
      ],
      messages: [
        { conversationType: 'direct', conversationKey: 'wa-001', externalMessageId: 'm-001', body: '我想了解产品价格', direction: 'incoming', sentAt: '2026-11-10T09:59:00.000Z', cursor: 'm-001' },
        { conversationType: 'direct', conversationKey: 'wa-001', externalMessageId: 'm-002', body: '我稍后给您确认', direction: 'outgoing', sentAt: '2026-11-10T10:00:00.000Z', cursor: 'm-002' },
      ],
    };
    const first = await request('/api/ws/ingest/batch', { method: 'POST', body: JSON.stringify(payload) });
    assert.equal(first.response.status, 200);
    assert.equal(first.body.accepted, 2);
    assert.equal(first.body.deduplicated, 0);
    assert.equal(first.body.messageIds.length, 2);
    const conversations = await request('/api/ws/conversations?limit=20');
    assert.equal(conversations.body.conversations.length, 2, 'list-only checkpoints create conversations without opening them');
    assert.equal(conversations.body.conversations.find(item => item.externalId === 'wa-001').title, '张三');
    const firstConversation = conversations.body.conversations.find(item => item.externalId === 'wa-001');
    const listOnlyConversation = conversations.body.conversations.find(item => item.externalId === 'wa-002');
    assert.equal(firstConversation.lastMessageText, '我稍后给您确认', 'real message text wins over a list preview');
    assert.equal(firstConversation.unreadCount, 3, 'checkpoint unread count is authoritative when supplied');
    assert.equal(listOnlyConversation.lastMessageText, '未打开会话的最新预览', 'list-only checkpoint preserves the latest preview');
    assert.equal(listOnlyConversation.lastMessageAt, '2026-11-10T09:58:00.000Z');
    assert.equal(listOnlyConversation.unreadCount, 4);
    assert.equal(listOnlyConversation.data.lastMessageSource, 'ws-list-preview');
    assert.equal(firstConversation.data.lastMessageSource, 'ws-message');
    const checkpointRefresh = await request('/api/ws/ingest/batch', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        capturedAt: '2026-11-10T10:05:00.000Z',
        messages: [],
        checkpoints: [
          { accountId: 'default', conversationType: 'direct', conversationKey: 'wa-001', displayName: '张三', lastMessagePreview: '旧列表预览不应覆盖真实消息', lastMessageAt: '2026-11-10T10:05:00.000Z', unreadCount: 1, cursor: 'c3', lastMessageFingerprint: 'f3', updatedAt: '2026-11-10T10:05:00.000Z' },
          { accountId: 'default', conversationType: 'direct', conversationKey: 'wa-002', displayName: '李四', lastMessagePreview: '列表预览已更新', lastMessageAt: '2026-11-10T10:04:00.000Z', unreadCount: 2, cursor: 'c4', lastMessageFingerprint: 'f4', updatedAt: '2026-11-10T10:05:00.000Z' },
        ],
      }),
    });
    assert.equal(checkpointRefresh.response.status, 200);
    const refreshed = await request('/api/ws/conversations?limit=20');
    const refreshedFirst = refreshed.body.conversations.find(item => item.externalId === 'wa-001');
    const refreshedListOnly = refreshed.body.conversations.find(item => item.externalId === 'wa-002');
    assert.equal(refreshedFirst.lastMessageText, '我稍后给您确认', 'later list previews must not overwrite a real message');
    assert.equal(refreshedFirst.lastMessageAt, '2026-11-10T10:00:00.000Z', 'real message timestamp must remain authoritative');
    assert.equal(refreshedFirst.unreadCount, 1, 'list checkpoint can refresh unread count independently');
    assert.equal(refreshedFirst.data.lastMessageSource, 'ws-message');
    assert.equal(refreshedListOnly.lastMessageText, '列表预览已更新');
    assert.equal(refreshedListOnly.lastMessageAt, '2026-11-10T10:04:00.000Z');
    assert.equal(refreshedListOnly.unreadCount, 2);
    const repeated = await request('/api/ws/ingest/batch', { method: 'POST', body: JSON.stringify(payload) });
    assert.equal(repeated.response.status, 200);
    assert.equal(repeated.body.accepted, 0);
    assert.equal(repeated.body.deduplicated, 2, 'repeated native collector payload is idempotent');
    const rows = await request(`/api/ws/messages?conversationId=${encodeURIComponent(conversations.body.conversations.find(item => item.externalId === 'wa-001').id)}&limit=20`);
    assert.equal(rows.body.messages.length, 2);
    assert.equal(rows.body.messages[0].originalText, '我想了解产品价格');
    assert.equal(rows.body.messages[0].sentAt, '2026-11-10T09:59:00.000Z');
    assert.equal(rows.body.messages[0].sentAtKnown, true);
    assert.equal(rows.body.messages[0].timestampSource, 'whatsapp-preamble');

    const unknownPayload = {
      protocol: 'zhike.ws.ingest.batch.v1', connectorId: 'desktop-webview2', accountId: 'default', capturedAt: '2026-11-13T10:00:00.000Z', scope: 'read-history',
      checkpoints: [{ conversationType: 'direct', conversationKey: 'wa-time-repair', historyLoaded: true, historyMessageCount: 1, coverage: 'read-history', lastMessageFingerprint: 'time-list-v1', unreadCount: 0 }],
      messages: [{ conversationType: 'direct', conversationKey: 'wa-time-repair', externalMessageId: 'time-message-1', body: '原文保持不变', direction: 'incoming', order: 1, observedAt: '2026-11-13T10:00:00.000Z', timestampText: '无法解析的原始时间', timestampSource: 'unparsed' }],
    };
    const unknownWrite = await request('/api/ws/ingest/batch', { method: 'POST', body: JSON.stringify(unknownPayload) });
    assert.equal(unknownWrite.response.status, 200);
    assert.equal(unknownWrite.body.accepted, 1);
    const timeConversation = (await request('/api/ws/conversations?limit=20')).body.conversations.find(item => item.externalId === 'wa-time-repair');
    let timeRows = await request(`/api/ws/messages?conversationId=${encodeURIComponent(timeConversation.id)}&limit=20`);
    assert.equal(timeRows.body.total, 1);
    assert.equal(timeRows.body.messages[0].createdAt, '2026-11-13T10:00:00.000Z', 'createdAt remains the compatible record time when the business time is unknown');
    assert.equal(timeRows.body.messages[0].sentAt, '', 'unknown WhatsApp time must not expose observedAt as sentAt');
    assert.equal(timeRows.body.messages[0].sentAtKnown, false);
    assert.equal(timeRows.body.messages[0].observedAt, '2026-11-13T10:00:00.000Z');
    assert.equal(timeRows.body.messages[0].timestampText, '无法解析的原始时间');
    assert.equal(timeRows.body.messages[0].timestampSource, 'unparsed');
    const unknownHistoryHash = timeConversation.data.historyFingerprint;
    assert.match(unknownHistoryHash, /^[a-f0-9]{64}$/, 'unknown business time still has a stable explicit-unknown history hash');

    const authoritativeReplay = structuredClone(unknownPayload);
    authoritativeReplay.capturedAt = '2026-11-13T10:05:00.000Z';
    authoritativeReplay.messages[0] = { ...authoritativeReplay.messages[0], sentAt: '2026-10-02T04:45:00.000Z', observedAt: '2026-11-13T10:05:00.000Z', timestampText: '02/10/2026, 10:15', timestampSource: 'whatsapp-preamble' };
    const repaired = await request('/api/ws/ingest/batch', { method: 'POST', body: JSON.stringify(authoritativeReplay) });
    assert.equal(repaired.response.status, 200);
    assert.equal(repaired.body.accepted, 0);
    assert.equal(repaired.body.deduplicated, 1);
    assert.equal(repaired.body.repairedTimestamps, 1, 'same external id must repair an old WebView fallback timestamp');
    timeRows = await request(`/api/ws/messages?conversationId=${encodeURIComponent(timeConversation.id)}&limit=20`);
    assert.equal(timeRows.body.total, 1, 'authoritative replay must not duplicate the message');
    assert.equal(timeRows.body.messages[0].originalText, '原文保持不变');
    assert.equal(timeRows.body.messages[0].createdAt, '2026-10-02T04:45:00.000Z');
    assert.equal(timeRows.body.messages[0].sentAt, '2026-10-02T04:45:00.000Z');
    assert.equal(timeRows.body.messages[0].sentAtKnown, true);
    assert.equal(timeRows.body.messages[0].timestampText, '02/10/2026, 10:15');
    assert.equal(timeRows.body.messages[0].timestampSource, 'whatsapp-preamble');
    let repairedConversation = (await request('/api/ws/conversations?limit=20')).body.conversations.find(item => item.externalId === 'wa-time-repair');
    const repairedHistoryHash = repairedConversation.data.historyFingerprint;
    assert.notEqual(repairedHistoryHash, unknownHistoryHash, 'authoritative time repair changes the explicit-unknown transcript hash exactly once');
    const repairedReplay = await request('/api/ws/ingest/batch', { method: 'POST', body: JSON.stringify(authoritativeReplay) });
    assert.equal(repairedReplay.body.accepted, 0);
    assert.equal(repairedReplay.body.deduplicated, 1);
    assert.equal(repairedReplay.body.repairedTimestamps, 0, 'repeating an authoritative timestamp is a no-op');
    repairedConversation = (await request('/api/ws/conversations?limit=20')).body.conversations.find(item => item.externalId === 'wa-time-repair');
    assert.equal(repairedConversation.data.historyFingerprint, repairedHistoryHash, 'exact final replay keeps the authoritative history hash stable');

    const manual = await request('/api/ws/messages', { method: 'POST', body: JSON.stringify({ conversationId: timeConversation.id, externalId: 'manual-protected', direction: 'receive', originalText: '人工导入原文', order: 2, data: { source: 'user-visible-selection' } }) });
    assert.equal(manual.response.status, 200);
    const manualCreatedAt = manual.body.createdAt;
    const manualReplay = await request('/api/ws/ingest/batch', { method: 'POST', body: JSON.stringify({ ...authoritativeReplay, messages: [{ ...authoritativeReplay.messages[0], externalMessageId: 'manual-protected', body: '不同采集正文不得覆盖人工原文', order: 2, sentAt: '2026-09-01T00:00:00.000Z' }] }) });
    assert.equal(manualReplay.response.status, 200);
    const protectedRows = await request(`/api/ws/messages?conversationId=${encodeURIComponent(timeConversation.id)}&limit=20`);
    const protectedManual = protectedRows.body.messages.find(item => item.externalId === 'manual-protected');
    assert.equal(protectedManual.originalText, '人工导入原文');
    assert.equal(protectedManual.createdAt, manualCreatedAt, 'native replay must not rewrite time on manual/imported messages');

    const unknownDirection = await request('/api/ws/ingest/batch', { method: 'POST', body: JSON.stringify({
      protocol: 'zhike.ws.ingest.batch.v1', connectorId: 'desktop-webview2', accountId: 'default', capturedAt: '2026-11-13T10:10:00.000Z', scope: 'read-history', checkpoints: [],
      messages: [{ conversationType: 'direct', conversationKey: 'wa-direction-unknown', externalMessageId: 'unknown-direction-1', body: '方向未确认', direction: 'unknown', order: 1 }],
    }) });
    assert.equal(unknownDirection.response.status, 422, 'unknown native direction must be rejected instead of defaulting to receive');
    assert.match(unknownDirection.body.error, /方向无法确认/);

    const legacyDirectionPayload = {
      protocol: 'zhike.ws.ingest.batch.v1', connectorId: 'desktop-webview2', accountId: 'default', capturedAt: '2026-11-13T10:20:00.000Z', scope: 'read-history',
      checkpoints: [{ conversationType: 'direct', conversationKey: 'wa-direction-repair', historyLoaded: true, historyMessageCount: 1, coverage: 'read-history', lastMessageFingerprint: 'direction-v3', unreadCount: 0 }],
      messages: [{ conversationType: 'direct', conversationKey: 'wa-direction-repair', externalMessageId: 'wa-row-legacy123', body: 'Hello I am your assistant', direction: 'incoming', order: 1, observedAt: '2026-11-13T10:20:00.000Z', timestampSource: 'unparsed' }],
    };
    const legacyDirectionWrite = await request('/api/ws/ingest/batch', { method: 'POST', body: JSON.stringify(legacyDirectionPayload) });
    assert.equal(legacyDirectionWrite.response.status, 200);
    const directionConversationV3 = (await request('/api/ws/conversations?limit=50')).body.conversations.find(item => item.externalId === 'wa-direction-repair');
    const directionHashV3 = directionConversationV3.data.historyFingerprint;
    const directionRowsV3 = await request(`/api/ws/messages?conversationId=${encodeURIComponent(directionConversationV3.id)}&limit=20`);
    const legacyRowId = directionRowsV3.body.messages[0].id;
    const legacyObservedAt = directionRowsV3.body.messages[0].observedAt;
    assert.equal(directionRowsV3.body.messages[0].direction, 'receive');
    const v3Analysis = await request('/api/ws/analyses', { method: 'POST', body: JSON.stringify({ conversationId: directionConversationV3.id, result: { summary: '旧方向分析', confidence: 0.9, transcriptInfo: { sourceFingerprint: directionHashV3, directionVersion: 3 } } }) });
    let syncVersion = await request('/api/state/version');
    const v3Sync = await request('/api/ws/crm-sync', { method: 'POST', headers: { 'x-state-version': String(syncVersion.body.version) }, body: JSON.stringify({ conversationId: directionConversationV3.id, analysisId: v3Analysis.body.id }) });
    assert.equal(v3Sync.response.status, 409, 'native v3 analysis must never write customer fields');
    assert.equal(v3Sync.body.directionRecollectionRequired, true);

    const correctedDirectionPayload = {
      ...legacyDirectionPayload,
      capturedAt: '2026-11-13T10:25:00.000Z',
      checkpoints: [{ conversationType: 'direct', conversationKey: 'wa-direction-repair', historyLoaded: true, historyMessageCount: 1, coverage: 'read-history', lastMessageFingerprint: 'direction-v4', unreadCount: 0, directionVersion: 4, directionUnresolvedCount: 0 }],
      messages: [{ conversationType: 'direct', conversationKey: 'wa-direction-repair', externalMessageId: 'true_native-direction-1', legacyExternalMessageId: 'wa-row-legacy123', directionSource: 'icon-tail-out', body: 'Hello I am your assistant', direction: 'outgoing', order: 1, observedAt: '2026-11-13T10:25:00.000Z', timestampSource: 'unparsed' }],
    };
    const correctedDirection = await request('/api/ws/ingest/batch', { method: 'POST', body: JSON.stringify(correctedDirectionPayload) });
    assert.equal(correctedDirection.response.status, 200);
    assert.equal(correctedDirection.body.accepted, 0);
    assert.equal(correctedDirection.body.repairedDirections, 1, 'explicit legacy alias repairs the old native row in place');
    const directionRowsV4 = await request(`/api/ws/messages?conversationId=${encodeURIComponent(directionConversationV3.id)}&limit=20`);
    assert.equal(directionRowsV4.body.total, 1, 'direction repair must not duplicate the old message');
    assert.equal(directionRowsV4.body.messages[0].id, legacyRowId, 'direction repair preserves the database row id');
    assert.equal(directionRowsV4.body.messages[0].externalId, 'true_native-direction-1');
    assert.equal(directionRowsV4.body.messages[0].direction, 'send');
    assert.equal(directionRowsV4.body.messages[0].originalText, 'Hello I am your assistant');
    assert.equal(directionRowsV4.body.messages[0].observedAt, legacyObservedAt, 'direction repair preserves the original observation time');
    assert.equal(directionRowsV4.body.messages[0].data.previousExternalMessageId, 'wa-row-legacy123');
    assert.equal(directionRowsV4.body.messages[0].data.directionSource, 'icon-tail-out');
    const directionConversationV4 = (await request('/api/ws/conversations?limit=50')).body.conversations.find(item => item.externalId === 'wa-direction-repair');
    assert.equal(directionConversationV4.data.directionVersion, 4);
    assert.notEqual(directionConversationV4.data.historyFingerprint, directionHashV3, 'corrected speaker role changes the authoritative transcript hash');
    const missingV4Analysis = await request('/api/ws/analyses', { method: 'POST', body: JSON.stringify({ conversationId: directionConversationV3.id, result: { summary: '未声明方向版本', confidence: 0.9, transcriptInfo: { sourceFingerprint: directionConversationV4.data.historyFingerprint } } }) });
    syncVersion = await request('/api/state/version');
    const missingV4Sync = await request('/api/ws/crm-sync', { method: 'POST', headers: { 'x-state-version': String(syncVersion.body.version) }, body: JSON.stringify({ conversationId: directionConversationV3.id, analysisId: missingV4Analysis.body.id }) });
    assert.equal(missingV4Sync.response.status, 409, 'native analysis itself must attest directionVersion 4');
    const v4Analysis = await request('/api/ws/analyses', { method: 'POST', body: JSON.stringify({ conversationId: directionConversationV3.id, result: { summary: '双向校验完成', confidence: 0.9, transcriptInfo: { sourceFingerprint: directionConversationV4.data.historyFingerprint, directionVersion: 4 } } }) });
    syncVersion = await request('/api/state/version');
    assert.equal((await request('/api/ws/crm-sync', { method: 'POST', headers: { 'x-state-version': String(syncVersion.body.version) }, body: JSON.stringify({ conversationId: directionConversationV3.id, analysisId: v4Analysis.body.id }) })).response.status, 200, 'verified v4 analysis remains CRM-compatible');
    const correctedReplay = await request('/api/ws/ingest/batch', { method: 'POST', body: JSON.stringify(correctedDirectionPayload) });
    assert.equal(correctedReplay.response.status, 200);
    assert.equal(correctedReplay.body.accepted, 0);
    assert.equal(correctedReplay.body.repairedDirections, 0, 'corrected canonical replay is idempotent');
    assert.equal((await request(`/api/ws/messages?conversationId=${encodeURIComponent(directionConversationV3.id)}&limit=20`)).body.total, 1);
    const hashBeforeLateV3 = (await request('/api/ws/conversations?limit=50')).body.conversations.find(item => item.externalId === 'wa-direction-repair').data.historyFingerprint;
    const lateV3Replay = await request('/api/ws/ingest/batch', { method: 'POST', body: JSON.stringify({ ...legacyDirectionPayload, capturedAt: '2026-11-13T10:27:00.000Z' }) });
    assert.equal(lateV3Replay.response.status, 200);
    const afterLateV3Rows = (await request(`/api/ws/messages?conversationId=${encodeURIComponent(directionConversationV3.id)}&limit=20`)).body.messages;
    assert.equal(afterLateV3Rows.length, 1, 'a delayed v3 queue packet resolves through the recorded exact alias');
    assert.equal(afterLateV3Rows[0].id, legacyRowId);
    assert.equal(afterLateV3Rows[0].externalId, 'true_native-direction-1');
    assert.equal(afterLateV3Rows[0].direction, 'send', 'a delayed v3 packet cannot downgrade the verified outgoing role');
    assert.equal(afterLateV3Rows[0].data.directionSource, 'icon-tail-out');
    const hashAfterLateV3 = (await request('/api/ws/conversations?limit=50')).body.conversations.find(item => item.externalId === 'wa-direction-repair').data.historyFingerprint;
    assert.equal(hashAfterLateV3, hashBeforeLateV3, 'late v3 replay leaves the v4 authoritative hash unchanged');

    const sameTextPayload = {
      protocol: 'zhike.ws.ingest.batch.v1', connectorId: 'desktop-webview2', accountId: 'default', capturedAt: '2026-11-13T10:30:00.000Z', scope: 'read-history',
      checkpoints: [{ conversationType: 'direct', conversationKey: 'wa-same-text-roles', historyLoaded: true, historyMessageCount: 2, coverage: 'read-history', lastMessageFingerprint: 'same-text-v4', unreadCount: 0, directionVersion: 4, directionUnresolvedCount: 0 }],
      messages: [
        { conversationType: 'direct', conversationKey: 'wa-same-text-roles', externalMessageId: 'false_same-text-in', directionSource: 'palette-incoming', body: 'Same sentence', direction: 'incoming', order: 1, sentAt: '2026-11-10T10:00:00.000Z' },
        { conversationType: 'direct', conversationKey: 'wa-same-text-roles', externalMessageId: 'true_same-text-out', directionSource: 'palette-outgoing', body: 'Same sentence', direction: 'outgoing', order: 2, sentAt: '2026-11-10T10:01:00.000Z' },
      ],
    };
    assert.equal((await request('/api/ws/ingest/batch', { method: 'POST', body: JSON.stringify(sameTextPayload) })).response.status, 200);
    const sameTextConversation = (await request('/api/ws/conversations?limit=50')).body.conversations.find(item => item.externalId === 'wa-same-text-roles');
    const sameTextRows = (await request(`/api/ws/messages?conversationId=${encodeURIComponent(sameTextConversation.id)}&limit=20`)).body.messages;
    assert.equal(sameTextRows.length, 2, 'identical text from both speakers stays as two messages');
    assert.deepEqual(sameTextRows.map(item => item.direction), ['receive', 'send']);
    const bidirectionalTranscript = wsCore.buildFullHistoryTranscript(sameTextRows, { maxChars: 4000 });
    assert.match(bidirectionalTranscript.text, /客户：Same sentence/);
    assert.match(bidirectionalTranscript.text, /我：Same sentence/);

    const manualDirectionReplay = await request('/api/ws/ingest/batch', { method: 'POST', body: JSON.stringify({ ...correctedDirectionPayload, checkpoints: [], messages: [{ ...correctedDirectionPayload.messages[0], conversationType: 'direct', conversationKey: 'wa-time-repair', externalMessageId: 'manual-protected', legacyExternalMessageId: '', body: '人工导入原文', direction: 'outgoing', directionSource: 'class-message-out' }] }) });
    assert.equal(manualDirectionReplay.response.status, 200);
    const stillProtectedManual = (await request(`/api/ws/messages?conversationId=${encodeURIComponent(timeConversation.id)}&limit=20`)).body.messages.find(item => item.externalId === 'manual-protected');
    assert.equal(stillProtectedManual.direction, 'receive', 'native correction must not rewrite manual/imported direction');
    assert.equal(stillProtectedManual.id, manual.body.id);

    const exportedTimes = await request('/api/ws/export');
    const exportedTimeMessage = exportedTimes.body.messages.find(item => item.externalId === 'time-message-1');
    assert.equal(exportedTimeMessage.sentAt, '2026-10-02T04:45:00.000Z');
    assert.equal(exportedTimeMessage.timestampText, '02/10/2026, 10:15');
    const restoredTimes = await request('/api/ws/import', { method: 'POST', body: JSON.stringify(exportedTimes.body) });
    assert.equal(restoredTimes.response.status, 200);
    const restoredRows = await request(`/api/ws/messages?conversationId=${encodeURIComponent(timeConversation.id)}&limit=20`);
    const restoredTimeMessage = restoredRows.body.messages.find(item => item.externalId === 'time-message-1');
    assert.equal(restoredTimeMessage.sentAt, '2026-10-02T04:45:00.000Z', 'backup restore must preserve authoritative sentAt');
    assert.equal(restoredTimeMessage.timestampText, '02/10/2026, 10:15', 'backup restore must preserve the original WhatsApp preamble');

    const historyV2 = {
      protocol: 'zhike.ws.ingest.batch.v1', connectorId: 'desktop-webview2', accountId: 'default', capturedAt: '2026-11-13T11:00:00.000Z', scope: 'read-history',
      checkpoints: [{ conversationType: 'direct', conversationKey: 'wa-history-versioned', displayName: '历史版本客户', coverage: 'read-history-full', historyLoaded: true, historyMessageCount: 1, lastMessageFingerprint: 'history-v2', cursor: 'history-v2', unreadCount: 0 }],
      messages: [{ conversationType: 'direct', conversationKey: 'wa-history-versioned', externalMessageId: 'history-message-1', body: '第一条历史消息', direction: 'incoming', order: 1, sentAt: '2026-11-01T08:00:00.000Z', timestampText: '01/11/2026, 13:30', timestampSource: 'whatsapp-preamble' }],
    };
    assert.equal((await request('/api/ws/ingest/batch', { method: 'POST', body: JSON.stringify(historyV2) })).response.status, 200);
    const historyConversation = (await request('/api/ws/conversations?limit=50')).body.conversations.find(item => item.externalId === 'wa-history-versioned');
    assert.ok(historyConversation?.id);
    const historyH1 = historyConversation.data.historyFingerprint;
    assert.match(historyH1, /^[a-f0-9]{64}$/);
    assert.equal(historyConversation.data.lastMessageFingerprint, historyH1);
    assert.equal((await request('/api/ws/ingest/batch', { method: 'POST', body: JSON.stringify(historyV2) })).response.status, 200);
    const exactReplayConversation = (await request('/api/ws/conversations?limit=50')).body.conversations.find(item => item.externalId === 'wa-history-versioned');
    assert.equal(exactReplayConversation.data.historyFingerprint, historyH1, 'same full transcript replay keeps the server hash stable');
    const enqueue = async (id, payload) => {
      const result = await request('/api/ws/ai-jobs', { method: 'POST', body: JSON.stringify({ action: 'enqueue', accountId: 'default', conversationId: historyConversation.id, id, idempotencyKey: id, payload }) });
      assert.equal(result.response.status, 201);
      return result.body.job;
    };
    await enqueue('old-queued-job', { sourceFingerprint: historyH1 });
    await enqueue('old-retryable-job', { sourceFingerprint: historyH1 });
    await request('/api/ws/ai-jobs', { method: 'POST', body: JSON.stringify({ action: 'claim', accountId: 'default', jobId: 'old-retryable-job' }) });
    await request('/api/ws/ai-jobs', { method: 'POST', body: JSON.stringify({ action: 'fail', accountId: 'default', jobId: 'old-retryable-job', error: '旧历史临时失败', retryable: true }) });
    await enqueue('old-running-job', { sourceFingerprint: historyH1 });
    await request('/api/ws/ai-jobs', { method: 'POST', body: JSON.stringify({ action: 'claim', accountId: 'default', jobId: 'old-running-job' }) });
    await enqueue('manual-no-fingerprint-job', { feature: 'manual-import' });

    const historyV3 = structuredClone(historyV2);
    historyV3.capturedAt = '2026-11-13T11:05:00.000Z';
    historyV3.checkpoints[0] = { ...historyV3.checkpoints[0], historyMessageCount: 2, lastMessageFingerprint: 'history-v3', cursor: 'history-v3' };
    historyV3.messages.push({ conversationType: 'direct', conversationKey: 'wa-history-versioned', externalMessageId: 'history-message-2', body: '第二条历史消息', direction: 'outgoing', order: 2, sentAt: '2026-11-02T09:00:00.000Z', timestampText: '02/11/2026, 14:30', timestampSource: 'whatsapp-preamble' });
    assert.equal((await request('/api/ws/ingest/batch', { method: 'POST', body: JSON.stringify(historyV3) })).response.status, 200);
    const historyAfterV3 = (await request('/api/ws/conversations?limit=50')).body.conversations.find(item => item.externalId === 'wa-history-versioned');
    const historyH2 = historyAfterV3.data.historyFingerprint;
    assert.notEqual(historyH2, historyH1, 'a new external message changes the authoritative transcript hash');
    await enqueue('current-history-job', { sourceFingerprint: historyH2 });
    const jobs = (await request(`/api/ws/ai-jobs?accountId=default&conversationId=${encodeURIComponent(historyConversation.id)}&limit=20`)).body.jobs;
    for (const id of ['old-queued-job', 'old-retryable-job', 'old-running-job']) {
      const job = jobs.find(item => item.id === id);
      assert.equal(job.status, 'failed', `${id} must stop when authoritative history fingerprint changes`);
      assert.equal(job.lastError, '聊天历史已更新，已由新分析替代');
      assert.equal(job.lockedAt, '');
      assert.equal(job.nextAttemptAt, '');
    }
    assert.equal(jobs.find(item => item.id === 'manual-no-fingerprint-job').status, 'queued', 'manual jobs without a source fingerprint must remain queued');
    assert.equal(jobs.find(item => item.id === 'current-history-job').status, 'queued', 'a job for the current history fingerprint must remain queued');
    console.log('WS local ingest runtime: list-only discovery, message persistence and idempotent replay pass');
  } finally {
    await stopSidecar();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
