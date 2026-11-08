'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const bundle = fs.readFileSync(path.join(repo, 'scripts/build-winui-bundle.ps1'), 'utf8');
const installer = fs.readFileSync(path.join(repo, 'scripts/build-winui-installer.ps1'), 'utf8');
const setup = fs.readFileSync(path.join(repo, 'zhike-desktop-setup.iss'), 'utf8');
const attributes = fs.readFileSync(path.join(repo, '.gitattributes'), 'utf8');

assert.match(bundle, /Version\s*=\s*'5\.1\.0'/);
assert.match(bundle, /resourcesRoot/);
assert.match(bundle, /'index\.html'/);
assert.match(bundle, /'app\.js'/);
assert.match(bundle, /Get-ChildItem[\s\S]*resourcesRoot[\s\S]*Copy-Item/);
assert.match(bundle, /resourceAllowList/);
assert.match(bundle, /node\.exe/);
assert.match(bundle, /sourceCommit/);
assert.match(bundle, /sourceArchive/);
assert.match(bundle, /WindowsAppSDKSelfContained=true/);
assert.match(bundle, /sourceArchiveBytes/);
assert.match(attributes, /releases\/\*\.exe\s+export-ignore/);
assert.match(installer, /expectedPattern/);
assert.match(installer, /StageDir/);
assert.match(installer, /requiredStageFiles/);
assert.match(installer, /resources\\app\\app\.js/);
assert.match(installer, /blockedStageNames/);
assert.match(installer, /ComSpec \/d \/s \/c/);
assert.match(setup, /DestDir:\s*\"\{app\}\"/);
assert.match(setup, /LOCALAPPDATA.*Zhike/);
assert.match(setup, /HasWebView2Runtime/);

console.log('desktop packaging contract: resources, version, traceability and user-data retention are present');
