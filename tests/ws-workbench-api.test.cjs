const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const app = path.join(__dirname, '..', 'resources', 'app');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-ws-api-'));
const port = 4471;
const token = 'ws-api-test-token';
const child = spawn(process.execPath, ['server.mjs'], {
  cwd: app,
  windowsHide: true,
  env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token },
  stdio: 'ignore',
});
const headers = { 'content-type': 'application/json', 'x-zhike-api-token': token, origin: `http://127.0.0.1:${port}` };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(pathname, init = {}) {
  for (let i = 0; i < 120; i++) {
    try {
      const nextHeaders = { ...headers, ...(init.headers || {}) };
      if (String(init.method || 'GET').toUpperCase() !== 'GET' && pathname !== '/api/state' && !Object.keys(nextHeaders).some(key => key.toLowerCase() === 'x-state-version')) {
        const version = await fetch(`http://127.0.0.1:${port}/api/state/version`, { headers }).then(response => response.json());
        nextHeaders['x-state-version'] = String(version.version || '');
      }
      return await fetch(`http://127.0.0.1:${port}${pathname}`, { ...init, headers: nextHeaders });
    }
    catch { await wait(50); }
  }
  throw new Error('isolated server did not become available');
}
async function json(response) { return response.json(); }
(async () => {
  try {
    const orphanSettings = await request('/api/ws/settings?conversationId=missing', { method: 'PUT', body: JSON.stringify({ enabled: true }) });
    assert.equal(orphanSettings.status, 400);

    const conversation = await request('/api/ws/conversations', { method: 'POST', body: JSON.stringify({ externalId: 'wa-001', title: '张三', customerId: '', language: 'English', unreadCount: 2 }) });
    assert.equal(conversation.status, 200);
    const conversationBody = await json(conversation);
    assert.ok(conversationBody.id);
    assert.equal(conversationBody.language, 'English');
    assert.equal(conversationBody.unreadCount, 2);

    const collectionRun = await json(await request('/api/ws/collection-runs', { method: 'POST', body: JSON.stringify({}) }));
    assert.equal(collectionRun.run.status, 'created');
    const checkpointRun = await json(await request('/api/ws/collection-runs', { method: 'PATCH', body: JSON.stringify({ id: collectionRun.run.id, status: 'discovering', discovered: 1, total: 1, cursor: JSON.stringify({ lastExternalId: 'wa-001', discovered: 1 }), resumeCount: 1, lastSuccessAt: '2026-11-06T08:00:00Z' }) }));
    assert.equal(JSON.parse(checkpointRun.run.cursor).lastExternalId, 'wa-001');
    assert.equal(checkpointRun.run.resumeCount, 1);
    assert.equal(checkpointRun.run.lastSuccessAt, '2026-11-06T08:00:00Z');

    const settings = await request(`/api/ws/settings?conversationId=${encodeURIComponent(conversationBody.id)}`, { method: 'PUT', body: JSON.stringify({ enabled: false, receive: true, send: false, targetLanguage: '中文', sendLanguage: 'English', aiEnabled: false }) });
    assert.equal(settings.status, 200);
    const settingsBody = await json(settings);
    assert.equal(settingsBody.conversationId, conversationBody.id);
    assert.equal(settingsBody.enabled, false);
    assert.equal(settingsBody.receive, true, '关闭总开关不能抹掉接收方向偏好');
    assert.equal(settingsBody.send, false);
    assert.equal(settingsBody.sendLanguage, 'English');
    assert.equal(settingsBody.aiEnabled, false);

    const partialUpdate = await request('/api/ws/conversations', { method: 'POST', body: JSON.stringify({ externalId: 'wa-001', customerId: 'C-1' }) });
    const partialBody = await json(partialUpdate);
    assert.equal(partialBody.title, '张三', '未提供标题时不得覆盖已有标题');
    assert.equal(partialBody.customerId, 'C-1');
    assert.equal(partialBody.language, 'English');

    const first = await request('/api/ws/messages', { method: 'POST', body: JSON.stringify({ conversationId: conversationBody.id, externalId: 'msg-1', direction: 'receive', originalText: 'Hello', translationStatus: 'pending', translationAttempts: 1, lastAttemptAt: '2026-11-05T08:00:00Z', order: 1 }) });
    assert.equal(first.status, 200);
    const firstBody = await json(first);
    assert.equal(firstBody.translationStatus, 'pending');
    assert.equal(firstBody.translationAttempts, 1);

    const translated = await request('/api/ws/messages', { method: 'POST', body: JSON.stringify({ conversationId: conversationBody.id, externalId: 'msg-1', direction: 'receive', originalText: 'Hello', translatedText: '你好', targetLanguage: '中文', translationStatus: 'translated', translationAttempts: 2, translationError: '', lastAttemptAt: '2026-11-05T08:01:00Z', order: 1 }) });
    const translatedBody = await json(translated);
    assert.equal(translatedBody.id, firstBody.id);
    assert.equal(translatedBody.existed, true);
    assert.equal(translatedBody.translatedText, '你好');
    assert.equal(translatedBody.translationAttempts, 2);

    const batchPayload = {
      conversationId: conversationBody.id,
      fingerprint: 'visible-batch-001',
      messages: [
        { externalId: 'msg-2', direction: 'receive', originalText: 'Need price', order: 2, translationStatus: 'pending' },
        { externalId: 'msg-3', direction: 'send', originalText: 'I will check', order: 3, translationStatus: 'none' },
      ],
    };
    const batch = await request('/api/ws/messages/batch', { method: 'POST', body: JSON.stringify(batchPayload) });
    assert.equal(batch.status, 200);
    const batchBody = await json(batch);
    assert.equal(batchBody.inserted, 2);
    assert.equal(batchBody.existed, 0);
    assert.equal(batchBody.messages.length, 2);
    const repeatedBatch = await request('/api/ws/messages/batch', { method: 'POST', body: JSON.stringify(batchPayload) });
    const repeatedBody = await json(repeatedBatch);
    assert.equal(repeatedBody.inserted, 0);
    assert.equal(repeatedBody.existed, 2);
    assert.equal(repeatedBody.repeated, true);

    const messages = await request(`/api/ws/messages?conversationId=${encodeURIComponent(conversationBody.id)}`);
    const messageRows = (await json(messages)).messages;
    assert.equal(messageRows.length, 3);
    assert.equal(messageRows.find(item => item.externalId === 'msg-2').translationStatus, 'pending');

    const collectionItem = await json(await request('/api/ws/collection-items', { method: 'POST', body: JSON.stringify({ runId: collectionRun.run.id, conversationId: conversationBody.id, status: 'completed', coverageStatus: 'visible', checkpoint: '3' }) }));
    assert.equal(collectionItem.item.coverageStatus, 'visible');
    const retryableItem = await json(await request('/api/ws/collection-items', { method: 'PATCH', body: JSON.stringify({ runId: collectionRun.run.id, conversationId: conversationBody.id, status: 'completed', analysisStatus: 'retryable', lastError: 'AI 服务未配置，请先配置 TeamoRouter。' }) }));
    assert.equal(retryableItem.item.analysisStatus, 'retryable');
    assert.match(retryableItem.item.lastError, /AI 服务未配置/);

    const analysis = await request('/api/ws/analyses', { method: 'POST', body: JSON.stringify({ conversationId: conversationBody.id, result: { summary: '咨询产品', intent: '高意向', intentScore: 90, urgency: '高', nextStep: '今天联系客户确认预算', followupTime: '2026-11-05', language: 'English', confidence: 0.8, contact: { name: '张三', phone: '+91 98765 43210' }, profile: { origin: '展会', age: 36, occupation: '采购经理' }, evidence: [{ field: 'age', value: 36, text: '我今年36岁' }] }, providerName: 'test', model: 'test-model' }) });
    assert.equal(analysis.status, 200);
    const analysisBody = await json(analysis);
    const initializeCrm = await request('/api/state', { method: 'POST', headers: { 'x-state-version': '' }, body: JSON.stringify({ schemaVersion: 4, customers: [], savedViews: [], activities: [], tickets: [], deposits: [], followups: [], registrations: [], phoneRegistry: [], batchOperations: [], settings: { operatingTasks: [] }, channelAliases: {}, importIssues: [], qualityDecisions: {} }) });
    assert.equal(initializeCrm.status, 200);
    const staleCrmSync = await request('/api/ws/crm-sync', { method: 'POST', headers: { 'x-state-version': 'stale-version' }, body: JSON.stringify({ conversationId: conversationBody.id, analysisId: analysisBody.id }) });
    assert.equal(staleCrmSync.status, 409, 'WS AI 同步必须拒绝过期数据版本');
    const crmSync = await json(await request('/api/ws/crm-sync', { method: 'POST', body: JSON.stringify({ conversationId: conversationBody.id, analysisId: analysisBody.id }) }));
    assert.equal(crmSync.ok, true);
    assert.equal(crmSync.created, true);
    assert.equal(crmSync.followup.aiGenerated, true);
    assert.equal(crmSync.customer.origin, '展会');
    assert.equal(crmSync.customer.age, 36);
    assert.equal(crmSync.customer.occupation, '采购经理');
    assert.ok(crmSync.updatedFields.includes('age'));
    assert.ok(crmSync.task && crmSync.task.aiGenerated);
    const repeatedCrmSync = await json(await request('/api/ws/crm-sync', { method: 'POST', body: JSON.stringify({ conversationId: conversationBody.id, analysisId: crmSync.followup.wsAnalysisId }) }));
    assert.equal(repeatedCrmSync.ok, true);
    assert.equal(repeatedCrmSync.duplicate, true, '重复同步同一分析不会重复创建跟进记录');
    const crmState = await json(await request('/api/state'));
    assert.equal(crmState.customers.length, 1, 'AI 同步按 WS 会话只创建一个客户');
    assert.equal(crmState.followups.length, 1, 'AI 同步按分析幂等创建一个跟进');
    assert.equal(crmState.settings.operatingTasks.length, 1, 'AI 同步创建一个待跟进任务');


    const analysisList = await json(await request(`/api/ws/analyses?conversationId=${encodeURIComponent(conversationBody.id)}&limit=1&offset=0`));
    assert.equal(analysisList.total, 1);
    assert.equal(analysisList.analysis.result.summary, '咨询产品');
    const preservedAnalysisItem = await json(await request('/api/ws/collection-items', { method: 'PATCH', body: JSON.stringify({ runId: collectionRun.run.id, conversationId: conversationBody.id, status: 'completed', analysisStatus: 'pending', checkpoint: '3' }) }));
    assert.equal(preservedAnalysisItem.item.analysisStatus, 'completed', 'unchanged preview refresh keeps a successful AI analysis completed');
    const conversations = await json(await request('/api/ws/conversations'));
    const refreshedConversation = conversations.conversations.find(item => item.id === conversationBody.id);
    assert.equal(refreshedConversation.intentLevel, '高意向');
    assert.equal(refreshedConversation.language, 'English');
    assert.ok(refreshedConversation.lastMessageAt);
    assert.equal(refreshedConversation.unreadCount, 4);

    const firstAlerts = await json(await request('/api/ws/followup-alerts?limit=8'));
    assert.equal(firstAlerts.alerts.length, 1);
    assert.equal(firstAlerts.alerts[0].conversationId, conversationBody.id);
    assert.equal(firstAlerts.alerts[0].priority, 'urgent');
    assert.match(firstAlerts.alerts[0].reason, /高意向/);
    assert.ok(firstAlerts.alerts[0].alertKey);
    assert.ok(firstAlerts.alerts[0].analysisId);

    const alertId = firstAlerts.alerts[0].id;
    const snoozedAlert = await json(await request('/api/ws/followup-alerts', { method: 'PATCH', body: JSON.stringify({ id: alertId, status: 'snoozed', snoozedUntil: '2099-01-01T00:00:00.000Z' }) }));
    assert.equal(snoozedAlert.alert.status, 'snoozed');
    assert.equal((await json(await request('/api/ws/followup-alerts?limit=8'))).alerts.length, 0, '已延后的提醒在到期前不应再次出现');
    const reopenedAlert = await json(await request('/api/ws/followup-alerts', { method: 'PATCH', body: JSON.stringify({ id: alertId, status: 'open', snoozedUntil: '' }) }));
    assert.equal(reopenedAlert.alert.status, 'open');
    assert.equal((await json(await request('/api/ws/followup-alerts?limit=8'))).alerts.length, 1);

    await wait(5);
    const newerAnalysis = await request('/api/ws/analyses', { method: 'POST', body: JSON.stringify({ conversationId: conversationBody.id, result: { summary: '客户暂时不考虑', intent: '低意向', intentScore: 10, urgency: '低', nextStep: '一个月后再联系', followupTime: '2099-01-01', language: 'English', confidence: 0.9 }, providerName: 'test', model: 'test-model' }) });
    assert.equal(newerAnalysis.status, 200);
    const alertsAfterNewerAnalysis = await json(await request('/api/ws/followup-alerts?limit=8'));
    assert.equal(alertsAfterNewerAnalysis.alerts.length, 0, '同一会话只应采用最新分析，不能保留旧的紧急提醒');

    const replyPayload = { conversationId: conversationBody.id, originalText: 'Thank you', translatedText: '谢谢', status: 'copied', idempotencyKey: 'reply-copy-001' };
    const reply = await json(await request('/api/ws/replies', { method: 'POST', body: JSON.stringify(replyPayload) }));
    const repeatedReply = await json(await request('/api/ws/replies', { method: 'POST', body: JSON.stringify(replyPayload) }));
    assert.equal(repeatedReply.id, reply.id);
    assert.equal(repeatedReply.existed, true);
    const replies = await json(await request(`/api/ws/replies?conversationId=${encodeURIComponent(conversationBody.id)}`));
    assert.equal(replies.total, 1);
    assert.equal(replies.replies[0].idempotencyKey, 'reply-copy-001');

    const diagnostics = await json(await request('/api/ws/diagnostics'));
    assert.ok(diagnostics.schemaVersion >= 7);
    assert.equal(diagnostics.counts.messages, 3);
    assert.equal(diagnostics.counts.batches, 1);

    const exportedBody = await json(await request('/api/ws/export'));
    assert.equal(exportedBody.schemaVersion, 6);
    assert.equal(exportedBody.messages.length, 3);
    assert.equal(exportedBody.batches.length, 1);
    assert.equal(exportedBody.settings[0].sendLanguage, 'English');

    const imported = await request('/api/ws/import', { method: 'POST', body: JSON.stringify(exportedBody) });
    assert.equal(imported.status, 200);
    const importResult = await json(imported);
    assert.equal(importResult.schemaVersion, 6);
    assert.deepEqual(importResult.counts, { settings: 1, conversations: 1, messages: 3, analyses: 2, replies: 1, batches: 1 });

    const v5 = JSON.parse(JSON.stringify(exportedBody));
    v5.schemaVersion = 5;
    delete v5.batches;
    for (const item of v5.settings) delete item.sendLanguage;
    for (const item of v5.conversations) { delete item.lastMessageAt; delete item.unreadCount; delete item.language; }
    for (const item of v5.messages) { delete item.translationStatus; delete item.translationError; delete item.translationAttempts; delete item.lastAttemptAt; }
    for (const item of v5.replies) delete item.idempotencyKey;
    const v5Imported = await request('/api/ws/import', { method: 'POST', body: JSON.stringify(v5) });
    assert.equal(v5Imported.status, 200);
    const afterV5 = await json(await request('/api/ws/diagnostics'));
    assert.equal(afterV5.counts.messages, 3);
    assert.equal(afterV5.counts.batches, 0);

    // 同一 WS 登录账号下的另一联系人必须创建独立客户，不能因 wsAccountId 相同而合并。
    const secondConversation = await json(await request('/api/ws/conversations', { method: 'POST', body: JSON.stringify({ externalId: 'wa-002', title: '李四', customerId: '', language: 'English' }) }));
    const secondAnalysisResponse = await request('/api/ws/analyses', { method: 'POST', body: JSON.stringify({ conversationId: secondConversation.id, result: { summary: '另一位客户咨询', intent: '高意向', intentScore: 85, urgency: '中', nextStep: '明天联系确认', followupTime: '2026-11-06', language: 'English', confidence: 0.9 }, providerName: 'test', model: 'test-model' }) });
    assert.equal(secondAnalysisResponse.status, 200);
    const secondAnalysis = await json(secondAnalysisResponse);
    const secondCrmSync = await json(await request('/api/ws/crm-sync', { method: 'POST', body: JSON.stringify({ conversationId: secondConversation.id, analysisId: secondAnalysis.id }) }));
    assert.equal(secondCrmSync.created, true);
    const crmStateAfterSecond = await json(await request('/api/state'));
    assert.equal(crmStateAfterSecond.customers.length, 2, '同一 WS 登录账号下的不同联系人不得合并为一个客户');
    assert.notEqual(crmStateAfterSecond.customers[0].id, crmStateAfterSecond.customers[1].id);
    const wsConversationsAfterSecond = await json(await request('/api/ws/conversations'));
    const firstLinked = wsConversationsAfterSecond.conversations.find(item => item.id === conversationBody.id);
    const secondLinked = wsConversationsAfterSecond.conversations.find(item => item.id === secondConversation.id);
    assert.ok(firstLinked.customerId && secondLinked.customerId);
    assert.notEqual(firstLinked.customerId, secondLinked.customerId, '不同 WS 联系人应关联不同客户');

    const invalidShape = await request('/api/ws/import', { method: 'POST', body: JSON.stringify({ schemaVersion: 6, conversations: {} }) });
    assert.equal(invalidShape.status, 400);
    const tooMany = await request('/api/ws/import', { method: 'POST', body: JSON.stringify({ schemaVersion: 6, settings: Array.from({ length: 5001 }, () => ({})), conversations: [] }) });
    assert.equal(tooMany.status, 413);

    console.log('ws-workbench-api: pass');
  } finally {
    try { await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { ...headers, 'x-zhike-shutdown-token': token } }); } catch {}
    if (child.exitCode === null) child.kill();
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
