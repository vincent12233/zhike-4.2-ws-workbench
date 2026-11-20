'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '..', '..');
const { version } = require(path.join(repo, 'resources', 'app', 'package.json'));
const root = path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Services');
const currentIndex = fs.readFileSync(path.join(repo, 'docs', 'current-release-index.md'), 'utf8');

for (const file of ['DesktopBridgeService.cs', 'LegacyApiAdapter.cs', 'BridgeContracts.cs', 'LegacyBridgeScript.cs'])
  assert.equal(fs.existsSync(path.join(root, file)), true, `missing bridge service ${file}`);
assert.equal(currentIndex.match(/^\| 源码与安装版本 \| \*\*([^*]+)\*\*[^\r\n]*WinUI[^\r\n]*SQLite/im)?.[1], version,
  'bridge contract must be anchored to the current local release, not the retired compatibility document');

const bridge = fs.readFileSync(path.join(root, 'DesktopBridgeService.cs'), 'utf8');
assert.match(bridge, /InvokeAsync\(/);
assert.match(bridge, /Publish\(/);
assert.match(bridge, /redact|sensitive|secret/i);
const ai = fs.readFileSync(path.join(root, 'AiBridgeService.cs'), 'utf8');
assert.match(ai, /MaxResponseBytes/);
assert.match(ai, /ReadContentWithLimitAsync/);
assert.match(ai, /max_output_tokens/);
assert.match(ai, /AddOrUpdate/);
assert.match(ai, /ICollection<KeyValuePair/);
assert.match(ai, /DefaultProviderAttemptBudget\s*=\s*TimeSpan\.FromSeconds\(100\)/,
  'full-history AI analysis must have the confirmed 100 second provider attempt budget');
assert.doesNotMatch(ai, /catch\s*\(ProviderAttemptTimeoutException\)\s*when/,
  'a slow provider timeout must not blindly resubmit the same analysis request');

const adapter = fs.readFileSync(path.join(root, 'LegacyApiAdapter.cs'), 'utf8');
assert.match(adapter, /StartsWith\("\/api\/"/);
assert.match(adapter, /UNSUPPORTED/);
assert.match(adapter, /legacyPath/);
assert.match(adapter, /api\//);
assert.match(adapter, /StringComparison\.OrdinalIgnoreCase/);
assert.match(adapter, /snapshotCreated/);
assert.match(adapter, /BUSINESS_REJECTED/);
assert.match(adapter, /SNAPSHOT_NOT_CREATED/);
assert.doesNotMatch(adapter, /api\/v2\//, 'local adapter must not translate requests to a remote v2 API');

const bridgeScript = fs.readFileSync(path.join(root, 'LegacyBridgeScript.cs'), 'utf8');
const legacyHost = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs'), 'utf8');
assert.match(legacyHost, /requestId\s*=\s*response\.RequestId/,
  'bridge responses must serialize the lower camel-case requestId expected by the page');
assert.match(legacyHost, /bridgeVersion\s*=\s*response\.BridgeVersion/);
assert.match(legacyHost, /requestId\s*=\s*invalid\.RequestId/,
  'invalid bridge requests must also receive a matching lower camel-case response');
assert.match(bridgeScript, /DEFAULT_TIMEOUT_MS\s*=\s*15000/);
assert.match(bridgeScript, /WRITE_TIMEOUT_MS\s*=\s*120000/);
assert.match(bridgeScript, /SNAPSHOT_TIMEOUT_MS\s*=\s*300000/);
assert.match(bridgeScript, /AI_REQUEST_TIMEOUT_MS\s*=\s*115000/);
assert.match(bridgeScript, /method:\s*'ai\.cancel'/,
  'timed out or aborted AI work must notify the native service to cancel');
assert.match(bridgeScript, /MAX_MESSAGE_CHARS\s*=\s*\d+/);
assert.match(bridgeScript, /desktop bridge payload is too large/);
assert.match(bridgeScript, /isLargeWrite\s*=\s*verb/);
assert.match(bridgeScript, /api\\\/state/);
assert.doesNotMatch(bridgeScript, /setTimeout\(\(\) => \{ pending\.delete\(requestId\); reject\(new Error\('desktop bridge timeout'\)\); \}, options\.timeoutMs \|\| 15000\)/,
  'large state writes must not use the fixed 15 second bridge timeout');
assert.match(legacyHost, /MaxBridgeMessageChars/);
assert.match(legacyHost, /MaxBridgePayloadChars/);
assert.match(bridgeScript, /MESSAGE_TOO_LARGE/);

async function verifyRoundTrip() {
  const template = bridgeScript.match(/SourceTemplate\s*=\s*"""([\s\S]*?)""";/)?.[1];
  assert.ok(template, 'bridge source template must be extractable for a runtime contract test');
  let posted;
  let receive;
  const webview = {
    addEventListener(name, handler) { if (name === 'message') receive = handler; },
    postMessage(raw) { posted = JSON.parse(raw); },
  };
  const window = { chrome: { webview }, fetch: globalThis.fetch };
  vm.runInNewContext(template
    .replace('__ZHikeLocalDbFlag__', 'true')
    .replace('__ZhikeStorageMode__', "'local'"), {
    window,
    crypto: require('node:crypto').webcrypto,
    Headers,
    Response,
    AbortController,
    setTimeout,
    clearTimeout,
  });
  const pending = window.zhikeDesktop.invoke('legacy.api', { path: '/api/state', method: 'PUT', body: {} });
  assert.equal(posted.timeoutMs, 120000, 'large state writes need the extended bridge timeout');
  receive({ data: { type: 'zhike.bridge.response', requestId: posted.requestId, bridgeVersion: '6.0', ok: true, data: { saved: true } } });
  assert.equal((await pending).data.saved, true, 'lower camel-case response must resolve its matching request');

  const importPending = window.zhikeDesktop.invoke('legacy.api', { path: '/api/import/commit', method: 'POST', body: {} });
  assert.equal(posted.timeoutMs, 120000, 'import writes need the extended bridge timeout');
  receive({ data: { type: 'zhike.bridge.response', requestId: posted.requestId, bridgeVersion: '6.0', ok: true, data: { imported: 1 } } });
  assert.equal((await importPending).data.imported, 1);

  const snapshotPending = window.zhikeDesktop.invoke('legacy.api', { path: '/api/snapshot', method: 'POST', body: {} });
  assert.equal(posted.timeoutMs, 300000, 'pre-import snapshots need the long bridge timeout');
  receive({ data: { type: 'zhike.bridge.response', requestId: posted.requestId, bridgeVersion: '6.0', ok: true, data: { snapshotCreated: true } } });
  assert.equal((await snapshotPending).data.snapshotCreated, true);

  const aiPending = window.zhikeAI.request({ input: 'slow but valid analysis' });
  const aiRequest = posted;
  assert.equal(aiRequest.method, 'ai.request');
  assert.equal(aiRequest.timeoutMs, 115000, 'AI analysis must not inherit the generic 15 second bridge timeout');
  assert.equal(aiRequest.payload.requestId, aiRequest.requestId,
    'AI calls without an application request id must share the bridge id with native cancellation');
  receive({ data: { type: 'zhike.bridge.response', requestId: aiRequest.requestId, bridgeVersion: '6.0', ok: true, data: { text: 'done' } } });
  assert.equal((await aiPending).text, 'done');

  const statusPending = window.zhikeAI.status({});
  assert.equal(posted.timeoutMs, 15000, 'local AI status must remain a fast bridge operation');
  receive({ data: { type: 'zhike.bridge.response', requestId: posted.requestId, bridgeVersion: '6.0', ok: true, data: { configured: true } } });
  await statusPending;
  const modelsPending = window.zhikeAI.listModels({});
  assert.equal(posted.timeoutMs, 60000, 'AI model discovery needs the bounded network control budget');
  receive({ data: { type: 'zhike.bridge.response', requestId: posted.requestId, bridgeVersion: '6.0', ok: true, data: { models: [] } } });
  await modelsPending;

  const controller = new AbortController();
  const abortedPromise = window.zhikeAI.request({ input: 'cancel me', requestId: 'analysis-cancel-1' }, { signal: controller.signal })
    .then(() => null, error => error);
  const cancellableRequest = posted;
  controller.abort();
  const cancelRequest = posted;
  const abortError = await abortedPromise;
  assert.equal(abortError.code, 'CANCELLED');
  assert.equal(cancellableRequest.payload.requestId, 'analysis-cancel-1');
  assert.equal(cancelRequest.method, 'ai.cancel');
  assert.equal(cancelRequest.payload.requestId, 'analysis-cancel-1',
    'page cancellation must cancel the exact active native request');

  const url = '/api/workspace/restore';
  const body = '{"chat":"' + 'A'.repeat(1024 * 1024 - 10) + '🙌中文群聊"}';
  const init = { method: 'POST', headers: { 'X-State-Version': '27' }, body };
  const restored = window.fetch(url, init);
  const first = posted;
  assert.equal(first.method, 'workspace.restore.part');
  assert.equal(first.payload.offset, 0);
  assert.equal(first.payload.last, false);
  assert.equal(first.payload.chunk.endsWith('\ud83d'), false, 'UTF-16 surrogate pairs stay in one native chunk');
  receive({ data: { type: 'zhike.bridge.response', requestId: first.requestId, ok: true, data: { nextOffset: first.payload.chunk.length } } });
  await new Promise(resolve => setImmediate(resolve));
  const last = posted;
  assert.equal(last.payload.last, true);
  assert.equal(last.payload.version, '27');
  assert.equal(first.payload.chunk + last.payload.chunk, body);
  assert.equal(last.timeoutMs, 300000);
  receive({ data: { type: 'zhike.bridge.response', requestId: last.requestId, ok: false, errorCode: 'WORKSPACE_RESTORE_REJECTED', message: '版本冲突' } });
  const failed = await restored;
  assert.equal(failed.ok, false);
  assert.equal((await failed.json()).code, 'WORKSPACE_RESTORE_REJECTED');

  assert.equal((await window.fetch(url, { method: 'POST', body: '{}' })).status, 428);
  const replay = window.fetch(url, { ...init, headers: { 'X-State-Version': '' }, body: '{}' });
  assert.equal(posted.payload.last, true);
  assert.equal(posted.payload.version, '', 'a fresh database explicitly has the empty version');
  receive({ data: { type: 'zhike.bridge.response', requestId: posted.requestId, ok: true, data: { ok: true, operationId: 'receipt', version: '28' } } });
  assert.deepEqual(await (await replay).json(), { ok: true, operationId: 'receipt', version: '28' });
}

verifyRoundTrip().then(() => console.log('legacy bridge contract: runtime request/response matching and import/state timeout pass'));
