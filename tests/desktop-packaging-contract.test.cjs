'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const bundle = fs.readFileSync(path.join(repo, 'scripts/build-winui-bundle.ps1'), 'utf8');
const installer = fs.readFileSync(path.join(repo, 'scripts/build-winui-installer.ps1'), 'utf8');
const setup = fs.readFileSync(path.join(repo, 'zhike-desktop-setup.iss'), 'utf8');
const attributes = fs.readFileSync(path.join(repo, '.gitattributes'), 'utf8');

assert.match(bundle, /Version\s*=\s*'6\.0\.0'/);
assert.match(bundle, /resourcesRoot/);
assert.match(bundle, /'index\.html'/);
assert.match(bundle, /'app\.js'/);
assert.match(bundle, /'assets'/, 'formal bundle must include the 6.0 local brand assets');
assert.match(bundle, /Get-ChildItem[\s\S]*resourcesRoot[\s\S]*Copy-Item/);
assert.match(bundle, /resourceAllowList/);
assert.match(bundle, /'vendor\\xlsx\\xlsx\.js'/,
  'the runtime bundle must include the single SheetJS build loaded by index.html');
assert.match(bundle, /'vendor\\xlsx\\LICENSE'/,
  'the runtime bundle must retain the third-party license');
assert.doesNotMatch(bundle, /^\s*'vendor\\xlsx'\s*,?\s*$/m,
  'the installer must not ship unused SheetJS source maps and alternate builds');
assert.match(bundle, /node\.exe/);
assert.match(bundle, /sourceCommit/);
assert.match(bundle, /sourceArchive/);
assert.match(bundle, /WindowsAppSDKSelfContained=true/);
assert.match(bundle, /sourceArchiveBytes/);
assert.match(bundle, /iconSource/);
assert.match(bundle, /zhike\.ico/);
assert.match(attributes, /releases\/\*\.exe\s+export-ignore/);
assert.match(installer, /expectedPattern/);
assert.match(installer, /StageDir/);
assert.match(installer, /requiredStageFiles/);
assert.match(installer, /bundle-manifest\.json/);
assert.match(installer, /manifestVersion/);
assert.match(installer, /staged bundle version mismatch/);
assert.match(installer, /staged bundle runtime mismatch/);
assert.match(installer, /resources\\app\\app\.js/);
assert.match(installer, /resources\\app\\assets\\zhike-horizon-logo\.png/);
for (const stylesheet of ['business-6', 'operations-6', 'global-6', 'scroll-system']) {
  assert.match(installer, new RegExp(`resources\\\\app\\\\modules\\\\${stylesheet}\\.css`), `installer must require ${stylesheet}.css`);
}
assert.match(installer, /blockedStageNames/);
assert.match(installer, /'zhike\.ico'/);
assert.match(installer, /DIconFile/);
assert.match(installer, /ComSpec \/d \/s \/c/);
assert.match(setup, /DestDir:\s*\"\{app\}\"/);
assert.match(setup, /LOCALAPPDATA.*Zhike/);
assert.match(setup, /HasWebView2Runtime/);
assert.match(setup, /developer\.microsoft\.com\/microsoft-edge\/webview2/);
assert.match(setup, /ShellExec\('open'/);
assert.match(installer, /Invoke-CodeSign/);
assert.match(installer, /signtool\.exe/);
assert.match(installer, /verify \/pa \/all/);
assert.match(setup, /SetupIconFile=\{#IconFile\}/);
assert.match(setup, /DestName: "zhike-horizon-6\.ico"/, 'installer must use a new icon path so Windows cannot reuse the old shortcut cache');
assert.match(setup, /IconFilename: "\{app\}\\zhike-horizon-6\.ico"/);
assert.match(setup, /UninstallDisplayIcon=\{app\}\\zhike-horizon-6\.ico/);
assert.match(setup, /AppName=知客工作台/);
assert.match(setup, /Name: "\{autodesktop\}\\知客工作台"/);
assert.doesNotMatch(setup, /^\[Tasks\]$/m, 'the always-created desktop shortcut must not expose a no-op optional task');
assert.match(setup, /\[InstallDelete\][\s\S]*知客原生桌面版\.lnk[\s\S]*知客桌面版\.lnk/);
assert.match(setup, /Type: filesandordirs; Name: "\{app\}\\resources"/, 'coverage upgrade must remove retired application resources before copying 6.0');
assert.match(setup, /Type: files; Name: "\{app\}\\\*\.dll"/, 'coverage upgrade must remove retired root runtime assemblies');
assert.match(setup, /orphaned; no executable remains to retire[\s\S]*Result := True/, 'an orphan old uninstall registry value must not block 6.0');
assert.match(setup, /\{userprograms\}\\知客兼容回滚（旧版）\.lnk/, 'formal upgrade must remove the retired rollback shortcut');
assert.match(setup, /\{userprograms\}\\知客原生桌面版\\知客工作台\.lnk/, 'formal upgrade must remove the retired native shortcut');
assert.match(setup, /dirifempty; Name: "\{userprograms\}\\知客原生桌面版"/, 'formal upgrade must remove the retired empty program group');
assert.match(setup, /\[InstallDelete\][\s\S]*release-notes-5\.3\.18\.md/);
assert.match(setup, /\[InstallDelete\][\s\S]*phone-registry-seed\.json/);
assert.match(setup, /\[InstallDelete\][\s\S]*operations-core\.test\.cjs/);
assert.doesNotMatch(setup, /\[InstallDelete\][\s\S]*\{localappdata\}\\Zhike/);

const project = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Zhike.Desktop.csproj'), 'utf8');
assert.match(project, /ApplicationIcon>Assets\\zhike\.ico</);
assert.match(project, /<Version>6\.0\.0<\/Version>/);
assert.match(bundle, /-p:Version=\$Version/);
assert.match(bundle, /-p:FileVersion=\$Version\.0/);
assert.equal(fs.existsSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Assets', 'zhike.ico')), true, 'brand ico must be tracked');

console.log('desktop packaging contract: resources, version, traceability, icon and user-data retention are present');
