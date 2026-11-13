'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const exists = relative => fs.existsSync(path.join(repo, relative));
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');

for (const relative of [
  'infra', 'server', 'connectors/ws-worker', 'scripts/build-server-bundle.ps1',
  'scripts/build-installer.ps1', 'zhike-setup.iss', 'resources/app/main.cjs',
  'resources/app/preload.cjs', 'resources/app/ws-preload.cjs', 'tools/sqlite-to-postgres',
]) assert.equal(exists(relative), false, `obsolete production path remains: ${relative}`);

const packageJson = JSON.parse(read('resources/app/package.json'));
assert.equal(packageJson.main, undefined, 'resource package must not expose an Electron entrypoint');
assert.equal(packageJson.zhikeRuntime.host, 'WinUI 3 + WebView2');
assert.equal(packageJson.zhikeRuntime.storage, 'SQLite');
assert.doesNotMatch(JSON.stringify(packageJson), /electron|docker|postgres/i, 'resource metadata must be local-only');

const bundle = read('scripts/build-winui-bundle.ps1');
const installer = read('scripts/build-winui-installer.ps1');
const setup = read('zhike-desktop-setup.iss');
assert.match(bundle, /local-desktop-deployment\.md/);
assert.match(bundle, /local-desktop-troubleshooting\.md/);
// The source-archive scrubber may mention retired paths as deny-list entries;
// only the executable build section must remain free of legacy invocations.
const activeBundleSection = bundle.split('$sourceArchiveExcludedPrefixes')[0];
assert.doesNotMatch(activeBundleSection, /build-server-bundle|server-version-deployment|compose\.yaml/i);
assert.match(setup, /ZhikeNative/);
assert.doesNotMatch(installer, /zhike-setup|build-installer\.ps1|electron/i);

// The formal delivery folder may contain only the current 6.0 product. Retired
// installers and source bundles must not remain in outputs/ or releases/.
const currentOutput = path.join(repo, 'outputs', '知客-6.0.0-WinUI桌面版');
if (fs.existsSync(currentOutput)) {
  const names = fs.readdirSync(currentOutput);
  assert.equal(names.some(name => /docker|postgres|electron/i.test(name)), false,
    'current 6.0.0 delivery folder must not contain retired Docker/PostgreSQL/Electron artifacts');
  const sourceZip = path.join(currentOutput, '知客-6.0.0-完整源码.zip');
  if (fs.existsSync(sourceZip)) {
    const listing = spawnSync('tar', ['-tf', sourceZip], { encoding: 'utf8', windowsHide: true });
    assert.equal(listing.status, 0, `unable to inspect source archive: ${listing.stderr || 'tar failed'}`);
    const retiredEntries = String(listing.stdout || '').split(/\r?\n/).filter(entry =>
      /(^|\/)(infra|server|connectors\/ws-worker|tools\/sqlite-to-postgres)(\/|$)|(^|\/)resources\/app\/(main|preload|ws-preload)\.cjs$/i.test(entry));
    assert.deepEqual(retiredEntries, [], 'source archive must not ship retired Docker/Electron runtime trees');
  }
  const bundleZip = path.join(currentOutput, '知客-6.0.0-WinUI桌面版-bundle.zip');
  if (fs.existsSync(bundleZip)) {
    const listing = spawnSync('tar', ['-tf', bundleZip], { encoding: 'utf8', windowsHide: true });
    assert.equal(listing.status, 0, `unable to inspect WinUI bundle: ${listing.stderr || 'tar failed'}`);
    const retiredEntries = String(listing.stdout || '').split(/\r?\n/).filter(entry =>
      /(^|\/)(infra|server|connectors\/ws-worker|tools\/sqlite-to-postgres)(\/|$)|(^|\/)resources\/app\/(main|preload|ws-preload)\.cjs$/i.test(entry));
    assert.deepEqual(retiredEntries, [], 'WinUI bundle must not ship retired Docker/Electron runtime trees');
  }
}

console.log('docker/electron removal contract passed: local WinUI + SQLite is the only production path');
