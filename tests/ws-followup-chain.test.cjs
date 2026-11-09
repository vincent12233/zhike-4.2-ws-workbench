'use strict';

// Isolated local SQLite regression for the WS analysis → CRM → task/home
// reminder chain. It uses a temporary data directory and never opens the
// user's real workspace database.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const app = path.join(__dirname, '..', 'resources', 'app');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-followup-chain-'));
const port = 4477;
const token = 'followup-chain-test-token';
const child = spawn(process.execPath, ['server.mjs'], {
  cwd: app,
  windowsHide: true,
  env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token },
  stdio: 'ignore',
});
const headers = { 'content-type': 'application/json', 'x-zhike-api-token': token, origin: `http://127.0.0.1:${port}` };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(pathname, init = {}) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      const nextHeaders = { ...headers, ...(init.headers || {}) };
      if (String(init.method || 'GET').toUpperCase() !== 'GET' && pathname !== '/api/state' && !Object.keys(nextHeaders).some(key => key.toLowerCase() === 'x-state-version')) {
        const version = await fetch(`http://127.0.0.1:${port}/api/state/version`, { headers }).then(response => response.json());
        nextHeaders['x-state-version'] = String(version.version || '');
      }
      return await fetch(`http://127.0.0.1:${port}${pathname}`, { ...init, headers: nextHeaders });
    } catch { await wait(50); }
  }
  throw new Error('isolated follow-up chain server did not become available');
}
const json = response => response.json();
const analysis = (summary, followupTime, extra = {}) => ({
  summary,
  intent: '高意向',
  intentScore: 90,
  urgency: '高',
  language: 'English',
  nextStep: '确认预算并发送报价',
  followupTime,
  confidence: 0.92,
  contact: { name: '测试客户', phone: '+91 98765 43210' },
  profile: { origin: 'WS 测试' },
  ...extra,
});

(async () => {
  try {
    await wait(800);
    const conversation = await json(await request('/api/ws/conversations', { method: 'POST', body: JSON.stringify({ externalId: 'chain-test-contact', title: '链路测试客户' }) }));
    const initial = await request('/api/state', { method: 'POST', headers: { ...headers, 'x-state-version': '' }, body: JSON.stringify({ schemaVersion: 4, customers: [], savedViews: [], activities: [], tickets: [], deposits: [], followups: [], registrations: [], phoneRegistry: [], batchOperations: [], settings: { operatingTasks: [] }, channelAliases: {}, importIssues: [], qualityDecisions: {} }) });
    assert.equal(initial.status, 200);

    const first = await json(await request('/api/ws/analyses', { method: 'POST', body: JSON.stringify({ conversationId: conversation.id, result: analysis('第一次分析', '2099-01-01') }) }));
    const firstSync = await json(await request('/api/ws/crm-sync', { method: 'POST', body: JSON.stringify({ conversationId: conversation.id, analysisId: first.id }) }));
    assert.equal(firstSync.ok, true);
    assert.equal(firstSync.followup.aiGenerated, true);

    // A newer analysis is a new decision, but must update the one active task
    // rather than create a second open reminder for the same conversation.
    const second = await json(await request('/api/ws/analyses', { method: 'POST', body: JSON.stringify({ conversationId: conversation.id, result: analysis('第二次分析', '2099-01-02') }) }));
    const secondSync = await json(await request('/api/ws/crm-sync', { method: 'POST', body: JSON.stringify({ conversationId: conversation.id, analysisId: second.id }) }));
    assert.equal(secondSync.ok, true);
    const state = await json(await request('/api/state'));
    const activeFollowups = (state.followups || []).filter(item => String(item.wsConversationId || '') === String(conversation.id) && !item.done && item.status !== 'dismissed');
    const activeTasks = (state.settings?.operatingTasks || []).filter(item => String(item.wsConversationId || '') === String(conversation.id) && !item.done);
    assert.equal(activeFollowups.length, 1, 'repeated WS analyses must not create duplicate active follow-up records');
    assert.equal(activeTasks.length, 1, 'repeated WS analyses must keep one active task-center reminder');
    assert.equal(activeTasks[0].due, '2099-01-02', 'newer analysis should refresh the active task date');

    // A no-reply result is cooled down to the model-suggested date and also
    // reuses the same active task instead of firing on every poll.
    const quiet = await json(await request('/api/ws/analyses', { method: 'POST', body: JSON.stringify({ conversationId: conversation.id, result: analysis('暂未回复', '2099-01-03', { noReply: { noReply: true, reason: '客户正在忙', suggestedAt: '2099-01-03', cooldownDays: 3 }, nextStep: '' }) }) }));
    await json(await request('/api/ws/crm-sync', { method: 'POST', body: JSON.stringify({ conversationId: conversation.id, analysisId: quiet.id }) }));
    const afterQuiet = await json(await request('/api/state'));
    const quietTasks = (afterQuiet.settings?.operatingTasks || []).filter(item => String(item.wsConversationId || '') === String(conversation.id) && !item.done);
    assert.equal(quietTasks.length, 1, 'no-reply cooldown must not multiply active tasks');
    assert.equal(quietTasks[0].due, '2099-01-03');

    const alerts = await json(await request('/api/ws/followup-alerts?limit=8'));
    assert.equal(alerts.alerts.length, 1, 'one conversation must expose one current alert');
    assert.equal(alerts.alerts[0].conversationId, conversation.id);
    console.log('ws-followup-chain: isolated repeated-analysis dedupe, no-reply cooldown and current-alert refresh pass');
  } finally {
    try { await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { ...headers, 'x-zhike-shutdown-token': token } }); } catch {}
    await wait(100);
    child.kill();
    await wait(100);
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
})();
