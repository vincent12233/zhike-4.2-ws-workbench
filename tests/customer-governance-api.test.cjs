const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const app = path.join(__dirname, '..', 'resources', 'app');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-governance-api-'));
const port = 4472;
const token = 'governance-api-test-token';
const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], { cwd: app, windowsHide: true, env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token }, stdio: 'ignore' });
const headers = { 'content-type': 'application/json', 'x-zhike-api-token': token, origin: `http://127.0.0.1:${port}` };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(pathname, init = {}) {
  for (let i = 0; i < 300; i++) {
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
const json = response => response.json();
(async () => {
  try {
    const initial = { schemaVersion: 4, customers: [
      { id: 'C1', name: '张三', phone: '9876543210', source: 'WhatsApp', status: '未进群', phase: '新客户', deleted: false },
      { id: 'C2', name: '李四', phone: '9876543211', source: '单导', status: '未进群', phase: '新客户', deleted: false },
    ], savedViews: [], activities: [], tickets: [], deposits: [], followups: [], registrations: [], phoneRegistry: [], batchOperations: [], settings: { operatingTasks: [] }, channelAliases: {}, importIssues: [], qualityDecisions: {} };
    const state = await request('/api/state', { method: 'POST', headers: { ...headers, 'x-state-version': '' }, body: JSON.stringify(initial) });
    assert.equal(state.status, 200);

    const conversation = await json(await request('/api/ws/conversations', { method: 'POST', body: JSON.stringify({ externalId: '+91 98765 43210', title: '张三' }) }));
    const analysis = await json(await request('/api/ws/analyses', { method: 'POST', body: JSON.stringify({ conversationId: conversation.id, result: { summary: '客户来自展会', confidence: 0.95, contact: { name: '张三', phone: '+91 98765 43210' }, profile: { origin: '展会', age: 36, occupation: '采购经理' }, evidence: [{ field: 'age', value: 36, text: '我今年36岁' }] } }) }));
    const synced = await json(await request('/api/ws/crm-sync', { method: 'POST', body: JSON.stringify({ conversationId: conversation.id, analysisId: analysis.id }) }));
    assert.equal(synced.customer.id, 'C1');

    const profile = await json(await request('/api/data-governance/customers/C1/profile'));
    assert.equal(profile.customer.id, 'C1');
    assert.ok(profile.evidence.some(item => item.fieldName === 'age'));

    const malformedConversation = await json(await request('/api/ws/conversations', { method: 'POST', body: JSON.stringify({ externalId: 'wa-malformed', title: '未命名会话' }) }));
    const malformedAnalysis = await json(await request('/api/ws/analyses', { method: 'POST', body: JSON.stringify({ conversationId: malformedConversation.id, result: { confidence: 0.99, summary: '只有摘要，没有可验证客户字段' } }) }));
    const malformedSync = await json(await request('/api/ws/crm-sync', { method: 'POST', body: JSON.stringify({ conversationId: malformedConversation.id, analysisId: malformedAnalysis.id }) }));
    assert.equal(malformedSync.skipped, true, '格式不完整的 AI 结果不应自动建档');

    const stale = await request('/api/data-governance/customers/C2/soft-delete', { method: 'POST', headers: { 'x-state-version': 'stale-version' }, body: JSON.stringify({ reason: '冲突测试' }) });
    assert.equal(stale.status, 409, '治理写入必须拒绝过期版本');

    const soft = await json(await request('/api/data-governance/customers/C1/soft-delete', { method: 'POST', body: JSON.stringify({ reason: '测试软删除', source: 'test' }) }));
    assert.equal(soft.ok, true);
    assert.equal(soft.customer.deleted, true);
    const audit = await json(await request('/api/data-governance/audit?customerId=C1'));
    assert.ok(audit.actions.some(item => item.action === 'soft_delete'));

    const restored = await json(await request('/api/data-governance/customers/C1/restore', { method: 'POST', body: JSON.stringify({ reason: '测试恢复' }) }));
    assert.equal(restored.customer.deleted, false);

    const batch = await json(await request('/api/data-governance/customers/batch-soft-delete', { method: 'POST', body: JSON.stringify({ customerIds: ['C1', 'C2'], reason: '批量测试' }) }));
    assert.equal(batch.count, 2);

    const purgeRequest = await json(await request('/api/data-governance/customers/C1/purge-request', { method: 'POST', body: JSON.stringify({ reason: '测试永久删除' }) }));
    assert.ok(purgeRequest.confirmationToken);
    const rejected = await request('/api/data-governance/customers/C1/purge-confirm', { method: 'POST', body: JSON.stringify({ confirmationToken: 'wrong-token' }) });
    assert.equal(rejected.status, 409);
    const purged = await json(await request('/api/data-governance/customers/C1/purge-confirm', { method: 'POST', body: JSON.stringify({ confirmationToken: purgeRequest.confirmationToken }) }));
    assert.equal(purged.ok, true);
    const repeated = await request('/api/data-governance/customers/C1/purge-confirm', { method: 'POST', body: JSON.stringify({ confirmationToken: purgeRequest.confirmationToken }) });
    assert.equal(repeated.status, 409);

    const expiredRequest = await json(await request('/api/data-governance/customers/C2/purge-request', { method: 'POST', body: JSON.stringify({ reason: '过期令牌测试' }) }));
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'));
    db.prepare("UPDATE customer_delete_requests SET requested_at=? WHERE customer_id='C2' AND status='pending'").run(new Date(Date.now() - 901000).toISOString());
    db.close();
    const expired = await request('/api/data-governance/customers/C2/purge-confirm', { method: 'POST', body: JSON.stringify({ confirmationToken: expiredRequest.confirmationToken }) });
    assert.equal(expired.status, 409, '永久删除令牌必须在 15 分钟后失效');
    const finalState = await json(await request('/api/state'));
    assert.equal(finalState.customers.some(item => item.id === 'C1'), false);

    console.log('customer governance api: profile, soft-delete, restore, batch delete, audit and one-time purge passed');
  } finally {
    try { await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { ...headers, 'x-zhike-shutdown-token': token } }); } catch {}
    if (child.exitCode === null) child.kill();
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
