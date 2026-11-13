'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const setup = fs.readFileSync(path.join(repo, 'zhike-desktop-setup.iss'), 'utf8');
const bridge = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Services/DesktopBridgeService.cs'), 'utf8');
const bridgeScript = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Services/LegacyBridgeScript.cs'), 'utf8');

assert.match(setup, /PreviousElectronUninstallKey[\s\S]*C3EDBD10-E7B9-4C06-A297-6184F7DDE410/);
assert.match(setup, /QueryPreviousElectronUninstaller/);
assert.match(setup, /RegQueryStringValue\(HKCU/);
assert.match(setup, /RegQueryStringValue\(HKLM/);
assert.match(setup, /PrepareToInstall/);
assert.match(setup, /RetirePreviousElectronClient/);
assert.match(setup, /ewWaitUntilTerminated/);
for (const switchName of ['VERYSILENT', 'SUPPRESSMSGBOXES', 'NORESTART'])
  assert.match(setup, new RegExp(switchName));

assert.match(setup, /\{autodesktop\}\\知客运营工作台\.lnk/);
assert.match(setup, /\{userprograms\}\\知客运营工作台\\知客运营工作台\.lnk/);
assert.doesNotMatch(setup, /Type:\s*filesandordirs;\s*Name:\s*"\{localappdata\}\\Programs\\Zhike"/i);
assert.doesNotMatch(setup, /\[InstallDelete\][\s\S]*Type:\s*filesandordirs;[^\r\n]*\{localappdata\}\\Zhike/i);
assert.match(setup, /旧版数据目录不会被读取、迁移或删除/);
assert.match(setup, /%LOCALAPPDATA%\\\\Zhike6/);

assert.match(bridge, /CurrentVersion\s*=\s*"6\.0"/);
assert.doesNotMatch(bridge, /CurrentVersion\s*=\s*"5\./);
assert.match(bridgeScript, /bridgeVersion:\s*'6\.0'/);
assert.match(bridgeScript, /version:\s*'6\.0'/);
assert.doesNotMatch(bridgeScript, /bridgeVersion:\s*'5\./);

console.log('legacy install retirement: old Electron entry points are removed, old data stays untouched and 6.0 uses an isolated data root');
