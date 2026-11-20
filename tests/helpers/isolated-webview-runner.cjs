'use strict';
// Actual shipping WebView2 engine, in a test-only HWND/STA controller process.
// This is CSS fixture acceptance, not the product WinUI lifecycle acceptance.
// Reuses the strict process owner and PNG checks; no product bridge or service.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { runProcessLifecycle, validateEdgeOptions, writeScreenshotPng } = require('./isolated-edge-runner.cjs');

const repo = path.resolve(__dirname, '../..');
const defaultHost = path.join(repo, '.tools/isolated-webview-host/IsolatedWebViewHost.exe');
const failure = (code, message) => Object.assign(new Error(message), { code, phase: 'webview-host' });
const MAX_OUTPUT = 64 * 1024 * 1024;
const HOST_TIMEOUT_MS = 30000;

function hostMessages() {
  let offset = 0;
  let closeArmed = false;
  let aborting = false;
  const messages = new Map();
  return {
    read(output, kind) {
      assert.ok(Buffer.byteLength(output) <= MAX_OUTPUT, 'Native renderer output is bounded');
      let end;
      while ((end = output.indexOf('\n', offset)) !== -1) {
        const line = output.slice(offset, end).trim(); offset = end + 1;
        if (!line) continue;
        let value;
        try { value = JSON.parse(line); }
        catch { throw failure('HOST_PROTOCOL_INVALID', 'Native renderer returned invalid JSON'); }
        assert.ok(value && ['ready', 'result', 'closed', 'error'].includes(value.kind), 'Only the isolated renderer protocol is accepted');
        assert.ok(!messages.has(value.kind), 'Each native renderer phase must occur exactly once');
        if (value.kind === 'result') assert.ok(messages.has('ready'), 'Result must follow native initialization');
        if (value.kind === 'closed') {
          assert.ok(messages.has('ready'), 'Close must belong to the initialized Core');
          assert.ok(closeArmed && (messages.has('result') || aborting), 'Close must follow the verified result and an explicit close request');
        }
        messages.set(value.kind, value);
      }
      const error = messages.get('error');
      if (error) throw failure('HOST_RENDER_FAILED', 'Native renderer failed: ' + String(error.code || 'UNSPECIFIED').slice(0, 80));
      return messages.get(kind);
    },
    armClose(output, abort = false) {
      this.read(output, 'result');
      assert.ok((messages.has('result') || abort) && !closeArmed, 'Close is armed once after the result or an explicit failure');
      aborting = abort;
      closeArmed = true;
    },
    finish(output) {
      this.read(output, 'closed');
      assert.equal(output.slice(offset).trim(), '', 'Native protocol cannot end with an incomplete message');
      assert.ok(messages.has('closed'), 'Native protocol must terminate with a verified close');
    },
  };
}

function validateResult(value, expectedViewports, targetUrl, viewport) {
  assert.ok(value.navigation?.succeeded === true && value.navigation.id && new URL(value.navigation.url).href === targetUrl.href,
    'Result requires this exact successful native navigation');
  assert.ok(typeof value.value === 'string' && Buffer.byteLength(value.value) <= 32 * 1024 * 1024, 'Native matrix JSON must be bounded');
  const results = JSON.parse(value.value);
  assert.ok(Array.isArray(results));
  assert.equal(results.length, expectedViewports.length, 'Every real renderer case must complete');
  assert.deepEqual(results.map(row => row.viewport), expectedViewports, 'Native result viewports must exactly match the original cases');
  assert.deepEqual(value.viewport, viewport || { width: 1280, height: 720 }, 'The actual Core viewport must match its requested CSS size');
  return results;
}

function assertNativeLifecycle(metadata) {
  assert.equal(metadata.timeoutMs, HOST_TIMEOUT_MS, 'Native lifecycle requires the shared 30-second deadline');
  const names = metadata.events.map(event => event.event);
  const requireEvent = (name, after) => {
    const index = names.indexOf(name);
    assert.ok(index > after && index === names.lastIndexOf(name), 'Native owned lifecycle must complete once in order: ' + name);
    return index;
  };
  let closeRequest = -1;
  for (const name of ['webview-core-ready', 'result-verified', 'result-ready', 'close-requested', 'webview-close-requested']) {
    closeRequest = requireEvent(name, closeRequest);
  }
  // Node can deliver the process exit before it drains the final stdout record.
  const coreExit = requireEvent('webview-browser-exited', closeRequest);
  const hostExit = requireEvent('process-exit', closeRequest);
  requireEvent('streams-close', Math.max(coreExit, hostExit));
  assert.equal(metadata.streamsClosed, true, 'Both renderer output streams must actually close');
  assert.deepEqual(metadata.exit, { code: 0, signal: null }, 'Native host must exit normally');
  assert.ok(metadata.events[hostExit].code === 0 && metadata.events[hostExit].signal === null, 'Observed host exit must be normal');
  assert.ok(metadata.events[coreExit].normal === true && metadata.events[coreExit].browserPid === metadata.browserPid,
    'The exact Core browser must report Normal BrowserProcessExited');
}

function fingerprintHostBuild(host) {
  const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const siblingSha256 = name => {
    const file = path.join(path.dirname(host), name);
    return fs.statSync(file, { throwIfNoEntry: false })?.isFile() ? sha256(file) : null;
  };
  return {
    exeSha256: sha256(host),
    dllSha256: siblingSha256('IsolatedWebViewHost.dll'),
    runtimeConfigSha256: siblingSha256('IsolatedWebViewHost.runtimeconfig.json'),
  };
}

async function runIsolatedWebView(options) {
  assert.equal(process.platform, 'win32', 'Actual Windows WebView2 is required');
  const host = options.host || process.env.ZHIKE_TEST_WEBVIEW_HOST || defaultHost;
  assert.ok(fs.existsSync(host), 'Build tests/native/IsolatedWebViewHost before native renderer acceptance');
  // Shared validation accepts an explicit executable; it does not start Edge.
  const { root, targetUrl, expectedViewports, viewport, screenshotPath, evidenceDirectory } = validateEdgeOptions({ ...options, edge: host });
  const hostBuild = fingerprintHostBuild(host);
  const profile = path.join(root, 'webview-profile-' + randomUUID());
  const requestPath = path.join(root, 'webview-request-' + randomUUID() + '.json');
  const request = { root, profile, assetRoot: path.join(repo, 'resources/app'), targetUrl: targetUrl.href,
    viewport: viewport || { width: 1280, height: 720 }, screenshotPath: screenshotPath || null };
  fs.writeFileSync(requestPath, JSON.stringify(request), { flag: 'wx', mode: 0o600 });
  const protocol = hostMessages();
  let ready;
  let normalCoreExit = false;
  const output = await runProcessLifecycle({
    command: host, args: ['--request', requestPath], root, profile,
    mode: 'real-webview2-synthetic-layout', timeoutMs: HOST_TIMEOUT_MS, maxOutputBytes: MAX_OUTPUT, evidenceDirectory,
    observerDotnet: process.env.ZHIKE_EDGE_OBSERVER_DOTNET,
    async readResult(context) {
      ready = await context.wait(context.waitForOutput(text => protocol.read(text, 'ready')), 'webview-core-ready');
      assert.equal(ready.hostBackend, 'win32-controller', 'Only the freshly built controller host can supply this result');
      context.metadata.hostBackend = ready.hostBackend;
      assert.ok(Number.isSafeInteger(ready.browserPid) && ready.browserPid > 0 && ready.browserPid !== context.child.pid);
      // Hosted Windows agents can expose %TEMP% through its DOS 8.3 alias.
      // Compare the OS-resolved directory identities inside this invocation.
      const expectedProfile = path.join(fs.realpathSync.native(root), path.basename(profile));
      assert.ok(!fs.lstatSync(profile).isSymbolicLink(), 'Temporary profile must be a regular directory');
      assert.equal(fs.realpathSync.native(ready.profile).toLowerCase(), expectedProfile.toLowerCase(), 'Only the exclusive temporary profile may be used');
      assert.ok(typeof ready.runtimeVersion === 'string' && ready.runtimeVersion.length < 160);
      assert.ok(Array.isArray(ready.processIds) && ready.processIds.includes(ready.browserPid), 'The owning Core browser must be observed');
      const identities = await context.observeProcessIds(ready.processIds);
      assert.ok(identities.some(identity => identity.pid === ready.browserPid), 'Native browser PID must have a verified creation identity');
      context.metadata.browserPid = ready.browserPid; context.metadata.runtimeVersion = ready.runtimeVersion;
      context.mark('webview-core-ready');
      const value = await context.wait(context.waitForOutput(text => protocol.read(text, 'result')), 'webview-render-result');
      const results = validateResult(value, expectedViewports, targetUrl, viewport);
      context.metadata.navigation = { id: value.navigation.id, succeeded: true };
      context.metadata.viewport = value.viewport;
      context.metadata.resultCases = results.length;
      context.metadata.resultBytes = Buffer.byteLength(value.value);
      context.metadata.resultSha256 = createHash('sha256').update(value.value).digest('hex');
      context.stageResultEvidence(value.value);
      context.mark('result-verified', { cases: results.length });
      if (screenshotPath) {
        context.metadata.screenshot = writeScreenshotPng({ evidenceDirectory, screenshotPath, data: value.screenshotData, viewport });
        context.mark('screenshot-written', { width: viewport.width, height: viewport.height });
      }
      assert.ok(Array.isArray(value.processIds) && value.processIds.includes(ready.browserPid));
      await context.observeProcessIds(value.processIds);
      return results;
    },
    async requestClose(context) {
      // Failed rendering still retires this owned host; it can never clear the original failure.
      protocol.armClose(context.stdout, !context.metadata.resultReady);
      context.mark('webview-close-requested');
      context.child.stdin.write(JSON.stringify({ command: 'close' }) + '\n');
      const closed = await context.wait(context.waitForOutput(text => protocol.read(text, 'closed')), 'webview-browser-exited', true);
      assert.ok(ready && closed.normal === true && closed.browserPid === ready.browserPid,
        'The exact Core browser must report Normal BrowserProcessExited; an ACK alone cannot pass');
      context.mark('webview-browser-exited', { normal: true, browserPid: closed.browserPid });
      normalCoreExit = true;
      context.child.stdin.end();
      return { acknowledgement: 'webview-browser-exited-normal' };
    },
    dispose(context) {
      context.metadata.hostBuild = hostBuild;
      if (!normalCoreExit) context.metadata.cleanupSafe = false;
      if (!context.metadata.resultReady) return;
      protocol.finish(context.stdout);
      assertNativeLifecycle(context.metadata);
      assert.equal(path.dirname(context.metadata.profile), root);
    },
  });
  return { results: output.result, metadata: output.metadata };
}

function recordNativeVisualAssertions(metadata) {
  assert.equal(metadata.status, 'Passed');
  const entry = { event: 'page-assertions-complete', invocation: metadata.invocation,
    renderer: metadata.mode, elapsedMs: performance.now() - metadata.startedMonotonicMs };
  fs.writeFileSync(metadata.evidenceFile.replace(/\.json$/, '.assertions.json'), JSON.stringify(entry) + '\n', { flag: 'wx' });
}

module.exports = { runIsolatedWebView, recordNativeVisualAssertions, hostMessages, validateResult, assertNativeLifecycle, defaultHost };
