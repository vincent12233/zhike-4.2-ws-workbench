const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const app = path.join(__dirname, '..', 'resources', 'app');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-ws-list-preview-'));
const port = 4478;
const token = 'ws-list-preview-test-token';
const child = spawn(process.execPath, ['server.mjs'], {
  cwd: app,
  windowsHide: true,
  env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token },
  stdio: 'ignore',
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const headers = { 'content-type': 'application/json', 'x-zhike-api-token': token, origin: `http://127.0.0.1:${port}` };
async function request(pathname, init = {}) {
  for (let i = 0; i < 120; i += 1) {
    try { return await fetch(`http://127.0.0.1:${port}${pathname}`, { ...init, headers: { ...headers, ...(init.headers || {}) } }); }
    catch { await wait(50); }
  }
  throw new Error('isolated server did not become available');
}
const json = response => response.json();
(async () => {
  try {
    const conversation = await json(await request('/api/ws/conversations', { method: 'POST', body: JSON.stringify({ externalId: 'wa-list-001', title: 'Airtel India' }) }));
    const first = await json(await request('/api/ws/messages/batch', { method: 'POST', body: JSON.stringify({
      conversationId: conversation.id,
      fingerprint: 'list-preview-old',
      messages: [{ externalId: 'list-preview-old', direction: 'receive', originalText: 'Airtel India', order: 1, data: { source: 'ws-list-preview', previewOnly: true, listText: 'Airtel India Important Update for Airtel mobile number' } }],
    }) }));
    assert.equal(first.inserted, 1);
    assert.equal(first.messages[0].originalText, 'Important Update for Airtel mobile number');
    const noisy = await json(await request('/api/ws/messages/batch', { method: 'POST', body: JSON.stringify({
      conversationId: conversation.id,
      fingerprint: 'list-preview-noisy',
      messages: [{ externalId: 'list-preview-noisy', direction: 'receive', originalText: 'As 1条未读消息 此聊天中的新消息将在发送90天后自动消失（除非消息已保留）。', order: 3, data: { source: 'ws-list-preview', previewOnly: true, listText: '1条未读消息 Vaishali Joshi. 凌晨2:06 As 此聊天中的新消息将在发送90天后自动消失（除非消息已保留）。' } }],
    }) }));
    assert.equal(noisy.inserted, 0);
    assert.equal(noisy.updated, 1);
    assert.equal(noisy.messages[0].originalText, 'As', 'server canonicalizes WhatsApp system markers before persistence');
    const second = await json(await request('/api/ws/messages/batch', { method: 'POST', body: JSON.stringify({
      conversationId: conversation.id,
      fingerprint: 'list-preview-new',
      messages: [{ externalId: 'list-preview-new', direction: 'receive', originalText: 'Airtel India', order: 2, data: { source: 'ws-list-preview', previewOnly: true, listText: 'Airtel India New offer details' } }],
    }) }));
    assert.equal(second.inserted, 0);
    assert.equal(second.updated, 1);
    assert.equal(second.messages[0].originalText, 'New offer details');
    const rows = await json(await request(`/api/ws/messages?conversationId=${encodeURIComponent(conversation.id)}`));
    assert.equal(rows.messages.length, 1, '列表预览更新不得重复写入消息');
    assert.equal(rows.messages[0].externalId, 'list-preview-new');
    assert.equal(rows.messages[0].originalText, 'New offer details');
    const conversations = await json(await request('/api/ws/conversations'));
    assert.equal(conversations.conversations.find(item => item.id === conversation.id).lastMessageText, 'New offer details');
    console.log('ws-list-preview-update: pass');
  } finally {
    try { await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { ...headers, 'x-zhike-shutdown-token': token } }); } catch {}
    if (child.exitCode === null) child.kill();
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
