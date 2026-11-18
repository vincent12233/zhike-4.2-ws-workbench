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
assert.match(host, /kind is "discover" or "collect-all-read"\) return WsCollectionBlocked/,
  'RD02 automatic capture must fail explicitly rather than return an empty successful result');
assert.match(host, /kind is not \("messages" or "selection"\)/,
  'only the existing explicit manual capture kinds may use the foreground');
assert.match(server, /ws_messages/);
assert.match(server, /INSERT INTO ws_messages/);
assert.match(capability, /ErrorCode = "COLLECTION_CAPABILITY_BLOCKED"/);
assert.match(capability, /BackgroundCollection => false[\s\S]*ForegroundFallback => false/);
assert.match(profiles, /GetOrCreateCollectorProfileAsync\(string accountId\)[\s\S]*Task\.FromException<CoreWebView2Environment>\(WsCollectionCapability\.Denied\(\)\)/);
assert.doesNotMatch(profiles, /File\.Copy|CopyProfileDirectory|stagingPath|backupPath/,
  'excluding cookie filenames cannot substitute for prohibiting authenticated profile copying');
assert.match(ui, /BLOCKED_COLLECTION_CAPABILITY = Object\.freeze/);
assert.match(ui, /blocked: true, supported: false, started: false, retryable: false/);
assert.match(ui, /async function refreshCollectionSummary\(options = \{\}\) \{\s*if \(!collectionCapability\(\)\.backgroundCollection\) return collectionBlockedResult\(\)/,
  'RD02 blocks refresh before the retained legacy warmup/retry body can run');
assert.doesNotMatch(host, /session\.cookies|document\.cookie|password/i);
assert.doesNotMatch(ui, /window\.localStorage\.getItem\(['"]ws-password/i);
console.log('ws-workbench-security: local bridge, authorized capture and secret-boundary contracts pass');
