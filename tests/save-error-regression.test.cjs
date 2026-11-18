'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const bridge = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Services', 'LegacyBridgeScript.cs'), 'utf8');
const host = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Views', 'LegacyUiHostPage.xaml.cs'), 'utf8');
const adapter = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Services', 'LegacyApiAdapter.cs'), 'utf8');
const client = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Services', 'ApiClient.cs'), 'utf8');
const hostPage = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Views', 'LegacyUiHostPage.xaml.cs'), 'utf8');
const app = fs.readFileSync(path.join(repo, 'resources', 'app', 'app.js'), 'utf8');

// Regression: the WinUI shell has one authoritative local SQLite path. It
// must not fall back to browser localStorage or wait for a remote pairing.
assert.match(bridge, /public static string Build\(bool apiConfigured\)/, 'desktop bridge keeps source compatibility for older callers');
assert.match(bridge, /Replace\("__ZHikeLocalDbFlag__", "true"/, 'bridge always selects the local SQLite API');
assert.match(bridge, /Replace\("__ZhikeStorageMode__", "'local'"/, 'bridge advertises the local storage mode');
assert.match(bridge, /if\s*\(!url\.startsWith\('\/api\/'\) \|\| !window\.__LOCAL_DB__/, 'non-API browser requests bypass the bridge');
assert.match(host, /AddScriptToExecuteOnDocumentCreatedAsync\(LegacyBridgeScript\.Build\(true\)\)/, 'legacy host injects local persistence mode');
assert.match(adapter, /raw\.Data[\s\S]*TryGetProperty\("error"/, 'native bridge preserves the API error reason');
assert.match(client, /App\.LocalService\?\.IsRunning == true/, 'native API client is created only from the local service');
assert.match(client, /ConfigureLocalSidecar\(\)/, 'local sidecar client is explicitly marked');
assert.match(hostPage, /App\.EnsureLocalServiceAsync\(/, 'desktop host waits for the local service');

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
