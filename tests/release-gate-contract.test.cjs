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
const version = JSON.parse(read('resources/app/package.json')).version;
const displayVersion = version.split('.').slice(0, 2).join('.');

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
assert.match(installer, /staged UI title is not Horizon Atelier \$displayVersion/);
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
assert.match(installer, /modules\\home-6\.css/);
const paletteArtwork = ['atelier-dawn.svg', 'horizon-flow-6.png'];
const homeArtwork = [...paletteArtwork, 'horizon-ridge-6.png', 'horizon-topline-6.png', 'horizon-rock-6.png'];
for (const artwork of homeArtwork) {
  assert.ok(bundle.includes('assets\\' + artwork), 'bundle must require ' + artwork);
  assert.ok(installer.includes('resources\\app\\assets\\' + artwork), 'installer must require ' + artwork);
}

if (process.platform === 'win32') {
  const powershell = `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  const parse = childProcess.spawnSync(powershell, [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "$ErrorActionPreference='Stop'; [void][scriptblock]::Create(([IO.File]::ReadAllText($env:ZHIKE_BUNDLE_SCRIPT)).TrimStart([char]0xFEFF)); [void][scriptblock]::Create(([IO.File]::ReadAllText($env:ZHIKE_INSTALLER_SCRIPT)).TrimStart([char]0xFEFF))",
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
    // These source inputs exercise only the build preflight. The project and
    // release sources are deliberately absent, so no SDK or publish runs.
    const sourceFixture = path.join(tempRoot, 'source-preflight');
    const fixtureScript = path.join(sourceFixture, 'scripts/build-winui-bundle.ps1');
    const fixtureSdk = path.join(sourceFixture, '.tools/dotnet10/dotnet.exe');
    const fixtureNode = path.join(sourceFixture, 'resources/app/node.exe');
    fs.mkdirSync(path.dirname(fixtureScript), { recursive: true });
    fs.mkdirSync(path.dirname(fixtureSdk), { recursive: true });
    fs.mkdirSync(path.dirname(fixtureNode), { recursive: true });
    fs.copyFileSync(path.join(repo, 'scripts/build-winui-bundle.ps1'), fixtureScript);
    fs.writeFileSync(fixtureSdk, 'preflight fixture only');
    const runBundlePreflight = () => childProcess.spawnSync(powershell, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fixtureScript,
    ], { encoding: 'utf8' });
    const missingBundleNode = runBundlePreflight();
    assert.notEqual(missingBundleNode.status, 0);
    assert.match(missingBundleNode.stdout + '\n' + missingBundleNode.stderr, /Bundled Node executable is missing/);
    assert.equal(fs.existsSync(path.join(sourceFixture, 'work')), false, 'source runtime preflight must not create a stage');

    // Presence-only fixture. The launcher inside a real package must instead
    // be the separately prepared executable, and is never started by this test.
    fs.writeFileSync(fixtureNode, 'preflight fixture only');
    const presentBundleNode = runBundlePreflight();
    assert.notEqual(presentBundleNode.status, 0);
    assert.match(presentBundleNode.stdout + '\n' + presentBundleNode.stderr, /release source is incomplete/);

    // The official preflight must accept the same source artwork graph the app ships.
    // The icon remains absent, so these cases stop before staging or SDK execution.
    for (const relative of [
      'resources/app/package.json', 'resources/app/server.mjs', 'resources/app/index.html',
      'resources/app/modules/design-system.css',
      'resources/app/modules/horizon-atelier.css', 'resources/app/modules/home-6.css',
      'resources/app/modules/design-system.css', 'desktop/src/Zhike.Desktop/Zhike.Desktop.csproj',
      'zhike-desktop-setup.iss', ...homeArtwork.map(file => 'resources/app/assets/' + file),
    ]) {
      const destination = path.join(sourceFixture, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(repo, relative), destination);
    }
    const shippedSource = runBundlePreflight();
    assert.notEqual(shippedSource.status, 0);
    assert.match(shippedSource.stdout + '\n' + shippedSource.stderr, /missing WinUI application icon/);
    assert.equal(fs.existsSync(path.join(sourceFixture, 'work')), false);
    fs.unlinkSync(path.join(sourceFixture, 'resources/app/assets/atelier-dawn.svg'));
    const missingDawnSource = runBundlePreflight();
    assert.notEqual(missingDawnSource.status, 0);
    assert.match(missingDawnSource.stdout + '\n' + missingDawnSource.stderr, /release home artwork is missing:[\s\S]*atelier-dawn\.svg/);

    const stage = path.join(tempRoot, 'old-stage');
    const output = path.join(tempRoot, 'output');
    const requiredFiles = [
      'Zhike.Desktop.exe',
      'resources/app/index.html',
      'resources/app/app.js',
      'resources/app/styles.css',
      'resources/app/server.mjs',
      'resources/app/node.exe',
      'resources/app/assets/zhike-horizon-logo.png',
      ...homeArtwork.map(file => 'resources/app/assets/' + file),
      'resources/app/modules/design-system.css',
      'resources/app/modules/horizon-atelier.css',
      'resources/app/modules/business-6.css',
      'resources/app/modules/operations-6.css',
      'resources/app/modules/global-6.css',
      'resources/app/modules/home-6.css',
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
      version,
      '-ReleaseGate',
      '-SkipWebView2Check',
      '-AllowUnsigned',
    ], { encoding: 'utf8' });

    const stageNode = path.join(stage, 'resources/app/node.exe');
    fs.unlinkSync(stageNode);
    const missingInstallerNode = runInstallerGate();
    assert.notEqual(missingInstallerNode.status, 0);
    assert.match(missingInstallerNode.stdout + '\n' + missingInstallerNode.stderr, /WinUI stage is missing required file:[\s\S]*node\.exe/);
    fs.writeFileSync(stageNode, 'release-gate-fixture');

    const staleStage = runInstallerGate();
    const staleOutput = `${staleStage.stdout}\n${staleStage.stderr}`;
    assert.notEqual(staleStage.status, 0, 'a 5.x stage must never be accepted as the current release');
    assert.match(staleOutput, /staged bundle version mismatch/);
    fs.writeFileSync(manifestPath, JSON.stringify({ version: '6.0.3', releaseGate: 'passed', sourceWorktreeDirty: false, files: [] }));
    const historicalStage = runInstallerGate();
    assert.notEqual(historicalStage.status, 0, 'the historical 6.0.3 stage cannot be published as the current candidate');
    assert.match(`${historicalStage.stdout}\n${historicalStage.stderr}`, /staged bundle version mismatch/);

    fs.writeFileSync(manifestPath, JSON.stringify({
      version,
      releaseGate: 'development-snapshot',
      sourceWorktreeDirty: true,
      files: [],
    }));
    const developmentStage = runInstallerGate();
    const developmentOutput = `${developmentStage.stdout}\n${developmentStage.stderr}`;
    assert.notEqual(developmentStage.status, 0, 'a development snapshot must not be publishable through the release gate');
    assert.match(developmentOutput, /release gate rejected this stage/);

    const currentHead = childProcess.execFileSync('git', ['-C', repo, 'rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' }).trim();
    fs.writeFileSync(path.join(stage, 'resources/app/index.html'), `<title>知客 ${displayVersion} · Horizon Atelier</title><link href="design-system.css"><link href="horizon-atelier.css"><link href="home-6.css"><link href="scroll-system.css"><span> &middot; v${version}<!-- ZHIKE_BUILD_VERSION --></span>`);
    for (const sheet of ['home-6.css', 'design-system.css']) {
      fs.copyFileSync(path.join(repo, 'resources/app/modules', sheet), path.join(stage, 'resources/app/modules', sheet));
    }
    const staticRoutes = ['/modules/design-system.css', '/modules/horizon-atelier.css', '/modules/home-6.css', ...homeArtwork.map(file => '/assets/' + file)];
    fs.writeFileSync(path.join(stage, 'resources/app/server.mjs'), `const APP_VERSION = '${version}'; const assets = [${staticRoutes.map(route => "'" + route + "'").join(', ')}];`);
    const manifestFiles = requiredFiles.map(relative => {
      const payload = fs.readFileSync(path.join(stage, ...relative.split('/')));
      return { path: relative, bytes: payload.length, sha256: crypto.createHash('sha256').update(payload).digest('hex').toUpperCase() };
    });

    fs.writeFileSync(manifestPath, JSON.stringify({
      version, releaseGate: 'passed', sourceWorktreeDirty: false,
      sourceCommit: '0000000000000000000000000000000000000000', files: manifestFiles,
    }));
    const oldCommitStage = runInstallerGate();
    assert.notEqual(oldCommitStage.status, 0, 'a same-version stage from another commit must be rejected');
    assert.match(`${oldCommitStage.stdout}\n${oldCommitStage.stderr}`, /staged source commit mismatch/);

    fs.writeFileSync(manifestPath, JSON.stringify({
      version, releaseGate: 'passed', sourceWorktreeDirty: false,
      sourceCommit: currentHead, files: [...manifestFiles, { ...manifestFiles[0] }],
    }));
    const duplicateManifestStage = runInstallerGate();
    assert.notEqual(duplicateManifestStage.status, 0, 'duplicate manifest paths must be rejected');
    assert.match(`${duplicateManifestStage.stdout}\n${duplicateManifestStage.stderr}`, /bundle manifest contains a duplicate path/);

    fs.writeFileSync(manifestPath, JSON.stringify({
      version, releaseGate: 'passed', sourceWorktreeDirty: false,
      sourceCommit: currentHead, files: manifestFiles,
    }));
    for (const artwork of paletteArtwork) {
      const artworkPath = path.join(stage, 'resources/app/assets', artwork);
      fs.unlinkSync(artworkPath);
      const missingArtworkStage = runInstallerGate();
      assert.notEqual(missingArtworkStage.status, 0, 'installer must reject a stage without ' + artwork);
      assert.match(missingArtworkStage.stdout + '\n' + missingArtworkStage.stderr, /WinUI stage is missing required file/);
      fs.writeFileSync(artworkPath, 'release-gate-fixture');
    }
    const palettePath = path.join(stage, 'resources/app/modules/design-system.css');
    const paletteCss = fs.readFileSync(palettePath, 'utf8');
    fs.writeFileSync(palettePath, paletteCss.replace('atelier-dawn.svg', 'retired-artwork.svg'));
    const mismatchedArtwork = runInstallerGate();
    assert.notEqual(mismatchedArtwork.status, 0);
    assert.match(mismatchedArtwork.stdout + '\n' + mismatchedArtwork.stderr, /staged palette stylesheet is missing artwork reference: atelier-dawn\.svg/);
    fs.writeFileSync(palettePath, paletteCss);
    fs.writeFileSync(path.join(stage, 'retired-runtime.bin'), 'must-not-ship');
    const unmanifestedStage = runInstallerGate();
    assert.notEqual(unmanifestedStage.status, 0, 'unmanifested stage debris must be rejected');
    assert.match(`${unmanifestedStage.stdout}\n${unmanifestedStage.stderr}`, /WinUI stage contains an unmanifested file/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

console.log('release gate contract: development snapshots remain possible; publishable bundles reject dirty, stale or mixed-version resources');
