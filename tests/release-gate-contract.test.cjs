'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const bundle = read('scripts/build-winui-bundle.ps1');
const installer = read('scripts/build-winui-installer.ps1');

assert.match(bundle, /\[switch\]\$ReleaseGate/);
assert.match(bundle, /Assert-SourceReleaseContract/);
assert.match(bundle, /package\.json=\$packageVersion expected=\$Version/);
assert.match(bundle, /server\.mjs expected \$Version/);
assert.match(bundle, /scroll-system\.css must remain the final interaction layer after Horizon Atelier/);
assert.match(bundle, /release gate rejected a dirty worktree/);
assert.match(bundle, /releaseGate = if \(\$ReleaseGate\) \{ 'passed' \} else \{ 'development-snapshot' \}/);
assert.ok(
  bundle.indexOf('release gate rejected a dirty worktree') < bundle.indexOf('Remove-Item -LiteralPath $out -Recurse -Force'),
  'the formal release gate must fail before clearing or rebuilding the stage',
);

assert.match(installer, /\[switch\]\$ReleaseGate/);
assert.match(installer, /manifestGate/);
assert.match(installer, /release gate rejected this stage/);
assert.match(installer, /staged UI title is not Horizon Atelier 6\.0/);
assert.match(installer, /Assert-ManifestFileHash/);
assert.match(installer, /bundle file hash mismatch/);
assert.match(installer, /bundle file size mismatch/);
assert.match(installer, /\$manifestEntries = @\(\$bundleManifest\.files\)[\s\S]*foreach \(\$entry in \$manifestEntries\)/, 'installer must verify every staged manifest file, not a small allow-list');
assert.match(installer, /staged source commit mismatch/, 'formal installer must reject a stage built from an older commit of the same version');
assert.match(installer, /bundle manifest contains a duplicate path/);
assert.match(installer, /WinUI stage contains an unmanifested file/);
assert.match(installer, /actualStageFiles\.Count -ne \$manifestPaths\.Count/);
assert.match(installer, /signedEntry\.bytes = \$signedExecutable\.Length[\s\S]*signedEntry\.sha256/, 'signing must refresh the staged manifest');
assert.match(installer, /modules\\horizon-atelier\.css/);

if (process.platform === 'win32') {
  const powershell = `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  const parse = childProcess.spawnSync(powershell, [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "$ErrorActionPreference='Stop'; [void][scriptblock]::Create([IO.File]::ReadAllText($env:ZHIKE_BUNDLE_SCRIPT)); [void][scriptblock]::Create([IO.File]::ReadAllText($env:ZHIKE_INSTALLER_SCRIPT))",
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ZHIKE_BUNDLE_SCRIPT: path.join(repo, 'scripts', 'build-winui-bundle.ps1'),
      ZHIKE_INSTALLER_SCRIPT: path.join(repo, 'scripts', 'build-winui-installer.ps1'),
    },
  });
  assert.equal(parse.status, 0, `PowerShell packaging scripts must parse:\n${parse.stdout}\n${parse.stderr}`);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-release-gate-'));
  try {
    const stage = path.join(tempRoot, 'old-stage');
    const output = path.join(tempRoot, 'output');
    const requiredFiles = [
      'Zhike.Desktop.exe',
      'resources/app/index.html',
      'resources/app/app.js',
      'resources/app/styles.css',
      'resources/app/server.mjs',
      'resources/app/assets/zhike-horizon-logo.png',
      'resources/app/modules/horizon-atelier.css',
      'resources/app/modules/business-6.css',
      'resources/app/modules/operations-6.css',
      'resources/app/modules/global-6.css',
      'resources/app/modules/scroll-system.css',
      'resources/app/vendor/xlsx/xlsx.js',
      'zhike.ico',
    ];
    for (const relative of requiredFiles) {
      const target = path.join(stage, ...relative.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, 'release-gate-fixture');
    }
    const manifestPath = path.join(stage, 'bundle-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({
      version: '5.3.6',
      releaseGate: 'passed',
      sourceWorktreeDirty: false,
      files: [],
    }));
    const runInstallerGate = () => childProcess.spawnSync(powershell, [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(repo, 'scripts', 'build-winui-installer.ps1'),
      '-StageDir',
      stage,
      '-OutputDir',
      output,
      '-AppVersion',
      '6.0.0',
      '-ReleaseGate',
      '-SkipWebView2Check',
      '-AllowUnsigned',
    ], { encoding: 'utf8' });

    const staleStage = runInstallerGate();
    const staleOutput = `${staleStage.stdout}\n${staleStage.stderr}`;
    assert.notEqual(staleStage.status, 0, 'a 5.x stage must never be accepted as a 6.0 release');
    assert.match(staleOutput, /staged bundle version mismatch/);

    fs.writeFileSync(manifestPath, JSON.stringify({
      version: '6.0.0',
      releaseGate: 'development-snapshot',
      sourceWorktreeDirty: true,
      files: [],
    }));
    const developmentStage = runInstallerGate();
    const developmentOutput = `${developmentStage.stdout}\n${developmentStage.stderr}`;
    assert.notEqual(developmentStage.status, 0, 'a development snapshot must not be publishable through the release gate');
    assert.match(developmentOutput, /release gate rejected this stage/);

    const currentHead = childProcess.execFileSync('git', ['-C', repo, 'rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' }).trim();
    fs.writeFileSync(path.join(stage, 'resources/app/index.html'), '<title>知客 6.0 · Horizon Atelier</title><link href="horizon-atelier.css"><link href="scroll-system.css"><span> &middot; v6.0.0<!-- ZHIKE_BUILD_VERSION --></span>');
    fs.writeFileSync(path.join(stage, 'resources/app/server.mjs'), "const APP_VERSION = '6.0.0'; const assets = ['/modules/horizon-atelier.css'];");
    const manifestFiles = requiredFiles.map(relative => {
      const payload = fs.readFileSync(path.join(stage, ...relative.split('/')));
      return { path: relative, bytes: payload.length, sha256: crypto.createHash('sha256').update(payload).digest('hex').toUpperCase() };
    });

    fs.writeFileSync(manifestPath, JSON.stringify({
      version: '6.0.0', releaseGate: 'passed', sourceWorktreeDirty: false,
      sourceCommit: '0000000000000000000000000000000000000000', files: manifestFiles,
    }));
    const oldCommitStage = runInstallerGate();
    assert.notEqual(oldCommitStage.status, 0, 'a same-version stage from another commit must be rejected');
    assert.match(`${oldCommitStage.stdout}\n${oldCommitStage.stderr}`, /staged source commit mismatch/);

    fs.writeFileSync(manifestPath, JSON.stringify({
      version: '6.0.0', releaseGate: 'passed', sourceWorktreeDirty: false,
      sourceCommit: currentHead, files: [...manifestFiles, { ...manifestFiles[0] }],
    }));
    const duplicateManifestStage = runInstallerGate();
    assert.notEqual(duplicateManifestStage.status, 0, 'duplicate manifest paths must be rejected');
    assert.match(`${duplicateManifestStage.stdout}\n${duplicateManifestStage.stderr}`, /bundle manifest contains a duplicate path/);

    fs.writeFileSync(manifestPath, JSON.stringify({
      version: '6.0.0', releaseGate: 'passed', sourceWorktreeDirty: false,
      sourceCommit: currentHead, files: manifestFiles,
    }));
    fs.writeFileSync(path.join(stage, 'retired-runtime.bin'), 'must-not-ship');
    const unmanifestedStage = runInstallerGate();
    assert.notEqual(unmanifestedStage.status, 0, 'unmanifested stage debris must be rejected');
    assert.match(`${unmanifestedStage.stdout}\n${unmanifestedStage.stderr}`, /WinUI stage contains an unmanifested file/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

console.log('release gate contract: development snapshots remain possible; publishable 6.0 bundles reject dirty, stale or mixed-version resources');
