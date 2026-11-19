'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const app = read('resources/app/app.js');
const server = read('resources/app/server.mjs');
const desktop = read('desktop/src/Zhike.Desktop/App.xaml.cs');
const setup = read('zhike-desktop-setup.iss');

for (const source of [app, server]) {
  assert.doesNotMatch(source, /\/api\/local-migration\//, '6.0 must expose no local/Docker migration endpoint');
  assert.doesNotMatch(source, /\/api\/import\/legacy\//, '6.0 must expose no legacy SQLite import endpoint');
  assert.doesNotMatch(source, /migrateLegacyLocalStateIfNeeded|localMigrationMarker|docker-export|legacy-export/);
}
assert.doesNotMatch(server, /local_migrations|localFirstMigration|convertLegacy|openLegacy|pendingImportTimer/);
assert.equal(fs.existsSync(path.join(repo, 'resources/app/modules/local-first-migration.js')), false);
assert.equal(fs.existsSync(path.join(repo, 'resources/app/migrations/012-local-first-migration.sql')), false);
assert.equal(fs.existsSync(path.join(repo, 'resources/app/migrate-data.cjs')), false,
  '6.0 must not ship an unused old-database migration executable');
assert.doesNotMatch(read('scripts/build-winui-bundle.ps1'), /^\s*'migrate-data\.cjs'\s*,?\s*$/m,
  'the formal bundle allow-list must not reintroduce the retired migration executable');
assert.match(app, /const stored\s*=\s*null/,
  '6.0 startup must ignore any old WebView localStorage business state');
assert.doesNotMatch(app, /zhike-offline-crm-v1|localStorage\.setItem\(dbKey/);
for (const demoValue of ['小王', '李明', '陈助理', 'G018', '助理1351', '本地工作台已准备就绪'])
  assert.doesNotMatch(app, new RegExp(demoValue), `6.0 must not preconfigure demo value: ${demoValue}`);
assert.match(app, /const groupIds\s*=\s*\[\]/);
assert.match(app, /const pages\s*=\s*\[\]/);
assert.match(app, /activities:\s*Array\.isArray\(stored\?\.activities\)\?stored\.activities:\[\]/);
assert.match(desktop, /SpecialFolder\.LocalApplicationData\),\s*"Zhike6"/);
assert.match(desktop, /previous Zhike[\s\S]{0,100}neither read nor deleted/i);
assert.match(setup, /旧版数据目录不会被读取、迁移或删除/);
assert.doesNotMatch(setup, /\[InstallDelete\][\s\S]*Type:\s*filesandordirs;[^\r\n]*\{localappdata\}\\Zhike/i);

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const tempParent = path.resolve(os.tmpdir());
const tempPrefix = 'zhike6-no-legacy-';

async function waitForClose(closed, timeoutMs) {
  let timer;
  try {
    return await Promise.race([closed, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Timed out waiting for the isolated sidecar to close')), timeoutMs);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function removeFixture(root) {
  const resolved = path.resolve(root);
  assert.equal(path.dirname(resolved), tempParent);
  assert.ok(path.basename(resolved).startsWith(tempPrefix) && !fs.lstatSync(resolved).isSymbolicLink());
  for (let attempt = 0; ; attempt++) {
    try {
      fs.rmSync(resolved, { recursive: true });
      return;
    } catch (error) {
      if (attempt === 14 || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error;
      await delay(100);
    }
  }
}

const getPort = () => new Promise((resolve, reject) => {
  const listener = net.createServer();
  listener.once('error', reject);
  listener.listen(0, '127.0.0.1', () => {
    const port = listener.address().port;
    listener.close(error => error ? reject(error) : resolve(port));
  });
});

(async () => {
  const tempRoot = fs.mkdtempSync(path.join(tempParent, tempPrefix));
  const oldRoot = path.join(tempRoot, 'Zhike');
  const newRoot = path.join(tempRoot, 'Zhike6');
  const oldDatabase = path.join(oldRoot, 'workspace.sqlite');
  const lockPath = path.join(newRoot, '.workbench.lock');
  const token = 'no-legacy-runtime-token';
  let child, closed, closeResult, spawnError;
  let removed = false;
  try {
    fs.mkdirSync(oldRoot, { recursive: true });
    fs.writeFileSync(oldDatabase, 'old-workspace-must-remain-byte-identical');
    const before = hash(oldDatabase);
    const port = await getPort();
    const entry = path.join(repo, 'resources/app/server.mjs');
    const args = [entry];
    if (process.argv.includes('--delayed-shutdown')) {
      const preload = path.join(tempRoot, 'delay-graceful-exit.cjs');
      fs.writeFileSync(preload, [
        'const exit = process.exit.bind(process);',
        'process.exit = code => code === 0 ? setTimeout(() => exit(0), 2400) : exit(code);',
      ].join('\n'), { flag: 'wx' });
      args.unshift('--require', preload);
    }
    child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, args, {
      cwd: path.join(repo, 'resources/app'),
      windowsHide: true,
      stdio: 'ignore',
      env: { ...process.env, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token, ZHIKE_DATA_DIR: newRoot },
    });
    closed = new Promise(resolve => child.once('close', (code, signal) => {
      closeResult = { code, signal };
      resolve(closeResult);
    }));
    child.once('error', error => { spawnError = error; });
    let healthy = false;
    for (let attempt = 0; attempt < 1200; attempt++) {
      if (spawnError) throw spawnError;
      if (closeResult) assert.fail('isolated sidecar closed during startup');
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        await response.arrayBuffer();
        healthy = response.ok;
      } catch {}
      if (healthy) break;
      await delay(25);
    }
    assert.equal(healthy, true, 'fresh 6.0 sidecar must start in its isolated root');
    assert.equal(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid, child.pid, 'isolated lock must belong to this fixture child');
    const stateResponse = await fetch(`http://127.0.0.1:${port}/api/state`, { headers: { 'X-Zhike-Api-Token': token } });
    assert.equal(stateResponse.status, 200);
    const state = await stateResponse.json();
    assert.equal(state.initialized, false, 'a fresh 6.0 workspace must not seed an app_state row');
    for (const [collection, rows] of Object.entries(state))
      if (Array.isArray(rows)) assert.equal(rows.length, 0, `fresh 6.0 ${collection} must contain no migrated or demo rows`);
    for (const endpoint of ['/api/local-migration/status', '/api/local-migration/preview', '/api/local-migration/commit', '/api/import/legacy/preview', '/api/import/legacy/commit']) {
      const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
        method: endpoint.endsWith('/status') ? 'GET' : 'POST',
        headers: { 'X-Zhike-Api-Token': token, 'Content-Type': 'application/json' },
        body: endpoint.endsWith('/status') ? undefined : '{}',
      });
      assert.equal(response.status, 404, `${endpoint} must stay retired`);
      await response.arrayBuffer();
    }
    assert.equal(fs.existsSync(path.join(newRoot, 'workspace.sqlite')), true);
    assert.equal(hash(oldDatabase), before, 'old workspace bytes must remain untouched');
    assert.equal(fs.existsSync(oldRoot), true, 'old workspace directory must not be removed');
    const shutdown = await fetch(`http://127.0.0.1:${port}/api/shutdown`, {
      method: 'POST',
      headers: { 'X-Zhike-Api-Token': token, 'X-Zhike-Shutdown-Token': token, Connection: 'close' },
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(shutdown.status, 200, 'the isolated sidecar must accept authenticated shutdown');
    assert.deepEqual(await shutdown.json(), { ok: true });
    assert.deepEqual(await waitForClose(closed, 5000), { code: 0, signal: null },
      'sidecar must exit normally and close its process handles before cleanup');
    assert.equal(fs.existsSync(lockPath), false, 'workspace lock must be released before cleanup');
    await removeFixture(tempRoot);
    removed = true;
  } finally {
    if (closed && !closeResult) {
      try {
        if (child.pid && child.exitCode === null && child.signalCode === null) child.kill();
        await waitForClose(closed, 2000);
      } catch (error) {
        console.error('Isolated sidecar close unverified: ' + error.message);
      }
    }
    if (!removed) console.error('Retained isolated migration evidence: ' + path.basename(tempRoot));
  }
  console.log('no legacy data migration contract: fresh empty runtime, retired APIs, unchanged old data and verified shutdown pass');
})().catch(error => { console.error(error); process.exitCode = 1; });
