'use strict';

// TDD contract for WS media staging and attachment-aware broadcast plans.
// The media bytes are staged once and referenced by id; broadcast never accepts
// inline base64 payloads so the native bridge can send the exact same asset to
// every selected conversation.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const app = path.join(repo, 'resources', 'app');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-ws-media-'));
const port = 4498;
const token = 'ws-media-test-token';
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
async function json(response) { return response.json(); }
async function stop() {
  try { await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { ...headers, 'x-zhike-shutdown-token': token } }); } catch {}
  await new Promise(resolve => child.once('exit', resolve));
  rmSync(dataDir, { recursive: true, force: true });
}

(async () => {
  try {
    const account = await request('/api/ws/accounts', {
      method: 'POST',
      body: JSON.stringify({ id: 'media-other', displayName: 'Other account' }),
    });
    assert.equal(account.status, 201);

    const first = await json(await request('/api/ws/conversations', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'default', externalId: 'wa-media-a', title: '客户 A', conversationType: 'direct', data: { conversationType: 'direct' } }),
    }));
    const second = await json(await request('/api/ws/conversations', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'default', externalId: 'wa-media-b', title: '客户 B', conversationType: 'direct', data: { conversationType: 'direct' } }),
    }));

    const bytes = Buffer.from('media-staging-contract');
    const upload = await request('/api/ws/media', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'default', fileName: 'contract.txt', mimeType: 'text/plain', dataBase64: bytes.toString('base64') }),
    });
    assert.equal(upload.status, 201, 'media staging endpoint should accept a validated base64 asset');
    const uploadBody = await json(upload);
    assert.ok(uploadBody.media?.id || uploadBody.mediaId);
    const media = uploadBody.media || uploadBody;
    assert.equal(media.fileName, 'contract.txt');
    assert.equal(media.mimeType, 'text/plain');
    assert.equal(media.sizeBytes, bytes.length);
    assert.equal(media.status, 'ready');
    assert.match(media.sha256, /^[a-f0-9]{64}$/);

    const download = await request(`/api/ws/media/${encodeURIComponent(media.id)}?accountId=default`, { method: 'GET', headers: {} });
    assert.equal(download.status, 200, 'media should be downloadable for its owning account');
    assert.equal(await download.text(), bytes.toString());
    assert.equal(download.headers.get('content-type'), 'text/plain');

    const crossAccount = await request(`/api/ws/media/${encodeURIComponent(media.id)}?accountId=media-other`, { method: 'GET', headers: {} });
    assert.equal(crossAccount.status, 404, 'media must not be readable across WS accounts');

    const planned = await request('/api/ws/broadcast', {
      method: 'POST',
      body: JSON.stringify({
        accountId: 'default',
        conversationIds: [first.id, second.id],
        payloadKind: 'document',
        caption: '请查收文件',
        originalText: '请查收文件',
        attachments: [{ mediaId: media.id }],
        targetLanguage: 'English',
        confirm: true,
        idempotencyKey: 'media-broadcast-001',
      }),
    });
    assert.equal(planned.status, 201, 'broadcast should persist attachment-aware send plans');
    const plannedBody = await json(planned);
    assert.equal(plannedBody.dispatch.items.length, 2);
    assert.ok(plannedBody.dispatch.items.every(item => item.payloadKind === 'document'));
    assert.ok(plannedBody.dispatch.items.every(item => item.caption === '请查收文件'));
    assert.ok(plannedBody.dispatch.items.every(item => item.attachments?.[0]?.mediaId === media.id));

    const repeated = await request('/api/ws/broadcast', {
      method: 'POST',
      body: JSON.stringify({
        accountId: 'default', conversationIds: [first.id, second.id], payloadKind: 'document', caption: '请查收文件',
        attachments: [{ mediaId: media.id }], targetLanguage: 'English', confirm: true, idempotencyKey: 'media-broadcast-001',
      }),
    });
    assert.equal(repeated.status, 200, 'attachment-aware broadcast must be idempotent');
    assert.equal((await json(repeated)).existed, true);

    const blockedDelete = await request(`/api/ws/media/${encodeURIComponent(media.id)}?accountId=default`, { method: 'DELETE' });
    assert.equal(blockedDelete.status, 409, 'a media asset referenced by a send audit must not be deleted');

    const invalid = await request('/api/ws/media', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'default', fileName: '../unsafe.bin', mimeType: 'application/x-msdownload', dataBase64: Buffer.from('x').toString('base64') }),
    });
    assert.ok([400, 415, 422].includes(invalid.status), 'unsupported MIME/path must be rejected before persistence');

    console.log('ws-media-api: staging, account isolation, raw download, attachment broadcast, idempotency and deletion guard contracts pass');
  } finally {
    await stop();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
