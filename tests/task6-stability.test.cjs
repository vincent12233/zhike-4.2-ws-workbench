'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const app = read('resources/app/app.js');
const server = read('resources/app/server.mjs');
const ws = read('resources/app/modules/ws-workbench.js');
const bridge = read('desktop/src/Zhike.Desktop/Services/LegacyBridgeScript.cs');
const installer = read('scripts/build-winui-installer.ps1');
const setup = read('zhike-desktop-setup.iss');

assert.match(app, /syncPollDelay/);
assert.match(app, /syncReadFailure/);
assert.match(app, /yieldToUi/);
assert.match(app, /capacityWarning|容量告警|数据量较大/);
assert.match(ws, /collectionRefreshTimer/);
assert.match(ws, /autoCaptureTimer/);
assert.match(ws, /analysisStatus/);
assert.match(ws, /resumeCollectionFromCheckpoint/);
assert.match(server, /ws_followup_alerts/);
assert.match(server, /stateVersionFailure/);
assert.match(bridge, /desktop bridge timeout/);
assert.match(installer, /WebView2|webview2/i);
assert.match(installer, /rollback|upgrade|backup|回滚|升级|备份|恢复/i);
assert.match(installer, /Invoke-CodeSign/);
assert.match(setup, /HasWebView2Runtime/);
assert.doesNotMatch(installer, /build-installer\.ps1|zhike-setup\.iss|Docker Compose/i);

console.log('task6 stability contract: bounded local writes, adaptive sync, WS/AI retry and WinUI installer gates pass');
