'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const { mkdtempSync, rmSync } = require('node:fs');
const path = require('node:path');
const data = mkdtempSync(path.join(require('node:os').tmpdir(), 'zhike-original-'));
let port = 0;
let child = null;
const token = 'isolated-original-roundtrip';
const headers = { 'content-type': 'application/json', 'x-zhike-api-token': token };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function reserveFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const selected = typeof address === 'object' && address ? address.port : 0;
      probe.close(error => error ? reject(error) : resolve(selected));
    });
  });
}
async function api(route, body, expected = 200) {
  const version = await fetch(`http://127.0.0.1:${port}/api/state/version`, { headers }).then(r => r.json());
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { ...headers, 'x-state-version': version.version },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  assert.equal(response.status, expected, JSON.stringify(result));
  return result;
}
(async () => {
  try {
    port = await reserveFreePort();
    child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
      cwd: path.join(__dirname, '../resources/app'), windowsHide: true, stdio: 'ignore',
      env: { ...process.env, ZHIKE_DATA_DIR: data, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token },
    });
    let ready = false;
    for (let i = 0; i < 100; i++) { try { await api('/api/health'); ready = true; break; } catch { await wait(50); } }
    assert.equal(ready, true, 'isolated service must start');
    await api('/api/state', { customers: [{ id: 'C1', name: 'Existing', phone: '9990001111', deleted: false }], settings: { operatingTasks: [] }, tickets: [], deposits: [], followups: [], activities: [] });
    const conversation = await api('/api/ws/conversations', { externalId: 'original-roundtrip', title: 'Isolated', customerId: 'C1', bindingSource: 'manual' });
    const original = '  第一行\n' + 'long  text\n'.repeat(2200) + '\n最后一行  ';
    assert.ok(original.length > 20000);
    await api('/api/ws/ingest/batch', {
      accountId: 'default', checkpoints: [{ conversationType: 'direct', conversationKey: 'original-roundtrip', historyLoaded: true, historyMessageCount: 1, coverage: 'read-history', lastMessageFingerprint: 'original-1', unreadCount: 0, directionVersion: 4, directionUnresolvedCount: 0 }],
      messages: [{ conversationType: 'direct', conversationKey: 'original-roundtrip', externalMessageId: 'long-message', body: original, direction: 'incoming', directionSource: 'class-message-in', order: 1, sentAt: '2026-10-01T10:00:00Z' }],
    });
    let messages = await api(`/api/ws/messages?conversationId=${conversation.id}`);
    assert.equal(messages.total, 1);
    assert.equal(messages.messages[0].originalText, original, 'ingest and GET must preserve every character');
    const exported = await api('/api/ws/export');
    assert.equal(exported.messages[0].originalText, original, 'backup must preserve the complete original');
    await api('/api/ws/import', exported);
    messages = await api(`/api/ws/messages?conversationId=${conversation.id}`);
    assert.equal(messages.messages[0].originalText, original, 'restore must preserve whitespace and long originals');
    await api('/api/ws/messages', { conversationId: conversation.id, externalId: 'single-long', direction: 'send', originalText: original, order: 2 });
    const single = await api(`/api/ws/messages?conversationId=${conversation.id}`);
    assert.equal(single.messages.find(row => row.externalId === 'single-long').originalText, original);
    const overlong = 'x'.repeat(128001);
    await api('/api/ws/ingest/batch', { accountId: 'default', messages: [{ conversationType: 'direct', conversationKey: 'original-roundtrip', externalMessageId: 'too-long', body: overlong, direction: 'incoming' }] }, 413);
    await api('/api/ws/messages/batch', { conversationId: conversation.id, fingerprint: 'overlong', messages: [{ externalId: 'too-long-batch', originalText: overlong, direction: 'receive' }] }, 413);
    messages = await api(`/api/ws/messages?conversationId=${conversation.id}`);
    assert.equal(messages.total, 2, 'rejected messages must not leave partial or silently truncated records');
    assert.ok(messages.messages.every(row => row.originalText === original));
    const analysis = await api('/api/ws/analyses', { conversationId: conversation.id, result: {
      summary: 'Customer asked not to be contacted', confidence: 0.99, language: 'English', deletionSignal: 'do not contact', transcriptInfo: { directionVersion: 4 },
      profileFacts: { occupation: { value: 'Engineer', state: 'known', confidence: 0.99, evidence: 'I work as an engineer' } },
    } });
    const synced = await api('/api/ws/crm-sync', { conversationId: conversation.id, analysisId: analysis.id });
    assert.equal(synced.matched, true);
    assert.equal(synced.created, false);
    assert.equal(synced.softDeleted, false, 'WS enrichment must not delete an existing customer');
    const state = await api('/api/state');
    assert.equal(state.customers.length, 1);
    assert.equal(state.customers[0].deleted, false);
    assert.equal(state.customers[0].name, 'Existing', 'manual profile values remain protected');
    assert.equal(state.customers[0].occupation, 'Engineer', 'existing empty fields can still be enriched');
    console.log('WS original roundtrip: long text, whitespace, backup/restore and explicit oversized rejection passed');
  } finally {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    rmSync(data, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
