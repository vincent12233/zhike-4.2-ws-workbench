'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { createHash, randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { runIsolatedWebView, recordNativeVisualAssertions, assertNativeLifecycle } = require('./helpers/isolated-webview-runner.cjs');

const repo = path.resolve(__dirname, '..');
const evidenceDirectory = path.join(repo, '.tools/native-renderer/controlled-fixture');
const viewport = { width: 640, height: 480 };
const tempParent = path.resolve(os.tmpdir());
const rootPrefix = 'zhike-native-fixture-';
const hostSource = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs'), 'utf8');
const loginScript = hostSource.match(/private const string WsLoginProbeScript = """\s*([\s\S]*?)\s*""";/)?.[1];
assert.ok(loginScript, 'Run the native login detector against local real-WebView2 documents');
const loginScenes = [
  ['<div data-ref="unrelated"></div>', { login: false, problem: false }],
  ['<div data-ref="pairing"><canvas></canvas></div>', { login: true }],
  ['<canvas aria-label="扫描二维码"></canvas>', { login: true }],
  ['<p>Link with phone number</p>', { login: true, problem: false }],
  ['<p>Update your browser</p>', { login: false, problem: true }],
  ['<div id="pane-side">扫码 / update your browser / synthetic message</div>', { chat: true }],
];

function readOptions() {
  const [option, count, ...extra] = process.argv.slice(2);
  if (option === undefined) return { repeat: 1, network: true };
  if (option === '--network-only' && count === undefined) return { repeat: 0, network: true };
  assert.ok(option === '--repeat-normal' && /^[1-5]$/.test(count ?? '') && !extra.length,
    'Use --repeat-normal 1..5 or --network-only');
  return { repeat: Number(count), network: false };
}

function fixtureHtml(id, networkUrl) {
  const probe = networkUrl ? `
      const external = document.createElement('script');
      external.src = ${JSON.stringify(networkUrl)};
      external.onload = () => collect('loaded');
      external.onerror = () => collect('blocked');
      document.head.append(external);
  ` : 'collect(null);';
  return `<!doctype html>
<meta charset="utf-8">
<style>#sample { width: 137px; height: 29px; background: rgb(12, 34, 56); }</style>
<div id="sample"></div><pre id="result" hidden></pre>
<script>
  function collect(network) {
    const sample = document.getElementById('sample');
    const bounds = sample.getBoundingClientRect();
    const loginResults = ${JSON.stringify(loginScenes.map(([markup]) => markup))}.map(markup => {
      sample.innerHTML = markup;
      const probe = () => { return ${loginScript} };
      return JSON.parse(probe());
    });
    sample.replaceChildren();
    document.getElementById('result').textContent = JSON.stringify([{
      viewport: { width: innerWidth, height: innerHeight },
      fixtureId: ${JSON.stringify(id)},
      queryId: new URLSearchParams(location.search).get('case'),
      box: { width: bounds.width, height: bounds.height, background: getComputedStyle(sample).backgroundColor },
      network,
      loginResults,
      remoteScriptExecuted: window.__syntheticWireScript === true
    }]);
  }
  ${probe}
</script>`;
}

function verifyLifecycle(metadata, host) {
  assert.equal(metadata.mode, 'real-webview2-synthetic-layout');
  assert.equal(metadata.status, 'Passed');
  assert.equal(metadata.timeoutMs, 30000);
  assert.equal(metadata.navigation.succeeded, true);
  assert.ok(metadata.navigation.id);
  assert.equal(metadata.resultCases, 1);
  assert.deepEqual(metadata.exit, { code: 0, signal: null });
  assert.equal(metadata.streamsClosed, true);
  assert.equal(metadata.cleanupSafe, true);
  assert.equal(metadata.forceTerminated, false);
  assert.ok(metadata.identities.some(row => row.pid === metadata.browserPid && row.startedTicks));
  assert.ok(metadata.identities.some(row => row.pid === metadata.pid && row.startedTicks));
  assertNativeLifecycle(metadata);
  for (const [key, file] of [
    ['exeSha256', host],
    ['dllSha256', path.join(path.dirname(host), 'IsolatedWebViewHost.dll')],
    ['runtimeConfigSha256', path.join(path.dirname(host), 'IsolatedWebViewHost.runtimeconfig.json')],
  ]) {
    const expected = fs.statSync(file, { throwIfNoEntry: false })?.isFile()
      ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
    assert.equal(metadata.hostBuild[key], expected, 'Record only the fingerprint of the actual renderer binary: ' + key);
  }
}

async function runFixture(host, kind, network) {
  const fixtureId = randomUUID();
  const root = fs.mkdtempSync(path.join(tempParent, rootPrefix));
  let cleanupSafe = true;
  try {
    const fixture = path.join(root, 'matrix.html');
    fs.writeFileSync(fixture, fixtureHtml(fixtureId, network?.url), { flag: 'wx' });
    const url = pathToFileURL(fixture);
    url.searchParams.set('case', fixtureId);

    cleanupSafe = false;
    const { results, metadata } = await runIsolatedWebView({
      host, root, url: url.href, viewport, expectedViewports: [viewport], evidenceDirectory,
    });
    cleanupSafe = metadata.cleanupSafe;
    verifyLifecycle(metadata, host);
    assert.deepEqual(results, [{
      viewport, fixtureId, queryId: fixtureId,
      box: { width: 137, height: 29, background: 'rgb(12, 34, 56)' },
      loginResults: loginScenes.map(([, expected]) => expected),
      network: network ? 'blocked' : null, remoteScriptExecuted: false,
    }]);
    if (network) assert.deepEqual(network.observed, { connections: 0, requests: 0 });
    recordNativeVisualAssertions(metadata);
    console.log(JSON.stringify({
      kind, status: metadata.status, invocation: metadata.invocation, renderer: metadata.mode,
      elapsedMs: metadata.elapsedMs, browserPid: metadata.browserPid, cleanupSafe: metadata.cleanupSafe,
      networkConnections: network?.observed.connections,
    }));
  } catch (error) {
    if (error.cleanupSafe === true) cleanupSafe = true;
    throw error;
  } finally {
    if (cleanupSafe) {
      const resolved = path.resolve(root);
      assert.equal(path.dirname(resolved), tempParent);
      assert.ok(path.basename(resolved).startsWith(rootPrefix) && !fs.lstatSync(resolved).isSymbolicLink());
      fs.rmSync(resolved, { recursive: true, maxRetries: 5, retryDelay: 100 });
    } else {
      console.error('Retained unverified test fixture: ' + path.basename(root));
    }
  }
}

async function runNetworkFixture(host) {
  // Loopback represents a forbidden network URL and detects even a TCP connection.
  const observed = { connections: 0, requests: 0 };
  const server = http.createServer((_, response) => {
    observed.requests++;
    response.writeHead(200, { 'Content-Type': 'application/javascript' });
    response.end('window.__syntheticWireScript = true;');
  });
  server.on('connection', () => { observed.connections++; });
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  try {
    const url = 'http://127.0.0.1:' + server.address().port + '/forbidden-' + randomUUID() + '.js';
    await runFixture(host, 'blocked-network-resource', { url, observed });
  } finally {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  }
}

async function main() {
  assert.equal(process.platform, 'win32', 'Windows and the current real WebView2 host are required');
  const host = process.env.ZHIKE_TEST_WEBVIEW_HOST;
  assert.ok(host && path.isAbsolute(host) && fs.statSync(host).isFile(),
    'Pass the fresh host executable explicitly in ZHIKE_TEST_WEBVIEW_HOST');
  const { repeat, network } = readOptions();
  for (let index = 0; index < repeat; index++) {
    await runFixture(host, 'normal-' + (index + 1));
  }
  if (network) await runNetworkFixture(host);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
