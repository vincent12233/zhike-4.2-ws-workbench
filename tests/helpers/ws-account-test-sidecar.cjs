'use strict';

const { spawn } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const path = require('node:path');
const { observeSidecarStartup, requestWithStartupDiagnostics } = require('./sidecar-startup-observer.cjs');

async function startServer(dataDir, token) {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const origin = 'http://127.0.0.1:' + port;
  const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
    cwd: path.resolve(__dirname, '../../resources/app'), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token, ZHIKE_PARENT_PID: '' },
  });
  const observation = observeSidecarStartup(child, { secrets: [token] });
  const closed = new Promise(resolve => child.once('close', resolve));
  const headers = { 'content-type': 'application/json', 'x-zhike-api-token': token, origin };
  const request = (route, init = {}) => fetch(origin + route, { ...init, signal: AbortSignal.timeout(5000), headers: { ...headers, ...init.headers } });
  async function stop() {
    if (child.exitCode === null && child.signalCode === null) {
      try { await request('/api/shutdown', { method: 'POST', headers: { 'x-zhike-shutdown-token': token } }); } catch {}
      const timer = setTimeout(() => child.kill(), 2000);
      try { await closed; } finally { clearTimeout(timer); }
    } else await closed;
  }
  try {
    await requestWithStartupDiagnostics(async () => {
      const response = await request('/api/health');
      if (!response.ok) throw new Error('Health probe HTTP ' + response.status);
      await response.arrayBuffer();
    }, observation);
    return { child, request, stop };
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
    throw error;
  }
}

module.exports = { startServer };
