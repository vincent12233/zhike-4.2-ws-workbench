'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '..', '..');
const root = path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Services');
const contract = fs.readFileSync(path.join(repo, 'docs', 'compatibility-contract-v5.1.md'), 'utf8');

for (const file of ['DesktopBridgeService.cs', 'LegacyApiAdapter.cs', 'BridgeContracts.cs', 'LegacyBridgeScript.cs'])
  assert.equal(fs.existsSync(path.join(root, file)), true, `missing bridge service ${file}`);
for (const token of ['requestId', 'bridgeVersion', 'unsupported', 'idempotency', 'api/state', 'api/ws'])
  assert.match(contract, new RegExp(token, 'i'), `bridge contract missing ${token}`);

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

const adapter = fs.readFileSync(path.join(root, 'LegacyApiAdapter.cs'), 'utf8');
assert.match(adapter, /ExplicitlyUnsupportedPrefixes/);
assert.match(adapter, /UNSUPPORTED/);
assert.match(adapter, /api\/ws\/checkpoints/);
assert.match(adapter, /api\/ws\/heartbeat/);
assert.match(adapter, /api\/v2\/legacy\/state\/version/);
assert.match(adapter, /UnescapeDataString/);
assert.match(adapter, /EscapeDataString/);
assert.match(adapter, /TryParse\(suffix/);
assert.match(adapter, /snapshot id is invalid/);
assert.match(adapter, /snapshotCreated/);
assert.match(adapter, /skipped/);
assert.match(adapter, /BUSINESS_REJECTED/);
assert.match(adapter, /NO_CHANGE/);
assert.match(adapter, /importCommit/);
assert.doesNotMatch(adapter, /StartsWith\("\/api\/ws\/"[^\n]*\)\s*\)\s*\n\s*v2Path\s*=/,
  'adapter must not blindly forward every legacy WS route to v2');

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
  vm.runInNewContext(template.replace('__ZHikeLocalDbFlag__', 'true'), {
    window,
    setTimeout,
    clearTimeout,
  });
  const pending = window.zhikeDesktop.invoke('legacy.api', { path: '/api/state', method: 'PUT', body: {} });
  assert.equal(posted.timeoutMs, 120000, 'large state writes need the extended bridge timeout');
  receive({ data: { type: 'zhike.bridge.response', requestId: posted.requestId, bridgeVersion: '5.1', ok: true, data: { saved: true } } });
  assert.equal((await pending).data.saved, true, 'lower camel-case response must resolve its matching request');

  const importPending = window.zhikeDesktop.invoke('legacy.api', { path: '/api/import/commit', method: 'POST', body: {} });
  assert.equal(posted.timeoutMs, 120000, 'import writes need the extended bridge timeout');
  receive({ data: { type: 'zhike.bridge.response', requestId: posted.requestId, bridgeVersion: '5.1', ok: true, data: { imported: 1 } } });
  assert.equal((await importPending).data.imported, 1);

  const snapshotPending = window.zhikeDesktop.invoke('legacy.api', { path: '/api/snapshot', method: 'POST', body: {} });
  assert.equal(posted.timeoutMs, 300000, 'pre-import snapshots need the long bridge timeout');
  receive({ data: { type: 'zhike.bridge.response', requestId: posted.requestId, bridgeVersion: '5.1', ok: true, data: { snapshotCreated: true } } });
  assert.equal((await snapshotPending).data.snapshotCreated, true);
}

verifyRoundTrip().then(() => console.log('legacy bridge contract: runtime request/response matching and import/state timeout pass'));
