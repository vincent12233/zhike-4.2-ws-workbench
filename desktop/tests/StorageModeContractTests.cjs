'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');

const client = read('desktop/src/Zhike.Desktop/Services/ApiClient.cs');
const manager = read('desktop/src/Zhike.Desktop/Services/LocalServiceManager.cs');
const page = read('desktop/src/Zhike.Desktop/Views/HomePage.xaml.cs');
const xaml = read('desktop/src/Zhike.Desktop/Views/HomePage.xaml');
const bridge = read('desktop/src/Zhike.Desktop/Services/LegacyBridgeScript.cs');
const app = read('resources/app/app.js');

assert.match(manager, /SQLite/);
assert.match(manager, /ZHIKE_DATA_DIR/);
assert.match(manager, /127\.0\.0\.1/);
assert.match(manager, /X-Zhike-Shutdown-Token/);
assert.match(client, /ConfigureLocalSidecar/);
assert.match(client, /api\/health/);
assert.match(page, /EnsureLocalServiceAsync/);
assert.match(xaml, /SQLite 本机数据库/);
assert.doesNotMatch(xaml, /Docker PostgreSQL|配对码/);
assert.match(bridge, /Replace\("__ZHikeLocalDbFlag__", "true"/);
assert.match(bridge, /Replace\("__ZhikeStorageMode__", "'local'"/);
assert.match(app, /本机存储正常/);
assert.match(app, /SQLite · 本机服务已启动/);
assert.doesNotMatch(app, /Docker PostgreSQL|open-server-connection|server\.connection/);

console.log('desktop storage mode: one local SQLite sidecar is the only production storage path');
