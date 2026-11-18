'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const app = path.join(__dirname, '..', 'resources', 'app');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-ws-export-complete-'));
const port = 4598;
const token = 'ws-export-complete-token';
const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
  cwd: app,
  windowsHide: true,
  env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token },
  stdio: 'ignore',
});
const headers = { 'content-type': 'application/json', 'x-zhike-api-token': token, origin: `http://127.0.0.1:${port}` };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(pathname, init = {}) {
  for (let attempt = 0; attempt < 300; attempt++) {
    try { return await fetch(`http://127.0.0.1:${port}${pathname}`, { ...init, headers: { ...headers, ...(init.headers || {}) } }); }
    catch { await wait(40); }
  }
  throw new Error('export complete server did not become available');
}
const body = value => JSON.stringify(value);
async function stateVersion() { return (await (await request('/api/state/version')).json()).version; }

(async () => {
  try {
    assert.equal((await request('/api/health')).status, 200);
    assert.equal((await request('/api/ws/accounts', { method: 'POST', body: body({ id: 'account-two', displayName: '第二账号' }) })).status, 201);
    const version = await stateVersion();
    const stateResponse = await request('/api/state', {
      method: 'POST',
      headers: { 'x-state-version': version },
      body: body({
        schemaVersion: 4,
        customers: [{ id: 'CRM-001', name: '导出客户', phone: '9876543210', rawPhone: '+91 9876543210', source: 'WS', deleted: false }],
        savedViews: [], activities: [], tickets: [], deposits: [], followups: [], registrations: [], phoneRegistry: [], batchOperations: [],
        settings: { operatingTasks: [] }, channelAliases: {}, importIssues: [], qualityDecisions: {},
      }),
    });
    assert.equal(stateResponse.status, 200);
    const conversation = await request('/api/ws/conversations', { method: 'POST', body: body({ accountId: 'default', externalId: 'contact-001', title: '导出客户', customerId: 'CRM-001', conversationType: 'direct', unreadCount: 0, data: { historyLoaded: true } }) });
    assert.equal(conversation.status, 200);
    const conversationBody = await conversation.json();
    assert.equal((await request('/api/ws/messages', { method: 'POST', body: body({ accountId: 'default', conversationId: conversationBody.id, externalId: 'message-001', direction: 'receive', originalText: '完整导出测试', order: 1 }) })).status, 200);
    const single = await request('/api/ws/export?accountId=default');
    assert.equal(single.status, 200);
    const singleBody = await single.json();
    for (const key of ['contacts', 'groups', 'groupMembershipEvents', 'conversations', 'messages', 'analyses', 'replies', 'followupAlerts', 'sendAudit', 'mediaAssets', 'crmState', 'manifest']) assert.ok(Object.hasOwn(singleBody, key), `single export must include ${key}`);
    assert.equal(singleBody.contacts.length, 1);
    assert.equal(singleBody.messages.length, 1);
    assert.equal(singleBody.crmState.customers[0].id, 'CRM-001');
    assert.equal(singleBody.manifest.scope, 'account');

    const secondConversation = await request('/api/ws/conversations', { method: 'POST', body: body({ accountId: 'account-two', externalId: 'contact-002', title: '第二账号联系人', conversationType: 'direct', unreadCount: 0 }) });
    assert.equal(secondConversation.status, 200);
    const all = await request('/api/ws/export?allAccounts=1');
    assert.equal(all.status, 200);
    const allBody = await all.json();
    assert.equal(allBody.manifest.scope, 'all');
    assert.deepEqual(new Set(allBody.manifest.accountIds), new Set(['default', 'account-two']));
    assert.equal(allBody.conversations.length, 2);
    assert.equal(allBody.contacts.length, 2);

    const createdJob = await request('/api/ws/export-jobs', { method: 'POST', body: body({ accountId: 'default' }) });
    assert.ok([201, 202].includes(createdJob.status), 'export job must be accepted');
    const jobBody = await createdJob.json();
    assert.ok(jobBody.job?.id);
    let status;
    for (let attempt = 0; attempt < 50; attempt++) {
      status = await (await request(`/api/ws/export-jobs/${encodeURIComponent(jobBody.job.id)}`)).json();
      if (['completed', 'failed', 'cancelled'].includes(status.job?.status)) break;
      await wait(40);
    }
    assert.equal(status.job.status, 'completed', status.job.errorMessage || 'export job must complete');
    assert.ok(status.job.outputPath || status.job.downloadUrl, 'completed export job must expose a bounded local output');
    console.log('ws-export-complete: pass');
  } finally {
    try { await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { ...headers, 'x-zhike-shutdown-token': token } }); } catch {}
    if (child.exitCode === null) child.kill();
    await wait(100);
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
