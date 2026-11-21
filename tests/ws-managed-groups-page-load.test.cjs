'use strict';

// V9.2 managed-group page load path through a real isolated sidecar.
//
//   node tests/ws-managed-groups-page-load.test.cjs                 # source tree
//   node tests/ws-managed-groups-page-load.test.cjs <app root>      # packaged resources/app
//
// It checks the HTML reference, that the sidecar serves the module with a
// JavaScript MIME type and the exact packaged bytes, that the static allowlist
// stays exact (no server-side module, no traversal), that the served bytes
// register the page module and render the three business fields from the real
// API, that an API failure is shown in place, that the view is registered in
// the workbench and the native allowlists, and that every other asset
// index.html references still loads.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const repo = path.resolve(__dirname, '..');
const appRoot = path.resolve(process.argv[2] || path.join(repo, 'resources/app'));
const packaged = Boolean(process.argv[2]);
const MODULE = '/modules/ws-managed-groups-ui.js';
const token = 'mg-page-load-' + 'x'.repeat(24);

function nodeBinary() {
  if (process.env.ZHIKE_TEST_NODE && fs.existsSync(process.env.ZHIKE_TEST_NODE)) return process.env.ZHIKE_TEST_NODE;
  const bundled = path.join(appRoot, 'node.exe');
  if (packaged && process.platform === 'win32' && fs.existsSync(bundled)) return bundled;
  return process.execPath;
}

async function freePort() {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const { port } = socket.address();
  await new Promise(resolve => socket.close(resolve));
  return port;
}

// Raw request so the path reaches the sidecar exactly as written (fetch would
// normalise dot segments before sending).
function raw(port, requestPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: requestPath, method: 'GET', headers: { host: '127.0.0.1:' + port, ...headers } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, type: String(res.headers['content-type'] || ''), body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('request timeout ' + requestPath)));
    req.end();
  });
}

async function startSidecar(dataDir) {
  const port = await freePort();
  const origin = 'http://127.0.0.1:' + port;
  const child = spawn(nodeBinary(), ['server.mjs'], {
    cwd: appRoot, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token, ZHIKE_PARENT_PID: '' },
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
  const closed = new Promise(resolve => child.once('close', resolve));
  const deadline = Date.now() + 30000;
  for (;;) {
    if (child.exitCode !== null) throw new Error('sidecar exited during startup: ' + stderr);
    try { if ((await raw(port, '/api/health')).status === 200) break; } catch {}
    if (Date.now() > deadline) { child.kill(); throw new Error('sidecar did not become healthy: ' + stderr); }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  async function stop() {
    if (child.exitCode === null && child.signalCode === null) {
      try { await fetch(origin + '/api/shutdown', { method: 'POST', headers: { 'x-zhike-api-token': token, 'x-zhike-shutdown-token': token, origin } }); } catch {}
      const timer = setTimeout(() => child.kill(), 3000);
      try { await closed; } finally { clearTimeout(timer); }
    }
  }
  return { port, origin, stop };
}

// Same contract as the workbench api(): resolve with the parsed body, reject
// with the sidecar's message on a non-2xx reply.
function workbenchApi(origin, apiToken) {
  return async (pathname, init = {}) => {
    const url = new URL(pathname, origin);
    url.searchParams.set('accountId', 'mg-page-load');
    const response = await fetch(url, { ...init, headers: { 'content-type': 'application/json', 'x-zhike-api-token': apiToken, origin, ...(init.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'WS 本机数据服务暂不可用。');
    return body;
  };
}

function loadServedModule(source) {
  const window = {};
  vm.runInNewContext(source, { window, document: { querySelector: () => null }, setTimeout: () => 0, console }, { filename: MODULE });
  return window.ZhikeWsManagedGroups;
}

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(true); console.log('PASS ' + name); }
  catch (error) { results.push(false); console.log('FAIL ' + name + ' :: ' + (error.stack || error.message)); }
}

(async () => {
  const index = fs.readFileSync(path.join(appRoot, 'index.html'), 'utf8');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-mg-page-load-'));
  const sidecar = await startSidecar(dataDir);
  let served = null;
  try {
    await check('1. index.html references the managed-group module and the file exists', () => {
      assert.match(index, /<script src="\.\/modules\/ws-managed-groups-ui\.js"><\/script>/);
      assert.ok(fs.statSync(path.join(appRoot, 'modules/ws-managed-groups-ui.js')).isFile());
    });
    await check('2-3. the sidecar serves the exact module bytes as JavaScript', async () => {
      served = await raw(sidecar.port, MODULE);
      assert.equal(served.status, 200);
      assert.equal(served.type, 'text/javascript; charset=utf-8');
      assert.ok(served.body.equals(fs.readFileSync(path.join(appRoot, 'modules/ws-managed-groups-ui.js'))), 'served bytes must equal the file on disk');
    });
    await check('the static allowlist stays exact: server modules, traversal and other files are refused', async () => {
      for (const blocked of ['/modules/ws-managed-groups-core.cjs', '/server.mjs', '/modules/%2e%2e/server.mjs', '/modules/../server.mjs', '/migrations/035-ws-managed-groups.sql', '/modules/ws-managed-groups-ui.js.map']) {
        const response = await raw(sidecar.port, blocked);
        assert.equal(response.status, 404, blocked + ' must not be served');
      }
    });
    await check('4-5. the served bytes register the page module and render the three fields from the real API', async () => {
      assert.ok(served?.status === 200, 'module must be served first');
      const api = workbenchApi(sidecar.origin, token);
      const created = await api('/api/ws/managed-groups', { method: 'POST', body: JSON.stringify({ channel: 'FB群粉', groupName: '页面加载群', groupAlias: 'PL-101' }) });
      assert.equal(created.group.groupAlias, 'PL-101');
      const module = loadServedModule(served.body.toString('utf8'));
      assert.equal(typeof module?.create, 'function', 'window.ZhikeWsManagedGroups.create must be registered');
      let redraws = 0;
      const page = module.create({ getScope: () => ({ accountId: 'mg-page-load' }), request: api, redraw: () => { redraws += 1; }, toast() {}, getCustomers: () => [] });
      assert.equal(await page.load(), true, 'load must succeed against the real sidecar');
      assert.ok(redraws > 0);
      const html = page.render();
      for (const field of ['channel', 'groupName', 'groupAlias']) assert.match(html, new RegExp('name="' + field + '"'));
      for (const label of ['渠道', '群名', '群别名']) assert.ok(html.includes(label), label);
      assert.doesNotMatch(html, /name="(?:jid|assistant)"|负责助理/);
      assert.ok(html.includes('PL-101') && html.includes('页面加载群'), 'the created group is listed');
    });
    await check('9. an API failure is shown in place, not as a blank page', async () => {
      const module = loadServedModule(served.body.toString('utf8'));
      const page = module.create({ getScope: () => ({ accountId: 'mg-page-load' }), request: workbenchApi(sidecar.origin, 'wrong-token-' + 'y'.repeat(20)), redraw() {}, toast() {}, getCustomers: () => [] });
      assert.equal(await page.load(), false);
      const html = page.render();
      assert.match(html, /role="alert"[^>]*>[^<]*本机会话已失效/, 'the sidecar error must be visible');
      assert.match(html, /data-mg-form/, 'the form stays on the page');
    });
    await check('6. the view is registered in the workbench and in both native allowlists', () => {
      const workbench = fs.readFileSync(path.join(appRoot, 'modules/ws-workbench.js'), 'utf8');
      assert.match(workbench, /dedicated: new Set\(\[[^\]]*'managed-groups'/);
      assert.match(workbench, /\{ id: 'managed-groups', label: '群组管理'/);
      const nativeSource = path.join(repo, 'desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs');
      const nativeBinary = path.join(appRoot, '..', '..', 'Zhike.Desktop.dll');
      if (packaged && fs.existsSync(nativeBinary)) {
        // Packaged: the compiled host must carry the view name (UTF-16 string literal).
        assert.ok(fs.readFileSync(nativeBinary).includes(Buffer.from('managed-groups', 'utf16le')), 'packaged Zhike.Desktop.dll must allow managed-groups');
      } else {
        const source = fs.readFileSync(nativeSource, 'utf8');
        const lists = source.match(/"overview" or "accounts" or "chat" or "groups" or "group-channels" or "managed-groups" or "members"/g) || [];
        assert.equal(lists.length, 2, 'both native view allowlists must include managed-groups');
      }
    });
    await check('10. every other asset index.html references still loads with its type', async () => {
      const refs = [...index.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="\.\/([^"#?]+)"/g)].map(match => '/' + match[1]);
      assert.ok(refs.length > 40, 'index.html asset references');
      const types = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
      for (const ref of refs) {
        const response = await raw(sidecar.port, ref);
        assert.equal(response.status, 200, ref);
        const expected = types[path.extname(ref)];
        if (expected) assert.equal(response.type, expected, ref);
      }
    });
  } finally {
    await sidecar.stop();
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  const passed = results.filter(Boolean).length;
  console.log(`Managed-group page load (${packaged ? 'packaged ' + appRoot : 'source'}): ${passed}/${results.length}`);
  if (passed !== results.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
