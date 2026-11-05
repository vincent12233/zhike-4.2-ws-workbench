const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const installer = path.resolve(__dirname, '..', 'releases', '知客-4.2-WS工作台版.exe');
assert(existsSync(installer), `installer not found: ${installer}`);
const root = mkdtempSync(path.join(os.tmpdir(), 'zhike-ws-installer-'));
const target = path.join(root, 'installed');
const run = file => execFileSync(file, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CLOSEAPPLICATIONS', `/DIR=${target}`], { windowsHide: true, timeout: 180000, stdio: 'ignore' });
try {
  run(installer);
  const appRoot = path.join(target, 'resources', 'app');
  assert(existsSync(path.join(target, '知客离线工作台.exe')));
  const manifest = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.version, '4.2.0');
  for (const asset of ['migrations/005-ws-workbench.sql', 'modules/ws-workbench-core.js', 'modules/ws-workbench.js', 'modules/ws-workbench.css', 'ws-preload.cjs']) {
    assert(existsSync(path.join(appRoot, asset)), `missing installed asset ${asset}`);
  }
  const data = path.join(appRoot, 'data');
  mkdirSync(data, { recursive: true });
  const marker = path.join(data, 'isolated-user-marker.txt');
  writeFileSync(marker, 'keep-user-data', 'utf8');
  run(installer);
  assert.equal(readFileSync(marker, 'utf8'), 'keep-user-data', 'overlay install removed user data');
  const uninstaller = path.join(target, 'unins000.exe');
  assert(existsSync(uninstaller));
  execFileSync(uninstaller, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], { windowsHide: true, timeout: 180000, stdio: 'ignore' });
  assert(!existsSync(path.join(target, '知客离线工作台.exe')));
  assert.equal(readFileSync(marker, 'utf8'), 'keep-user-data', 'uninstall removed user data');
  console.log('ws installer QA: isolated install, overlay upgrade, WS assets, uninstall and user-data retention passed');
} finally {
  for (let i = 0; i < 12; i++) {
    try { rmSync(root, { recursive: true, force: true }); break; }
    catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); }
  }
}
