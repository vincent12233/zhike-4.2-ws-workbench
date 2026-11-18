'use strict';

// TDD contract for the local-first WS translation/send path.  This test is
// intentionally written before the implementation: it should fail until the
// sidecar exposes durable translation persistence, account-scoped broadcast
// planning, idempotent send acknowledgements and an audit trail.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const app = path.join(repo, 'resources', 'app');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-ws-broadcast-'));
const port = 4497;
const token = 'ws-broadcast-test-token';
const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
  cwd: app,
  windowsHide: true,
  env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token },
  stdio: 'ignore',
});
const headers = { 'content-type': 'application/json', 'x-zhike-api-token': token, origin: `http://127.0.0.1:${port}` };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(pathname, init = {}) {
  for (let i = 0; i < 240; i += 1) {
    try {
      return await fetch(`http://127.0.0.1:${port}${pathname}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    } catch {
      await wait(50);
    }
  }
  throw new Error('isolated server did not become available');
}
async function body(response) { return response.json(); }
async function stop() {
  try { await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { ...headers, 'x-zhike-shutdown-token': token } }); } catch {}
  await new Promise(resolve => child.once('exit', resolve));
  rmSync(dataDir, { recursive: true, force: true });
}

(async () => {
  try {
    const first = await body(await request('/api/ws/conversations', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'default', externalId: 'wa-send-a', title: '客户 A', conversationType: 'direct', data: { conversationType: 'direct' } }),
    }));
    const second = await body(await request('/api/ws/conversations', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'default', externalId: 'wa-send-b', title: '客户 B', conversationType: 'direct', data: { conversationType: 'direct' } }),
    }));

    const message = await request('/api/ws/messages', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'default', conversationId: first.id, externalId: 'translate-1', direction: 'receive', originalText: 'Hello from A', order: 1 }),
    });
    assert.equal(message.status, 200);
    const messageBody = await body(message);
    const translated = await request('/api/ws/messages/translate', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'default', messageId: messageBody.id, translatedText: '来自 A 的问候', targetLanguage: '中文' }),
    });
    assert.equal(translated.status, 200, 'translation persistence endpoint should be available');
    const translatedBody = await body(translated);
    assert.equal(translatedBody.originalText, 'Hello from A', 'translation must never overwrite original text');
    assert.equal(translatedBody.translatedText, '来自 A 的问候');

    const missingConfirm = await request('/api/ws/broadcast', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'default', conversationIds: [first.id, second.id], originalText: '统一通知', confirm: false, idempotencyKey: 'broadcast-confirm-required' }),
    });
    assert.equal(missingConfirm.status, 400, 'broadcast must require explicit user confirmation');

    const crossAccount = await request('/api/ws/broadcast', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'default', conversationIds: [first.id, 'conversation-from-other-account'], originalText: '不应跨账号发送', confirm: true, idempotencyKey: 'broadcast-isolation' }),
    });
    assert.ok([404, 409, 422].includes(crossAccount.status), 'broadcast must reject unknown/cross-account conversations');

    const planned = await request('/api/ws/broadcast', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'default', conversationIds: [first.id, second.id], originalText: '统一通知', translatedText: 'Broadcast', targetLanguage: 'English', confirm: true, idempotencyKey: 'broadcast-001' }),
    });
    assert.equal(planned.status, 201, 'confirmed broadcast should create a durable dispatch plan');
    const plannedBody = await body(planned);
    assert.ok(plannedBody.dispatch?.batchId);
    assert.equal(plannedBody.dispatch.items.length, 2);
    assert.ok(plannedBody.dispatch.items.every(item => item.status === 'queued'));
    assert.equal(plannedBody.dispatch.requiresNativeBridge, true);

    const repeated = await request('/api/ws/broadcast', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'default', conversationIds: [first.id, second.id], originalText: '统一通知', translatedText: 'Broadcast', targetLanguage: 'English', confirm: true, idempotencyKey: 'broadcast-001' }),
    });
    assert.equal(repeated.status, 200, 'same idempotency key must not create duplicate send rows');
    const repeatedBody = await body(repeated);
    assert.equal(repeatedBody.existed, true);
    assert.equal(repeatedBody.dispatch.batchId, plannedBody.dispatch.batchId);

    const sent = await request('/api/ws/send', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'default', auditId: plannedBody.dispatch.items[0].id, status: 'sent', nativeConfirmed: true, nativeResult: { method: 'dom-composer' } }),
    });
    assert.equal(sent.status, 200, 'native bridge acknowledgement should finalize one recipient');
    const sentBody = await body(sent);
    assert.equal(sentBody.audit.status, 'sent');
    assert.equal(sentBody.audit.deliveryState, 'unknown', 'legacy nativeConfirmed without explicit native action evidence proves neither a local attempt nor a platform receipt');
    assert.equal(sentBody.audit.retryAllowed, false, 'uncertain external delivery must not be blindly repeated');
    assert.equal(sentBody.reply, null, 'a legacy boolean must not create a fabricated confirmed reply');

    const audit = await request(`/api/ws/send-audit?accountId=default&batchId=${encodeURIComponent(plannedBody.dispatch.batchId)}`);
    assert.equal(audit.status, 200);
    const auditBody = await body(audit);
    assert.equal(auditBody.items.length, 2);
    assert.equal(auditBody.items.filter(item => item.status === 'sent').length, 1);
    assert.ok(auditBody.items.every(item => item.accountId === 'default'), 'audit rows must be account scoped');

    const server = require('node:fs').readFileSync(path.join(app, 'server.mjs'), 'utf8');
    const host = require('node:fs').readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs'), 'utf8');
    assert.match(server, /WS_SEND_RATE_LIMIT|ws_send_audit|requiresNativeBridge/);
    assert.match(host, /send-text|broadcast-text|dom-composer/);
    console.log('ws-broadcast-translation: translation preservation, explicit broadcast confirmation, account isolation, rate limiting, native bridge and audit contracts pass');
  } finally {
    await stop();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

