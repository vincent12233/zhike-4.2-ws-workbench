'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const bundle = fs.readFileSync(path.join(repo, 'scripts/build-winui-bundle.ps1'), 'utf8');
const installer = fs.readFileSync(path.join(repo, 'scripts/build-winui-installer.ps1'), 'utf8');
const setup = fs.readFileSync(path.join(repo, 'zhike-desktop-setup.iss'), 'utf8');
const attributes = fs.readFileSync(path.join(repo, '.gitattributes'), 'utf8');

const version = require('../resources/app/package.json').version;
const icon = `zhike-horizon-${version.replaceAll('.', '-')}.ico`;
assert.equal(bundle.match(/Version\s*=\s*'([^']+)'/)?.[1], version);
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
assert.match(bundle, /-p:PlatformTarget=x64/, 'WinUI publish must target x64 for Windows App SDK self-contained bundles');
assert.match(bundle, /-p:Platform=x64/, 'WinUI publish must pass the x64 platform to MSBuild');
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
for (const stylesheet of ['business-6', 'operations-6', 'global-6', 'home-6', 'scroll-system']) {
  assert.match(installer, new RegExp(`resources\\\\app\\\\modules\\\\${stylesheet}\\.css`), `installer must require ${stylesheet}.css`);
}
assert.match(installer, /blockedStageNames/);
assert.match(installer, /'zhike\.ico'/);
assert.match(installer, /DIconFile/);
assert.match(installer, /ComSpec \/d \/s \/c/);
assert.match(setup, /DestDir:\s*\"\{app\}\"/);
assert.match(setup, /LOCALAPPDATA.*Zhike/);
const versionCheck = setup.split('function IsInstalledWebView2Version')[1].split('function WebView2RuntimeRegistered')[0];
const registrationCheck = setup.split('function WebView2RuntimeRegistered')[1].split('function InitializeSetup')[0];
const initialize = setup.split('function InitializeSetup')[1];
assert.match(setup, /WebView2ClientKey = 'Software\\Microsoft\\EdgeUpdate\\Clients\\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5\}'/);
assert.match(versionCheck, /Result := False;[\s\S]*if not HasDigit then Exit;/, 'empty version components are rejected');
assert.match(versionCheck, /VersionText\[I\] < '0'\) or \(VersionText\[I\] > '9'\) then Exit;/, 'non-numeric versions are rejected');
assert.match(versionCheck, /if \(DotCount <> 3\) or not HasDigit then Exit;\s*if not StrToVersion\(VersionText, Version\) then Exit;\s*Result := Version > 0;/,
  'only a valid nonzero four-part version counts as installed');
assert.match(registrationCheck, /Result := False;\s*if RegQueryStringValue\(RootKey, WebView2ClientKey, 'pv', VersionText\) then\s*Result := IsInstalledWebView2Version\(VersionText\);/);
assert.match(registrationCheck, /Result := WebView2RuntimeRegistered\(HKCU\) or WebView2RuntimeRegistered\(HKLM32\);/,
  'either complete Evergreen registry branch can satisfy the prerequisite');
assert.match(initialize, /Result := HasWebView2Runtime\(\);\s*if Result then\s*Exit;/,
  'installation proceeds only after the prerequisite succeeds');
assert.match(initialize, /Log\('[^']*Setup cancelled before changing files\.'\);\s*if WizardSilent\(\) then\s*Exit;\s*Choice := MsgBox/,
  'silent installation fails before prompting or opening the browser');
assert.doesNotMatch(initialize, /Result := True|RetirePreviousElectronClient|PrepareToInstall/,
  'a missing runtime cannot start setup or retire a prior installation');
assert.match(setup, /developer\.microsoft\.com\/microsoft-edge\/webview2/);
assert.match(setup, /ShellExec\('open'/);
assert.match(installer, /Invoke-CodeSign/);
assert.match(installer, /signtool\.exe/);
assert.match(installer, /verify \/pa \/all/);
assert.match(setup, /SetupIconFile=\{#IconFile\}/);
assert.ok(setup.includes(`DestName: "${icon}"`), 'installer must use a versioned icon path so Windows cannot reuse the old shortcut cache');
assert.ok(setup.includes(`IconFilename: "{app}\\${icon}"`));
assert.ok(setup.includes(`UninstallDisplayIcon={app}\\${icon}`));
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
assert.match(setup, /\[InstallDelete\][\s\S]*release-notes-5\.4\.0\.md[\s\S]*release-notes-6\.0\.0\.md[\s\S]*release-notes-6\.0\.1\.md/, 'in-place upgrade must remove stale 5.4/6.0.0/6.0.1 release notes');
assert.match(setup, /\[InstallDelete\][\s\S]*phone-registry-seed\.json/);
assert.match(setup, /\[InstallDelete\][\s\S]*operations-core\.test\.cjs/);
const installDelete = setup.split('[InstallDelete]')[1].split('[Icons]')[0];
assert.doesNotMatch(installDelete, /\{localappdata\}\\Zhike/i);
for (const line of installDelete.split(/\r?\n/).filter(value => /^Type:/.test(value))) {
  assert.match(line, /; Check: IsVerifiedUpgradeDirectory$/,
    'only a verified upgrade may delete existing files or shortcuts: ' + line);
}
const appId = setup.match(/^AppId=\{\{([^}]+)\}/m)?.[1];
assert.ok(appId);
assert.ok(setup.includes('\\{' + appId + '}_is1'), 'directory ownership must use the actual application ID');
assert.match(setup, /RegQueryStringValue\(HKCU, CurrentNativeUninstallKey, 'Inno Setup: App Path', RegisteredDirectory\)/);
assert.match(setup, /CompareText\(Directory, NormalizeLocalDirectory\(RegisteredDirectory\)\) = 0/,
  'previous install registration must match the selected absolute directory');
assert.match(setup, /if not VerifiedUpgrade and not DirectoryIsEmpty\(Directory\) then/,
  'a fresh install must refuse existing nonempty directories');
assert.match(setup, /if not IsSafeInstallDirectory\(Directory\) then/);
assert.match(setup, /Length\(Value\) <= 3/, 'a drive root is not an install directory');
for (const protectedRoot of ['{win}', '{localappdata}\\Zhike', '{localappdata}\\Zhike6']) {
  assert.ok(setup.includes("DirectoryAtOrBelow(Directory, ExpandConstant('" + protectedRoot + "'))"),
    'installation must reject the protected directory and its descendants');
}
assert.match(setup, /Attributes := GetPathAttributes\(Parent\);[\s\S]*\(Attributes and PathTypeReparse\) <> 0[\s\S]*Parent := ExtractFileDir\(Parent\)/,
  'the selected path and its existing ancestors must not cross a reparse point');
assert.match(setup, /if not DirectoryTreeHasNoReparsePoints\(Directory\) then[\s\S]*VerifiedUpgradePath := Directory/,
  'verify the existing application subtree before enabling any recursive removal');

const project = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Zhike.Desktop.csproj'), 'utf8');
assert.match(project, /ApplicationIcon>Assets\\zhike\.ico</);
assert.ok(project.includes(`<Version>${version}</Version>`));
assert.match(bundle, /-p:Version=\$Version/);
assert.match(bundle, /-p:FileVersion=\$Version\.0/);
assert.equal(fs.existsSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Assets', 'zhike.ico')), true, 'brand ico must be tracked');

console.log('desktop packaging contract: resources, version, traceability, icon and user-data retention are present');
