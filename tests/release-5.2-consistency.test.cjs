'use strict';

// Release 5.2.0 is the single active WinUI/Docker line.  The Electron 4.4.x
// package remains a historical rollback target and is intentionally excluded.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const expected = '5.2.0';

const activeVersionSources = {
  readme: read('README.md'),
  env: read('infra/.env.example'),
  compose: read('infra/compose.yaml'),
  api: read('server/src/Zhike.Api/Program.cs'),
  csproj: read('desktop/src/Zhike.Desktop/Zhike.Desktop.csproj'),
  desktopSetup: read('zhike-desktop-setup.iss'),
  bundleScript: read('scripts/build-winui-bundle.ps1'),
  installerScript: read('scripts/build-winui-installer.ps1'),
  desktopReadme: read('desktop/src/Zhike.Desktop/README.md'),
  connectorPackage: read('connectors/ws-worker/package.json'),
  connectorLock: read('connectors/ws-worker/package-lock.json'),
  serverBundleScript: read('scripts/build-server-bundle.ps1'),
  winuiBundleScript: read('scripts/build-winui-bundle.ps1'),
};

assert.match(activeVersionSources.readme, /知客 5\.2\.0 桌面版/);
assert.match(activeVersionSources.readme, /schemaVersion=11/);
assert.match(activeVersionSources.env, /^ZHike_APP_VERSION=5\.2\.0$/m);
assert.match(activeVersionSources.compose, /ZHike__AppVersion:\s*\$\{ZHike_APP_VERSION:-5\.2\.0\}/);
assert.match(activeVersionSources.api, /ZHike:AppVersion[^\n]*\?\?\s*"5\.2\.0"/);
assert.match(activeVersionSources.csproj, /<Version>5\.2\.0<\/Version>/);
assert.match(activeVersionSources.csproj, /<AssemblyVersion>5\.2\.0\.0<\/AssemblyVersion>/);
assert.match(activeVersionSources.desktopSetup, /#define AppVersion "5\.2\.0"/);
assert.match(activeVersionSources.desktopSetup, /zhike-winui-5\.2\.0-win-x64/);
assert.match(activeVersionSources.bundleScript, /\[string\]\$Version\s*=\s*'5\.2\.0'/);
assert.match(activeVersionSources.installerScript, /\[string\]\$AppVersion\s*=\s*'5\.2\.0'/);
assert.match(activeVersionSources.desktopReadme, /-Version 5\.2\.0/);
assert.match(activeVersionSources.connectorPackage, /"version":\s*"5\.2\.0"/);
assert.match(activeVersionSources.connectorLock, /"version":\s*"5\.2\.0"/);
assert.match(activeVersionSources.serverBundleScript, /\[string\]\$Version\s*=\s*'5\.2\.0'/);
assert.match(activeVersionSources.serverBundleScript, /release-notes-5\.2\.0\.md/);
assert.match(activeVersionSources.winuiBundleScript, /release-notes-5\.2\.0\.md/);
assert.match(activeVersionSources.winuiBundleScript, /hot-chat-profile-usage\.md/);

const releaseNotes = read('docs/release-notes-5.2.0.md');
assert.match(releaseNotes, /^# 知客 5\.2\.0 发布说明/m);
assert.match(releaseNotes, /回滚|Rollback/i);
assert.match(releaseNotes, /已知限制/);
assert.match(releaseNotes, /schema.*011|011.*迁移/i);

console.log('release 5.2 consistency: active desktop, Docker, connector and release docs use one version');
