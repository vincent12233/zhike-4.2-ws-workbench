'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const repo = path.resolve(__dirname, '..');
const script = path.join(repo, 'scripts/verify-winui-installer.ps1');
const pinPath = path.join(repo, 'scripts/fixtures/previous-winui-release.json');
const pin = JSON.parse(fs.readFileSync(pinPath, 'utf8'));
const source = fs.readFileSync(script, 'utf8');
const workflow = fs.readFileSync(path.join(repo, '.github/workflows/windows-validation.yml'), 'utf8');

test('previous installer identity is the published rc.3 artifact, distinct from candidate inputs', () => {
  assert.equal(pin.releaseId, 451230083); assert.equal(pin.tag, 'v6.1.0-rc.3');
  assert.equal(pin.sourceCommit, 'bddb8ae33604110cdd191d7b7589fc8fe9d692bf');
  assert.deepEqual(pin.installer, { id:767374580, name:'zhike-6.1.0-win-x64-setup.exe', bytes:114177547,
    sha256:'f8d7ca52106ba9a7ce824df4ae79a217c36d5860f499b9b6775138919498988b' });
  assert.deepEqual(pin.manifest, { id:767374963, name:'release-output-manifest.json', bytes:442,
    sha256:'b3932186cde2c8b42a1e924c382b40c51a5bcad80a431d6a4a3082a6f1343b83' });
  assert.match(workflow, /verify-winui-installer\.ps1[^\r\n]+-VerifyPreviousReleaseUpgrade/);
  assert.match(workflow, /previous-release-provenance\.json,work\/installer-smoke\/previous-release-output-manifest\.json/);
  assert.match(source, /previousInstallExitCode[\s\S]*candidateOverwriteExitCode[\s\S]*uninstall-after-upgrade\.log/);
  assert.match(source, /sourceCommit -eq \$previous\.pin\.sourceCommit/);
  assert.match(source, /installe[r]Sha256 -eq \$previous\.pin\.installer\.sha256/);
  assert.doesNotMatch(source, /Authorization\s*=|GH_TOKEN|GITHUB_TOKEN/, 'public asset checks must not acquire credentials');
});

test('actual PowerShell validators reject changed assets, altered manifests, tampering and path traversal without executing installers', { skip:process.platform !== 'win32' }, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-previous-installer-validators-'));
  try {
    const command = String.raw`
$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
$parseErrors=$null; $tokens=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($env:ZHIKE_TEST_INSTALLER_SCRIPT,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
foreach($name in @('Assert-NoLinks','Get-ManifestPaths','Assert-Payload','Assert-PreviousReleaseMetadata','Assert-PreviousReleaseManifest')) {
  $fn=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
  if(-not $fn){throw "Missing validator: $name"}; . ([scriptblock]::Create($fn.Extent.Text))
}
function Rejected([scriptblock]$Action) { $failed=$false; try{ & $Action }catch{$failed=$true}; if(-not $failed){throw 'Invalid synthetic input unexpectedly passed.'} }
$pin=Get-Content -LiteralPath $env:ZHIKE_TEST_PREVIOUS_PIN -Raw | ConvertFrom-Json
$assets=@(); foreach($entry in @($pin.installer,$pin.manifest)) { $assets += [pscustomobject]@{id=$entry.id;name=$entry.name;size=$entry.bytes;digest=('sha256:'+$entry.sha256);browser_download_url=("https://github.com/$($pin.repository)/releases/download/$($pin.tag)/$($entry.name)")} }
$release=[pscustomobject]@{id=$pin.releaseId;tag_name=$pin.tag;draft=$false;prerelease=$true;assets=$assets}
Assert-PreviousReleaseMetadata $pin $release
$release.id++; Rejected {Assert-PreviousReleaseMetadata $pin $release}; $release.id--
$saved=$assets[0].digest; $assets[0].digest='sha256:changed'; Rejected {Assert-PreviousReleaseMetadata $pin $release}; $assets[0].digest=$saved
$assets[0].size++; Rejected {Assert-PreviousReleaseMetadata $pin $release}; $assets[0].size--
$releaseManifest=[pscustomobject]@{product='Zhike Desktop';version=$pin.version;sourceCommit=$pin.sourceCommit;releaseAsset=$pin.installer.name;bytes=$pin.installer.bytes;sha256=$pin.installer.sha256;releaseGate='passed';signingStatus='unsigned'}
Assert-PreviousReleaseManifest $pin $releaseManifest
$releaseManifest.sourceCommit='0000000000000000000000000000000000000000'; Rejected {Assert-PreviousReleaseManifest $pin $releaseManifest}
$root=$env:ZHIKE_TEST_INSTALLER_FIXTURE_DIR
Set-Content -LiteralPath (Join-Path $root 'Zhike.Desktop.exe') -Value 'SYNTHETIC TEXT ONLY - NEVER EXECUTE' -Encoding utf8
Set-Content -LiteralPath (Join-Path $root 'zhike.ico') -Value 'SYNTHETIC ICON TEXT' -Encoding utf8
$files=@(); foreach($name in @('Zhike.Desktop.exe','zhike.ico')){$file=Get-Item -LiteralPath (Join-Path $root $name);$files += [pscustomobject]@{path=$name;bytes=$file.Length;sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash}}
$bundle=[pscustomobject]@{version=$pin.version;sourceCommit=$pin.sourceCommit;files=$files}
$manifestPath=Join-Path $root 'bundle-manifest.json'; $bundle|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $manifestPath -Encoding utf8
$hash=(Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash; $paths=Get-ManifestPaths $bundle; $shortcutIcon='synthetic-shortcut.ico'
$result=Assert-Payload $root -ExpectedManifest $bundle -ExpectedManifestHash $hash -ExpectedPaths $paths
if($result.manifestFilesVerified -ne 2 -or $result.sourceCommit -ne $pin.sourceCommit){throw 'Payload evidence missing source/hash checks.'}
Add-Content -LiteralPath (Join-Path $root 'Zhike.Desktop.exe') -Value 'TAMPERED'
Rejected { Assert-Payload $root -ExpectedManifest $bundle -ExpectedManifestHash $hash -ExpectedPaths $paths }
$files[0].path='../outside.exe'; Rejected {Get-ManifestPaths $bundle}
'validators passed without executing any installer or registry function'
`;
    const result = spawnSync('pwsh', ['-NoLogo','-NoProfile','-NonInteractive','-Command',command], { encoding:'utf8', windowsHide:true,
      env:{ ...process.env, ZHIKE_TEST_INSTALLER_SCRIPT:script, ZHIKE_TEST_PREVIOUS_PIN:pinPath, ZHIKE_TEST_INSTALLER_FIXTURE_DIR:temporary } });
    assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, /validators passed/);
  } finally { fs.rmSync(temporary, { recursive:true, force:true }); }
});

test('installer entry refuses a local run before creating output or accessing installation state', { skip:process.platform !== 'win32' }, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-installer-refusal-'));
  try {
    const out = path.join(temporary, 'must-not-exist');
    const result = spawnSync('pwsh', ['-NoLogo','-NoProfile','-NonInteractive','-File',script,'-InstallerPath','not-an-installer.exe','-StageDir',temporary,'-OutputDir',out,'-VerifyPreviousReleaseUpgrade'],
      { encoding:'utf8', windowsHide:true, env:{ ...process.env, GITHUB_ACTIONS:'false', RUNNER_ENVIRONMENT:'synthetic-preflight' } });
    assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, /only on a disposable GitHub-hosted Windows runner/);
    assert.equal(fs.existsSync(out), false);
  } finally { fs.rmSync(temporary, { recursive:true, force:true }); }
});
