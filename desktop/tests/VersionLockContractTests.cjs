'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const { version } = require(path.join(repo, 'resources/app/package.json'));
const manager = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Services/LocalServiceManager.cs'), 'utf8');
const project = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Zhike.Desktop.csproj'), 'utf8');
const server = fs.readFileSync(path.join(repo, 'resources/app/server.mjs'), 'utf8');

assert.equal(project.match(/<InformationalVersion>([^<]+)<\/InformationalVersion>/)?.[1], version,
  'desktop assembly informational version must match the app package');
assert.equal(server.match(/const APP_VERSION\s*=\s*'([^']+)'/)?.[1], version,
  'sidecar version must match the app package');
assert.match(manager, /ExpectedAppVersion/);
assert.match(manager, /TryGetProperty\("appVersion"/);
assert.match(manager, /string\.Equals\(actual, ExpectedAppVersion/);
assert.match(manager, /安装文件混装/);
assert.match(manager, /程序不会回退到旧资源/);

console.log(`version lock contract: desktop and local resources must match ${version} and cannot silently roll back`);
