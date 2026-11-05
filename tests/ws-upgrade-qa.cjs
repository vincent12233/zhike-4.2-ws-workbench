const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const oldInstaller = process.env.ZHIKE_OLD_INSTALLER || path.resolve(__dirname, '..', 'releases', '知客-4.1-全面增强版.exe');
const newInstaller = process.env.ZHIKE_INSTALLER
  || ['知客-4.2.1-WS工作台完善版.exe', '知客-4.2-WS工作台版.exe']
    .map(name => path.resolve(__dirname, '..', 'releases', name))
    .find(existsSync);
assert(existsSync(newInstaller), `new installer not found: ${newInstaller}`);
if (!existsSync(oldInstaller)) {
  console.log(`SKIP ws upgrade QA: set ZHIKE_OLD_INSTALLER to a verified 4.1.3 installer (missing: ${oldInstaller})`);
  process.exit(0);
}
const root = mkdtempSync(path.join(os.tmpdir(), 'zhike-ws-upgrade-'));
const target = path.join(root, 'installed');
const run = file => execFileSync(file, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CLOSEAPPLICATIONS', `/DIR=${target}`], { windowsHide: true, timeout: 180000, stdio: 'ignore' });
try {
  run(oldInstaller);
  const appRoot = path.join(target, 'resources', 'app');
  assert.equal(JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version, '4.1.3');
  const legacyData = path.join(appRoot, 'data');
  mkdirSync(legacyData, { recursive: true });
  const legacyMarker = path.join(legacyData, 'legacy-user-db.marker');
  writeFileSync(legacyMarker, 'legacy-data', 'utf8');
  const externalData = path.join(root, 'portable-user-data');
  mkdirSync(externalData, { recursive: true });
  const externalMarker = path.join(externalData, 'workspace.sqlite');
  writeFileSync(externalMarker, 'portable-data', 'utf8');
  run(newInstaller);
  const installedVersion = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version;
  if (process.env.ZHIKE_EXPECTED_VERSION) assert.equal(installedVersion, process.env.ZHIKE_EXPECTED_VERSION);
  else assert(/^4\.2(?:\.|$)/.test(installedVersion), `unexpected upgraded version: ${installedVersion}`);
  assert.equal(readFileSync(legacyMarker, 'utf8'), 'legacy-data');
  assert.equal(readFileSync(externalMarker, 'utf8'), 'portable-data');
  execFileSync(path.join(target, 'unins000.exe'), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], { windowsHide: true, timeout: 180000, stdio: 'ignore' });
  assert.equal(readFileSync(externalMarker, 'utf8'), 'portable-data');
  console.log(`ws upgrade QA: isolated 4.1.3→${installedVersion} upgrade, legacy marker and external user data preserved`);
} finally {
  for (let i = 0; i < 12; i++) {
    try { rmSync(root, { recursive: true, force: true }); break; }
    catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); }
  }
}
