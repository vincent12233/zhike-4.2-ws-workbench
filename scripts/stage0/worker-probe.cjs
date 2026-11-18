'use strict';

// Stage 0 only: isolated Worker/IPC feasibility probe.
// This file never reads the user profile and never connects to a real WS account.
// It starts the existing sidecar in a temporary data directory and a disposable
// loopback worker child process. It is intentionally not production runtime code.

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { createServer } = require('node:http');
const { randomBytes } = require('node:crypto');
const { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const app = path.join(repo, 'resources', 'app');
let tempRoot = null;
const token = `stage0-${process.pid}-${Date.now()}`;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function requestJson(port, pathname, init = {}) {
  const headers = { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) };
  return fetch(`http://127.0.0.1:${port}${pathname}`, { ...init, headers })
    .then(async response => ({ status: response.status, body: await response.json().catch(() => ({})) }));
}

function spawnWorker(statePath, options = {}) {
  const stage0Token = randomBytes(24).toString('hex');
  const child = spawn(process.execPath, [__filename, '--worker', '--state', statePath, '--token', stage0Token, ...(options.crashAfter ? ['--crash-after', String(options.crashAfter)] : [])], {
    cwd: repo,
    windowsHide: true,
    env: { ...process.env, ZHIKE_STAGE0_WORKER: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stage0Token = stage0Token;
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { output += chunk; });
  child.ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`worker did not become ready: ${output}`)), 5000);
    const onData = () => {
      const match = output.match(/READY (\d+)\n/);
      if (!match) return;
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolve(Number(match[1]));
    };
    const onExit = (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`worker exited before ready (${code || signal}): ${output}`));
    };
    child.stdout.on('data', onData);
    child.on('exit', onExit);
  });
  return child;
}

async function stop(child, signal = 'SIGTERM') {
  if (!child || child.exitCode !== null) return;
  child.kill(signal);
  for (let i = 0; i < 80 && child.exitCode === null; i += 1) await wait(25);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    for (let i = 0; i < 80 && child.exitCode === null; i += 1) await wait(25);
  }
  if (child.exitCode === null && process.platform === 'win32' && child.pid) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    for (let i = 0; i < 80 && child.exitCode === null; i += 1) await wait(25);
  }
  if (child.exitCode === null) {
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 5000);
      child.once('close', () => { clearTimeout(timer); resolve(); });
    });
  }
}

async function removeTempRoot() {
  if (!tempRoot) return;
  for (let i = 0; i < 30; i += 1) {
    try { rmSync(tempRoot, { recursive: true, force: true }); } catch {}
    if (!existsSync(tempRoot)) return;
    await wait(100);
  }
  // An empty directory can outlive a just-terminated child briefly on Windows.
  // Leave the path only if the OS still has a live handle after bounded retries.
}

async function waitForSidecar(port) {
  let last;
  for (let i = 0; i < 200; i += 1) {
    try {
      const response = await requestJson(port, '/api/health', { headers: { 'x-zhike-api-token': token } });
      if (response.status === 200) return response.body;
      last = new Error(`sidecar returned ${response.status}`);
    } catch (error) { last = error; }
    await wait(25);
  }
  throw new Error(`sidecar did not become healthy: ${last?.message || 'unknown error'}`);
}

async function runProbe() {
  tempRoot = mkdtempSync(path.join(os.tmpdir(), 'zhike-stage0-'));
  const sidecarPort = await getFreePort();
  const sidecar = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
    cwd: app,
    windowsHide: true,
    env: { ...process.env, ZHIKE_DATA_DIR: tempRoot, ZHIKE_PORT: String(sidecarPort), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token },
    stdio: 'ignore',
  });
  let worker;
  let recoveredWorker;
  try {
    const health = await waitForSidecar(sidecarPort);
    assert.equal(health.ok, true, 'isolated sidecar must start');
    assert.equal(health.storage, 'sqlite', 'stage 0 uses local SQLite');
    assert.ok(existsSync(path.join(tempRoot, 'workspace.sqlite')), 'sidecar must create SQLite in the temporary workspace');

    const statePath = path.join(tempRoot, 'worker-state.json');
    worker = spawnWorker(statePath);
    const workerPort = await worker.ready;
    const unauthorized = await requestJson(workerPort, '/health');
    assert.equal(unauthorized.status, 401, 'worker health must reject missing token');
    const first = await requestJson(workerPort, '/health', { headers: { 'x-stage0-token': worker.stage0Token } });
    assert.equal(first.status, 200);
    assert.equal(first.body.status, 'running');
    assert.equal(first.body.state.restarts, 0);
    await wait(120);
    const second = await requestJson(workerPort, '/health', { headers: { 'x-stage0-token': worker.stage0Token } });
    assert.ok(second.body.heartbeatAt >= first.body.heartbeatAt, 'worker heartbeat must advance');
    assert.ok(Number(second.body.resource.rssBytes) > 0, 'worker must expose bounded resource telemetry');

    await stop(worker, 'SIGKILL');
    assert.ok(worker.exitCode !== null || worker.killed, 'worker must stop after crash signal');
    recoveredWorker = spawnWorker(statePath);
    const recoveredPort = await recoveredWorker.ready;
    const staleToken = await requestJson(recoveredPort, '/health', { headers: { 'x-stage0-token': worker.stage0Token } });
    assert.equal(staleToken.status, 401, 'worker restart must revoke the previous token');
    const recovered = await requestJson(recoveredPort, '/health', { headers: { 'x-stage0-token': recoveredWorker.stage0Token } });
    assert.equal(recovered.body.state.restarts, 1, 'worker must recover persisted restart state');
    const cancel = await requestJson(recoveredPort, '/cancel', { method: 'POST', body: '{}', headers: { 'x-stage0-token': recoveredWorker.stage0Token } });
    assert.equal(cancel.status, 202, 'worker cancellation must be acknowledged');
    for (let i = 0; i < 80 && recoveredWorker.exitCode === null; i += 1) await wait(25);
    assert.equal(recoveredWorker.exitCode, 0, 'cancelled worker must exit cleanly');

    const sidecarAfterWorkerCrash = await waitForSidecar(sidecarPort);
    assert.equal(sidecarAfterWorkerCrash.ok, true, 'sidecar must remain healthy after worker crash/restart');
    assert.ok(existsSync(path.join(tempRoot, 'workspace.sqlite')), 'isolated SQLite workspace must exist');
    const persisted = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(persisted.restarts, 1);
    console.log(JSON.stringify({
      ok: true,
      sidecar: { port: sidecarPort, workspace: tempRoot, storage: sidecarAfterWorkerCrash.storage },
      worker: { dynamicPort: true, heartbeat: true, cancellation: true, crashRecovery: true, resourceTelemetry: true, restarts: persisted.restarts },
      scope: 'isolated-temp-only',
    }));
  } finally {
    await stop(worker);
    await stop(recoveredWorker);
    await stop(sidecar);
    await removeTempRoot();
  }
}

async function runWorker() {
  const args = process.argv.slice(2);
  const statePath = args[args.indexOf('--state') + 1];
  const crashAfter = Number(args.includes('--crash-after') ? args[args.indexOf('--crash-after') + 1] : 0);
  const accessToken = args.includes('--token') ? String(args[args.indexOf('--token') + 1] || '') : '';
  if (!statePath) throw new Error('worker state path is required');
  const existed = existsSync(statePath);
  let state = existed ? JSON.parse(readFileSync(statePath, 'utf8')) : { restarts: 0 };
  state.restarts = Number(state.restarts || 0) + (existed ? 1 : 0);
  if (!existed) writeFileSync(statePath, JSON.stringify(state));
  const startedAt = Date.now();
  const server = createServer(async (req, res) => {
    if ((req.url === '/health' || req.url === '/cancel') && req.headers['x-stage0-token'] !== accessToken) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      const resource = process.resourceUsage();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'running', heartbeatAt: Date.now(), state, resource: { rssBytes: process.memoryUsage().rss, userCpuMicros: resource.userCPUTime, systemCpuMicros: resource.systemCPUTime } }));
      return;
    }
    if (req.method === 'POST' && req.url === '/cancel') {
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, status: 'cancelling' }));
      setImmediate(() => server.close(() => process.exit(0)));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(0, '127.0.0.1', () => {
    writeFileSync(statePath, JSON.stringify({ restarts: state.restarts, lastHeartbeatAt: Date.now() }));
    process.stdout.write(`READY ${server.address().port}\n`);
  });
  const heartbeat = setInterval(() => {
    if (crashAfter && Date.now() - startedAt >= crashAfter) process.kill(process.pid, 'SIGKILL');
    writeFileSync(statePath, JSON.stringify({ restarts: state.restarts, lastHeartbeatAt: Date.now() }));
  }, 50);
  const cleanup = () => { clearInterval(heartbeat); try { server.close(); } catch {} };
  process.once('SIGTERM', () => { cleanup(); process.exit(0); });
  process.once('SIGINT', () => { cleanup(); process.exit(0); });
}

if (process.argv.includes('--worker')) runWorker().catch(error => { console.error(error); process.exit(1); });
else runProbe().catch(error => { console.error(error); process.exitCode = 1; });

