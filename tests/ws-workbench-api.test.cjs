const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const app = path.join(__dirname, 'project-review', '知客 4.1 运营增强版', 'resources', 'app');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-ws-api-'));
const port = 4471;
const token = 'ws-api-test-token';
const child = spawn(path.join(app, 'node.exe'), ['server.mjs'], {
  cwd: app,
  windowsHide: true,
  env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token },
  stdio: 'ignore',
});
const headers = { 'content-type': 'application/json', 'x-zhike-api-token': token, origin: `http://127.0.0.1:${port}` };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(pathname, init = {}) {
  for (let i = 0; i < 120; i++) {
    try { return await fetch(`http://127.0.0.1:${port}${pathname}`, { ...init, headers: { ...headers, ...(init.headers || {}) } }); }
    catch { await wait(50); }
  }
  throw new Error('isolated server did not become available');
}
async function json(response) { return response.json(); }
(async () => {
  try {
    const settings = await request('/api/ws/settings?conversationId=conv-1', { method: 'PUT', body: JSON.stringify({ enabled: true, receive: true, send: false, targetLanguage: '中文' }) });
    assert.equal(settings.status, 200);
    const settingsBody = await json(settings);
    assert.equal(settingsBody.conversationId, 'conv-1');

    const conversation = await request('/api/ws/conversations', { method: 'POST', body: JSON.stringify({ externalId: 'wa-001', title: '张三', customerId: '' }) });
    assert.equal(conversation.status, 200);
    const conversationBody = await json(conversation);
    assert.ok(conversationBody.id);

    const first = await request('/api/ws/messages', { method: 'POST', body: JSON.stringify({ conversationId: conversationBody.id, externalId: 'msg-1', direction: 'receive', originalText: 'Hello', translatedText: '你好', order: 1 }) });
    const second = await request('/api/ws/messages', { method: 'POST', body: JSON.stringify({ conversationId: conversationBody.id, externalId: 'msg-1', direction: 'receive', originalText: 'Hello', translatedText: '你好', order: 1 }) });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal((await json(first)).id, (await json(second)).id);

    const messages = await request(`/api/ws/messages?conversationId=${encodeURIComponent(conversationBody.id)}`);
    assert.equal((await json(messages)).messages.length, 1);

    const analysis = await request('/api/ws/analyses', { method: 'POST', body: JSON.stringify({ conversationId: conversationBody.id, result: { summary: '咨询产品', confidence: 0.8 } }) });
    assert.equal(analysis.status, 200);
    const reply = await request('/api/ws/replies', { method: 'POST', body: JSON.stringify({ conversationId: conversationBody.id, originalText: 'Thank you', translatedText: '谢谢', status: 'draft' }) });
    assert.equal(reply.status, 200);
    const diagnostics = await request('/api/ws/diagnostics');
    assert.equal((await json(diagnostics)).counts.messages, 1);
    const exported = await request('/api/ws/export');
    const exportedBody = await json(exported);
    assert.equal(exportedBody.messages.length, 1);
    const imported = await request('/api/ws/import', { method: 'POST', body: JSON.stringify(exportedBody) });
    assert.equal(imported.status, 200);
    assert.equal((await json(await request('/api/ws/diagnostics'))).counts.messages, 1);
    console.log('ws-workbench-api: pass');
  } finally {
    try { await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { ...headers, 'x-zhike-shutdown-token': token } }); } catch {}
    if (child.exitCode === null) child.kill();
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
