'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const bridge = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Services', 'LegacyBridgeScript.cs'), 'utf8');
const host = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Views', 'LegacyUiHostPage.xaml.cs'), 'utf8');
const adapter = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Services', 'LegacyApiAdapter.cs'), 'utf8');
const client = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Services', 'ApiClient.cs'), 'utf8');
const home = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Views', 'HomePage.xaml.cs'), 'utf8');
const app = fs.readFileSync(path.join(repo, 'resources', 'app', 'app.js'), 'utf8');

// Regression: an unpaired desktop app must use the existing localStorage
// persistence path. It must not force the API bridge and then show “保存异常”
// merely because no Docker pairing has been configured yet.
assert.match(bridge, /public static string Build\(bool apiConfigured\)/, 'desktop bridge exposes a connection-aware script builder');
assert.match(bridge, /window\.__LOCAL_DB__\s*=\s*__ZHikeLocalDbFlag__;/, 'bridge local-db mode is injected instead of hard-coded');
assert.doesNotMatch(bridge, /window\.__LOCAL_DB__\s*=\s*true;/, 'bridge does not force API persistence when unpaired');
assert.match(bridge, /!url\.startsWith\('\/api\/'\) \|\| !window\.__LOCAL_DB__/, 'offline mode bypasses the remote API bridge');
assert.match(host, /AddScriptToExecuteOnDocumentCreatedAsync\(LegacyBridgeScript\.Build\(_api\?\.SessionToken is \{ Length: > 0 \}\)\)/, 'legacy host injects the correct persistence mode');
assert.match(adapter, /raw\.Data[\s\S]*TryGetProperty\("error"/, 'native bridge preserves the API error reason');
assert.match(client, /FirstConfigured\(Environment\.GetEnvironmentVariable\("ZHIKE_API_BASE_URL"\), saved\?\.BaseUrl\)/, 'blank environment values do not hide the saved server URL');
assert.match(client, /string\.IsNullOrWhiteSpace\(preferred\) \? fallback : preferred\.Trim\(\)/, 'connection values are trimmed and fall back safely');
assert.match(home, /FirstConfigured\(Environment\.GetEnvironmentVariable\("ZHIKE_API_BASE_URL"\), saved\?\.BaseUrl\)/, 'pairing page uses the same connection fallback');

// Regression: server-side validation errors must reach the user instead of
// being collapsed into the misleading generic “写入失败” message.
assert.match(app, /const failure=await response\.json\(\)\.catch\(\(\)=>\(\{\}\)\)/, 'state writes parse the server error payload');
assert.match(app, /failure\.error\|\|failure\.message/, 'state writes surface the server reason');
assert.match(app, /if\(!response\.ok\)throw await stateWriteError\(response,'写入失败'\)/, 'state writes use the parsed server error');

// A read/polling failure is a sync problem, not a failed local save. Keep a
// separate flag so a healthy local write is not mislabeled as “保存异常”.
assert.match(app, /syncReadFailure/, 'sync reads have a separate failure state');
assert.match(app, /同步异常/, 'the UI distinguishes sync errors from save errors');
assert.match(app, /syncReadFailure=dbWriteFailure/, 'background sync failures do not overwrite save failures');

console.log('save-error regression contracts passed');
