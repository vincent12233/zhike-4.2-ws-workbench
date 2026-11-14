'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const expected = '6.0.1';
const readme = read('README.md');
const csproj = read('desktop/src/Zhike.Desktop/Zhike.Desktop.csproj');
const setup = read('zhike-desktop-setup.iss');
const bundle = read('scripts/build-winui-bundle.ps1');
const installer = read('scripts/build-winui-installer.ps1');
const packageJson = JSON.parse(read('resources/app/package.json'));
const releaseNotes = read('docs/release-notes-6.0.1.md');
const operationsUpgrade = read('resources/app/modules/operations-upgrade.js');
const indexHtml = read('resources/app/index.html');
const server = read('resources/app/server.mjs');
const app = read('resources/app/app.js');
const gptAssistant = read('resources/app/modules/gpt-assistant.js');
const dataCenter = read('resources/app/modules/v4-data-center.js');

assert.match(readme, /知客 6\.0 Horizon Atelier 本机桌面版/);
assert.match(csproj, /<Version>6\.0\.1<\/Version>/);
assert.match(csproj, /<AssemblyVersion>6\.0\.1\.0<\/AssemblyVersion>/);
assert.match(setup, /#define AppVersion "6\.0\.1"/);
assert.match(setup, /OutputBaseFilename=知客-\{#AppVersion\}-WinUI桌面版/);
assert.match(bundle, /\[string\]\$Version\s*=\s*'6\.0\.1'/);
assert.match(installer, /\[string\]\$AppVersion\s*=\s*'6\.0\.1'/);
assert.equal(packageJson.version, expected);
assert.equal(packageJson.zhikeRuntime.host, 'WinUI 3 + WebView2');
assert.equal(packageJson.zhikeRuntime.storage, 'SQLite');
assert.doesNotMatch(JSON.stringify(packageJson), /electron|docker|postgres/i);
assert.match(releaseNotes, /^# 知客 6\.0\.1 Horizon Atelier 发布说明/m);
assert.match(releaseNotes, /已知限制|实机验收|WhatsApp/);
assert.doesNotMatch(releaseNotes, /docker compose|PostgreSQL.*服务端|双存储模式/i);
assert.match(operationsUpgrade, /runtimeVersion:'6\.0\.1'/);
assert.match(indexHtml, /<title>知客 6\.0 · Horizon Atelier<\/title>/);
assert.match(server, /const APP_VERSION = '6\.0\.1'/);
assert.doesNotMatch(indexHtml, /<title>知客 5\./, '正式文档标题不能回滚到 5.x');
assert.doesNotMatch(gptAssistant, /知客 GPT <em>4\.1<\/em>/, 'GPT 工作区不能显示旧版产品号');
assert.doesNotMatch(dataCenter, /4\.1 (?:数据库健康与诊断|多维转化中心)/, '数据中心和统计页不能显示旧版产品号');
assert.doesNotMatch(app, /(?:撤销 )?4\.1 批量运营写入前快照/, '6.0 操作记录不能继续生成旧版快照名称');

console.log('release consistency: one 6.0.1 Horizon Atelier WinUI + SQLite production line is documented');
