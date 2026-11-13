'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
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
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

console.log('release gate contract: development snapshots remain possible; publishable 6.0 bundles reject dirty, stale or mixed-version resources');
