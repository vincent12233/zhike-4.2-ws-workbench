'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const bridge = read('desktop/src/Zhike.Desktop/Services/LegacyBridgeScript.cs');
const host = read('desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs');
const ui = read('resources/app/modules/ws-workbench.js');
const server = read('resources/app/server.mjs');
const capability = read('desktop/src/Zhike.Desktop/Services/WsCollectionCapability.cs');
const profiles = read('desktop/src/Zhike.Desktop/Services/WebViewProfileService.cs');
assert.match(bridge, /window\.__LOCAL_DB__\s*=\s*__ZHikeLocalDbFlag__/);
assert.match(bridge, /window\.chrome\.webview\.postMessage/);
assert.match(bridge, /MESSAGE_TOO_LARGE/);
assert.match(host, /BuildWsCollectorScript/);
assert.match(host, /visible-authorized-content/);
assert.match(host, /zhike\.ws\.capture/);
assert.match(host, /ExecuteWsCaptureAsync[\s\S]*ExecuteCollectorCommandAsync/,
  'automatic capture must pass the independently authenticated collector gateway');
assert.match(host, /kind is not \("messages" or "selection"\)/,
  'only the existing explicit manual capture kinds may use the foreground');
assert.match(server, /ws_messages/);
assert.match(server, /INSERT INTO ws_messages/);
assert.match(capability, /ErrorCode = "COLLECTION_CAPABILITY_BLOCKED"/);
assert.match(capability, /BackgroundCollection => true[\s\S]*AutomaticAi => false[\s\S]*ForegroundFallback => false/);
assert.match(profiles, /GetOrCreateCollectorProfileAsync\(string accountId\)[\s\S]*GetOrCreateEnvironmentAsync\(accountId, collector: true\)/);
assert.match(profiles, /PrepareCollectorProfileAsync[\s\S]*Task\.FromException\(WsCollectionCapability\.Denied\(\)\)/);
assert.doesNotMatch(profiles, /File\.Copy|CopyProfileDirectory|stagingPath|backupPath/,
  'excluding cookie filenames cannot substitute for prohibiting authenticated profile copying');
assert.match(ui, /BLOCKED_COLLECTION_CAPABILITY = Object\.freeze/);
assert.match(ui, /blocked: true, supported: false, started: false, retryable: false/);
assert.match(ui, /async function refreshCollectionSummary\(options = \{\}\) \{\s*(?:if \(!modeAccount\(state\.activeAccountId\)\) return;\s*)?if \(!collectionReady\('backgroundCollection'\)\) return collectionBlockedResult\(\)/,
  'refresh requires independent collector readiness before warmup/retry work');
assert.doesNotMatch(host, /session\.cookies|document\.cookie|password/i);
assert.match(host, /WsCollectorIngress\.TryAuthorize\(/, 'host-controlled view identity authorizes background ingress');
assert.match(ui, /native\.provider === 'native-independent-session'[\s\S]*native\.protocolVersion === 1/, 'unknown capability telemetry cannot enable collection');
assert.doesNotMatch(ui, /window\.localStorage\.getItem\(['"]ws-password/i);
console.log('ws-workbench-security: local bridge, authorized capture and secret-boundary contracts pass');
