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
const prepare = setup.match(/function PrepareToInstall\([^\n]+\)[\s\S]*?\nend;/)?.[0];
assert.ok(prepare, 'setup must validate the final destination before file operations');
assert.doesNotMatch(prepare, /RetirePreviousElectronClient/,
  'a cancelled or failed installation must not first remove the working legacy app');
const postInstall = setup.match(/procedure CurStepChanged\([^\n]+\)[\s\S]*?\nend;/)?.[0];
assert.match(postInstall ?? '', /if CurStep <> ssPostInstall then Exit;[\s\S]*RetirePreviousElectronClient/,
  'retire the legacy client only after the new application was installed');
assert.match(postInstall, /WizardSilent\(\)/, 'a legacy retirement failure must not block silent installs with a dialog');
const retirement = setup.match(/function RetirePreviousElectronClient\([^)\n]*\)[\s\S]*?\nend;/)?.[0];
assert.ok(retirement);
const overlapGuard = retirement.match(/if \(UninstallerDirectory = ''\)[\s\S]*?end;/)?.[0];
assert.ok(overlapGuard);
assert.match(overlapGuard, /DirectoryAtOrBelow\(UninstallerDirectory, InstallDirectory\)/,
  'a stale legacy registration must not execute the new installation’s uninstaller');
assert.match(overlapGuard, /DirectoryAtOrBelow\(InstallDirectory, UninstallerDirectory\)/,
  'an older installation must not be removed when it contains the new installation');
assert.match(overlapGuard, /Result := False;\s*Exit;/);
assert.ok(retirement.indexOf('Exec(Filename') > retirement.indexOf(overlapGuard));
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
