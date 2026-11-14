'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const manager = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Services/LocalServiceManager.cs'), 'utf8');
const project = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Zhike.Desktop.csproj'), 'utf8');
const server = fs.readFileSync(path.join(repo, 'resources/app/server.mjs'), 'utf8');

assert.match(project, /<InformationalVersion>6\.0\.1<\/InformationalVersion>/);
assert.match(server, /const APP_VERSION = '6\.0\.1'/);
assert.match(manager, /ExpectedAppVersion/);
assert.match(manager, /TryGetProperty\("appVersion"/);
assert.match(manager, /string\.Equals\(actual, ExpectedAppVersion/);
assert.match(manager, /安装文件混装/);
assert.match(manager, /程序不会回退到旧资源/);

console.log('version lock contract: desktop and local resources must match 6.0 and cannot silently roll back');
