'use strict';
// Test-only process/CDP ownership. Never attaches to an existing browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const { createInterface } = require('node:readline');
const { fileURLToPath } = require('node:url');
const { performance } = require('node:perf_hooks');
const { startWindowsExitObservation } = require('../../scripts/diagnostics/edge-exit-observer/invocation-observer.cjs');

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); promise.catch(() => {}); return { promise, resolve, reject }; };
const failure = (code, message, phase) => Object.assign(new Error(message), { code, phase });
function ownedTempRoot(value) {
  const root = path.resolve(value), parent = path.resolve(os.tmpdir()) + path.sep;
  assert.ok(root.toLowerCase().startsWith(parent.toLowerCase()) && /^zhike-[a-z0-9-]+$/i.test(path.basename(root)), 'An explicit zhike-* temporary test root is required');
  let current = root;
  while (current.length >= parent.length) {
    assert.ok(!fs.lstatSync(current).isSymbolicLink(), 'Reparse/symlink test roots are forbidden');
    current = path.dirname(current);
  }
  return root;
}
function explicitProcessIds(ids) {
  const values = [...new Set(ids.map(Number))];
  assert.ok(values.length && values.length <= 256 && values.every(id => Number.isSafeInteger(id) && id > 0), 'Only explicit observed PIDs can be inspected');
  return values;
}
const windowsPowerShell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
// Get-Process inspects only the explicit PIDs and their OS creation times.
function windowsIdentityRows(list) {
  return "$rows=@();foreach($targetId in @(" + list + ")){try{$p=Get-Process -Id ([int]$targetId) -ErrorAction Stop}catch [Microsoft.PowerShell.Commands.ProcessCommandException]{continue};try{$start=$p.StartTime.ToUniversalTime();$rows+=[pscustomobject]@{pid=$p.Id;startedTicks=$start.Ticks.ToString();startedUtc=$start.ToString('o');source='Windows-StartTime'}}finally{$p.Dispose()}};";
}
function probeIdentities(ids, timeoutMs) {
  const values = explicitProcessIds(ids);
  if (process.platform !== 'win32') {
    return Promise.resolve(values.flatMap(pid => { try { const stat = fs.readFileSync('/proc/' + pid + '/stat', 'utf8'); return [{ pid, startedTicks: stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19], source: 'proc-starttime' }]; } catch (error) { if (error.code === 'ENOENT') return []; throw error; } }));
  }
  const command = "$ErrorActionPreference='Stop';" + windowsIdentityRows(values.join(',')) + 'ConvertTo-Json -InputObject @($rows) -Compress';
  return new Promise((resolve, reject) => execFile(windowsPowerShell, ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, encoding: 'utf8', timeout: Math.max(1, timeoutMs), maxBuffer: 128 * 1024 }, (error, stdout) => {
    if (error) { reject(failure('PROCESS_IDENTITY_UNVERIFIED', 'Process identity query failed: ' + (error.code || error.name), 'identity')); return; }
    try { const rows = JSON.parse(stdout.trim() || '[]'); assert.ok(Array.isArray(rows)); resolve(rows); } catch (error) { reject(failure('PROCESS_IDENTITY_UNVERIFIED', 'Invalid process identity response', 'identity')); }
  }));
}

function startWindowsIdentityProbe(root) {
  // Keep one owned shell for all probes. Starting Windows PowerShell after
  // rendering can consume the same deadline needed for graceful browser exit.
  const command = [
    "$ErrorActionPreference='Stop'",
    'while($null -ne ($identityRequest=[Console]::ReadLine())){',
    'try{',
    windowsIdentityRows("$identityRequest -split ','"),
    '[Console]::WriteLine((ConvertTo-Json -InputObject @($rows) -Compress))',
    "}catch{[Console]::WriteLine('null')}",
    '}',
  ].join('\n');
  const encoded = Buffer.from(command, 'utf16le').toString('base64');
  const child = spawn(windowsPowerShell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const closed = deferred(), actualClose = deferred(), pending = [];
  let probeFailure, stopping = false, closeOutcome;
  const fail = message => {
    probeFailure ||= failure('PROCESS_IDENTITY_UNVERIFIED', message, 'identity');
    for (const request of pending.splice(0)) request.reject(probeFailure);
    return probeFailure;
  };
  lines.on('line', line => {
    const request = pending.shift();
    if (!request) { fail('Unexpected process identity response'); return; }
    try {
      assert.ok(line.length <= 128 * 1024);
      const rows = JSON.parse(line);
      assert.ok(Array.isArray(rows) && rows.every(row => request.ids.includes(row.pid) && /^\d+$/.test(row.startedTicks)));
      request.resolve(rows);
    } catch {
      request.reject(fail('Invalid process identity response'));
    }
  });
  lines.on('error', () => fail('Process identity response stream failed'));
  child.stdin.on('error', () => fail('Process identity request stream failed'));
  child.on('error', () => fail('Process identity query failed to start'));
  child.on('close', (code, signal) => {
    closeOutcome = { code, signal };
    actualClose.resolve(closeOutcome);
    if (probeFailure || !stopping || pending.length || code !== 0 || signal) closed.reject(fail('Process identity query exited unexpectedly'));
    else closed.resolve();
  });
  return {
    pid: child.pid || null,
    actualClose: actualClose.promise,
    get closeOutcome() { return closeOutcome; },
    query(ids) {
      if (probeFailure) return Promise.reject(probeFailure);
      if (stopping) return Promise.reject(failure('PROCESS_IDENTITY_UNVERIFIED', 'Process identity probe is closing', 'identity'));
      const request = { ...deferred(), ids: explicitProcessIds(ids) };
      pending.push(request);
      child.stdin.write(request.ids.join(',') + '\n');
      return request.promise;
    },
    close() {
      stopping = true;
      child.stdin.end();
      return closed.promise;
    },
    requestTermination() {
      const attempted = Boolean(child.pid && !closeOutcome && child.exitCode === null && child.signalCode === null);
      if (!attempted) return { attempted, requested: false };
      // The shell's retained child handle is the only termination target.
      try { return { attempted, requested: child.kill('SIGTERM') }; }
      catch (error) { return { attempted, requested: false, requestError: error.code || error.name }; }
    },
    detach() {
      lines.close();
      child.stdin.destroy();
      child.stdout.destroy();
      child.unref();
    },
  };
}

async function runProcessLifecycle(options) {
  const root = ownedTempRoot(options.root), timeoutMs = Number(options.timeoutMs ?? 30000);
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 30000, 'Lifecycle deadline cannot exceed 30000ms');
  assert.ok(typeof options.readResult === 'function' && typeof options.requestClose === 'function');
  const started = performance.now(), launchedAt = new Date().toISOString(), hardEnd = started + timeoutMs;
  const elapsed = () => performance.now() - started;
  // Reserve part of the same deadline for an orderly close after result errors.
  const workEnd = hardEnd - Math.min(1500, Math.floor(timeoutMs / 4));
  const probeTerminationReserve = Math.min(250, Math.floor(timeoutMs / 16));
  const invocation = Date.now() + '-' + randomUUID();
  const directory = path.resolve(options.evidenceDirectory || path.join(__dirname, '../../.tools/isolated-edge-runner'));
  fs.mkdirSync(directory, { recursive: true });
  const stem = path.join(directory, invocation);
  const metadata = { schemaVersion: 2, invocation, mode: options.mode || 'controlled-child', scope: 'process lifecycle; caller owns layout assertions', status: 'Failed', timeoutMs, launchedAt, timebase: 'node-monotonic-ms', startedMonotonicMs: started, events: [], identities: [], exit: null, streamsClosed: false, forceTerminated: false, cleanupSafe: false };
  if (options.profile) metadata.profile = options.profile;
  const exit = deferred(), close = deferred(), stdoutClosed = deferred(), stderrClosed = deferred(), fatal = deferred(), changed = new Set();
  let stdout = '', stderr = '', child, problem, result, resultEvidence, identityProbe, probeShutdown, kernelObserver;
  let closing = false, stdoutEnded = false;
  let exitObservedAt, closeObservedAt, stdoutClosedAt, stderrClosedAt;
  const mark = (event, detail = {}) => {
    const observedAt = elapsed();
    metadata.events.push({ event, elapsedMs: observedAt, ...detail });
    return observedAt;
  };
  const observedWithinDeadline = time => time !== undefined && time < timeoutMs;
  const noteTimeout = (phase, deadline) => {
    mark('deadline-timeout', { phase, deadlineMs: deadline - started });
    return failure('EDGE_RUNNER_TIMEOUT', 'Isolated lifecycle deadline reached during ' + phase, phase);
  };
  const wait = (promise, phase, duringClose = false, deadline = duringClose ? hardEnd : workEnd) => {
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      // Operation promises are already in flight. Consume later rejections
      // even when there is no time left to await them.
      return Promise.race([Promise.reject(noteTimeout(phase, deadline)), promise]);
    }
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(noteTimeout(phase, deadline)), Math.ceil(remaining)); });
    // A delayed timer callback can lose to an already queued fulfillment
    // after the elapsed deadline, for example when the main thread blocks.
    const timely = Promise.resolve(promise).then(value => {
      if (timer && performance.now() >= deadline) throw noteTimeout(phase, deadline);
      return value;
    });
    return Promise.race(duringClose ? [timely, timeout] : [timely, timeout, fatal.promise]).finally(() => {
      clearTimeout(timer);
      timer = undefined;
    });
  };
  const closeIdentityProbe = async () => {
    try {
      // Preserve the remaining shared budget when a successful browser exit
      // leaves the last identity query near the deadline.
      const closeDeadline = Math.min(hardEnd, Math.max(hardEnd - probeTerminationReserve, performance.now() + probeTerminationReserve));
      await wait(identityProbe.close(), 'identity-probe-close', true, closeDeadline);
      metadata.identityProbeClosed = true;
      mark('identity-probe-closed');
    } catch (error) {
      const termination = identityProbe.requestTermination();
      mark('identity-probe-termination-requested', termination);
      let observedClose = identityProbe.closeOutcome;
      if (!observedClose) {
        try { observedClose = await wait(identityProbe.actualClose, 'identity-probe-termination', true); }
        catch { identityProbe.detach(); }
      }
      metadata.identityProbeTermination = {
        ...termination, observedClose: observedClose || null, status: observedClose ? 'confirmed' : 'unknown',
      };
      mark(observedClose ? 'identity-probe-termination-confirmed' : 'identity-probe-termination-unverified');
      throw error;
    }
  };
  const queryIdentities = async (ids, end, phase) => {
    mark('identity-query-started', { phase, count: ids.length });
    let rows;
    if (process.platform === 'win32') {
      if (!identityProbe) {
        identityProbe = (options.startIdentityProbe || startWindowsIdentityProbe)(root);
        metadata.identityProbePid = identityProbe.pid;
      }
      rows = await identityProbe.query(ids);
    } else {
      rows = await probeIdentities(ids, Math.max(1, Math.ceil(end - performance.now())));
    }
    mark('identity-query-complete', { phase, count: rows.length });
    return rows;
  };
  const context = {
    root, metadata, mark, evidenceStem: stem,
    get child() { return child; }, get stdout() { return stdout; }, get stderr() { return stderr; },
    wait, fail: error => fatal.reject(error),
    stageResultEvidence(bytes) {
      metadata.resultFile = stem + '.result.json';
      resultEvidence = bytes;
    },
    async observeProcessIds(ids) {
      const rows = await wait(queryIdentities(ids, workEnd, 'observation'), 'identity');
      for (const row of rows) {
        const previous = metadata.identities.find(item => item.pid === row.pid);
        if (previous && previous.startedTicks !== row.startedTicks) throw failure('PROCESS_IDENTITY_CHANGED', 'Observed process identity changed', 'identity');
        if (!previous) metadata.identities.push(row);
      }
      return rows;
    },
    waitForOutput(predicate) {
      return new Promise((resolve, reject) => {
        const inspect = () => {
          try {
            const value = predicate(stdout);
            if (value !== undefined) {
              changed.delete(inspect);
              resolve(value);
            } else if (closing && stdoutEnded) {
              throw failure('PROCESS_OUTPUT_EOF', 'Isolated process stdout ended before the close response', 'request-close');
            }
          } catch (error) {
            changed.delete(inspect);
            reject(error);
          }
        };
        changed.add(inspect); inspect();
      });
    },
  };
  try {
    child = spawn(options.command, options.args, { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    metadata.pid = child.pid || null;
    child.on('error', error => fatal.reject(failure('PROCESS_START_FAILED', 'Isolated process failed: ' + error.code, 'spawn')));
    child.stdin.on('error', error => { if (!closing) fatal.reject(failure('PROCESS_STDIN_FAILED', error.code || error.message, 'stdio')); });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    const notifyOutput = () => { for (const listener of [...changed]) listener(); };
    const finishOutput = () => { stdoutEnded = true; notifyOutput(); };
    child.stdout.on('end', finishOutput);
    child.stdout.on('close', () => { stdoutClosedAt = mark('stdout-close'); stdoutClosed.resolve(); finishOutput(); });
    child.stderr.on('close', () => { stderrClosedAt = mark('stderr-close'); stderrClosed.resolve(); });
    child.stdout.on('data', value => { stdout += value; if (Buffer.byteLength(stdout) > (options.maxOutputBytes || 8 * 1024 * 1024)) fatal.reject(failure('OUTPUT_LIMIT', 'Isolated process stdout exceeds the diagnostic bound', 'stdout')); notifyOutput(); });
    child.stderr.on('data', value => { stderr += value; if (Buffer.byteLength(stderr) > 1024 * 1024) fatal.reject(failure('OUTPUT_LIMIT', 'Isolated process stderr exceeds the diagnostic bound', 'stderr')); });
    child.on('exit', (code, signal) => { metadata.exit = { code, signal }; exitObservedAt = mark('process-exit', metadata.exit); exit.resolve(metadata.exit); if (!closing) fatal.reject(failure('PROCESS_EARLY_EXIT', 'Isolated process exited before explicit close', 'process-exit')); });
    child.on('close', (code, signal) => { closeObservedAt = mark('child-close', { code, signal }); close.resolve(); });
    if (!child.pid) throw failure('PROCESS_START_FAILED', 'Isolated process has no PID', 'spawn');
    mark('process-spawned', { pid: child.pid });
    if (options.observerDotnet) {
      try {
        kernelObserver = startWindowsExitObservation({ dotnet: options.observerDotnet, stem, invocation, timeoutMs, elapsed });
        metadata.kernelObserver = { file: kernelObserver.file, pid: kernelObserver.pid };
      } catch (error) {
        metadata.kernelObserver = { error: error.code || error.name };
        mark('kernel-observer-unavailable', metadata.kernelObserver);
      }
    }
    const identities = await context.observeProcessIds([child.pid]);
    const verifiedIdentity = identities.find(row => row.pid === child.pid);
    if (!verifiedIdentity) throw failure('PROCESS_IDENTITY_UNVERIFIED', 'Spawned process identity could not be confirmed', 'identity');
    kernelObserver?.arm(verifiedIdentity);
    mark('identity-confirmed');
    result = await wait(options.readResult(context), 'result');
    metadata.resultReady = true; mark('result-ready');
  } catch (error) { problem = error; }
  finally {
    closing = true; mark('close-requested');
    try { const outcome = await wait(Promise.resolve().then(() => options.requestClose(context)), 'request-close', true); mark('close-request-complete', { acknowledgement: outcome?.acknowledgement || 'requested' }); }
    catch (error) { problem ||= error; mark('close-request-failed', { code: error.code || 'ERROR' }); }
    try {
      // The close protocol can consume its deadline after an actual child exit.
      // Use the event's original timestamp for exit and stream evidence.
      const ended = observedWithinDeadline(exitObservedAt) ? metadata.exit : await wait(exit.promise, 'process-exit', true);
      if (ended.code !== 0 || ended.signal) problem ||= failure('PROCESS_EXIT_NONZERO', 'Isolated process did not exit normally', 'process-exit');
      if (![closeObservedAt, stdoutClosedAt, stderrClosedAt].every(observedWithinDeadline)) {
        await wait(Promise.all([close.promise, stdoutClosed.promise, stderrClosed.promise]), 'streams-close', true);
      }
      metadata.streamsClosed = true; mark('streams-close');
      // The retained ChildProcess has already supplied the actual OS exit and
      // closed streams for its startup-verified identity. Re-querying that PID
      // cannot provide stronger proof than this handle.
      // Other observed processes may outlive it and still require the exact
      // PID + creation-time check under the unchanged overall deadline.
      const verifiedRoot = metadata.identities.some(row => row.pid === child.pid && row.startedTicks);
      if (verifiedRoot) metadata.rootExitProof = 'verified-spawn-handle-exit-and-streams';
      const remainingIds = metadata.identities.filter(row => !verifiedRoot || row.pid !== child.pid).map(row => row.pid);
      const finalQuery = remainingIds.length ? queryIdentities(remainingIds, hardEnd, 'release') : Promise.resolve([]);
      if (identityProbe) {
        // The query writes before close sends EOF. Keep the probe available
        // through actual browser/stream exit, then let its last reply and
        // natural shutdown finish in the same remaining deadline.
        probeShutdown = closeIdentityProbe();
        probeShutdown.catch(() => {});
      }
      const remaining = await wait(finalQuery, 'resource-release', true);
      const alive = remaining.filter(row => metadata.identities.some(known => known.pid === row.pid && known.startedTicks === row.startedTicks));
      metadata.remainingIdentities = alive;
      metadata.cleanupSafe = verifiedRoot && alive.length === 0;
      if (!metadata.cleanupSafe) throw failure('OWNED_PROCESSES_REMAIN', 'Observed isolated processes remain after close', 'resource-release');
    } catch (error) { metadata.releaseFailure = { code: error.code || error.name, phase: error.phase || 'resource-release' }; problem ||= error; }
    const exitObserved = exitObservedAt !== undefined, closeObserved = closeObservedAt !== undefined;
    mark('node-release-state', { exitObserved, closeObserved, stdoutCloseObserved: stdoutClosedAt !== undefined, stderrCloseObserved: stderrClosedAt !== undefined,
      exitCode: child?.exitCode ?? null, signalCode: child?.signalCode ?? null });
    if (!exitObserved && child) {
      // This ChildProcess retains the OS process handle. Never kill by image
      // name or attach to a PID discovered outside this invocation.
      mark('failure-owned-handle-termination-started');
      metadata.forceTerminated = child.kill('SIGTERM'); mark('failure-owned-handle-termination', { requested: metadata.forceTerminated });
    }
    if (!closeObserved && child) { mark('node-stdio-disposal'); child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref(); }
    if (identityProbe) {
      try { await (probeShutdown ||= closeIdentityProbe()); }
      catch (error) {
        problem ||= error;
        metadata.cleanupSafe = false;
        metadata.releaseFailure ||= { code: error.code || error.name, phase: error.phase || 'identity-probe-close' };
      }
    }
    try { await options.dispose?.(context); } catch (error) { problem ||= error; }
    changed.clear();
    metadata.elapsedMs = elapsed();
    metadata.stdoutBytes = Buffer.byteLength(stdout); metadata.stderrBytes = Buffer.byteLength(stderr);
    mark('runner-lifecycle-complete', { cleanupSafe: metadata.cleanupSafe, forceTerminated: metadata.forceTerminated });
    kernelObserver?.finish();
    if (resultEvidence !== undefined) {
      // A slow evidence volume must leave the closing timers and browser
      // entirely outside the raw matrix write, even when the call failed.
      try { await fsp.writeFile(metadata.resultFile, resultEvidence + '\n'); }
      catch (error) {
        metadata.resultEvidenceFailure = { code: error.code || error.name };
        problem ||= failure('RESULT_EVIDENCE_WRITE_FAILED', 'Cannot persist the verified result: ' + metadata.resultEvidenceFailure.code, 'evidence-write');
      }
    }
    if (!problem && metadata.cleanupSafe && metadata.exit?.code === 0 && metadata.streamsClosed) metadata.status = 'Passed';
    if (problem) metadata.failure = { code: problem.code || problem.name, phase: problem.phase || 'assertion', message: String(problem.message).slice(0, 500) };
    mark('runner-final', { status: metadata.status, cleanupSafe: metadata.cleanupSafe, forceTerminated: metadata.forceTerminated });
    const evidenceWrites = [fsp.writeFile(stem + '.json', JSON.stringify(metadata, null, 2) + '\n')];
    if (problem) evidenceWrites.push(fsp.writeFile(stem + '.stdout.log', stdout), fsp.writeFile(stem + '.stderr.log', stderr));
    await Promise.all(evidenceWrites);
    metadata.evidenceFile = stem + '.json';
  }
  if (problem) { problem.metadata = metadata; problem.cleanupSafe = metadata.cleanupSafe; throw problem; }
  return { result, metadata, stdout, stderr };
}

function observeNavigationResources(connection, context) {
  const app = path.resolve(__dirname, '../../resources/app');
  const report = context.metadata.navigationResources = { limit: 512, omitted: 0, requests: [] };
  const pending = new Map();
  const elapsed = () => performance.now() - context.metadata.startedMonotonicMs;
  const resourceLabel = value => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'file:') return '<non-file>';
      const filename = fileURLToPath(url);
      const fixture = path.relative(context.root, filename);
      if (fixture === 'matrix.html' || fixture === 'fixture.html') return '<fixture>/' + fixture;
      const shipped = path.relative(app, filename).split(path.sep).join('/');
      if (/^(?:assets\/|modules\/)?[a-z0-9-]+\.(?:css|png|svg|woff2?)$/i.test(shipped)) return '<app>/' + shipped;
    } catch { /* Only known local fixture and asset labels are collected. */ }
    return '<other>';
  };
  connection.navigationResourceEvent = (method, params) => {
    const { requestId } = params;
    if (typeof requestId !== 'string') return;
    const row = pending.get(requestId);
    if (method === 'Network.requestWillBeSent') {
      const requestedMs = elapsed();
      if (row) {
        row.redirectedMs = requestedMs;
        pending.delete(requestId);
      }
      if (report.requests.length >= report.limit) { report.omitted++; return; }
      const request = { resource: resourceLabel(params.request?.url), requestedMs };
      if (/^[a-f0-9]{32}$/i.test(params.frameId)) request.frameId = params.frameId;
      if (/^[a-f0-9]{32}$/i.test(params.loaderId)) request.loaderId = params.loaderId;
      pending.set(requestId, request);
      report.requests.push(request);
    } else if (row && method === 'Network.responseReceived') {
      row.responseMs = elapsed();
      if (Number.isInteger(params.response?.status)) row.status = params.response.status;
    } else if (row && method === 'Network.loadingFinished') {
      row.finishedMs = elapsed();
      pending.delete(requestId);
    } else if (row && method === 'Network.loadingFailed') {
      row.failedMs = elapsed();
      if (/^net::ERR_[A-Z0-9_]{1,48}$/.test(params.errorText)) row.error = params.errorText;
      pending.delete(requestId);
    }
  };
  return () => {
    connection.navigationResourceEvent = undefined;
    report.captureEndedMs = elapsed();
    report.pendingCount = pending.size;
    pending.clear();
  };
}

class CdpConnection {
  constructor(url, context) {
    this.context = context; this.nextId = 0; this.pending = new Map(); this.events = []; this.listeners = new Set(); this.closing = false;
    this.workPhase = null;
    const opened = deferred(), closed = deferred(); this.opened = opened.promise; this.closed = closed.promise;
    this.socket = new WebSocket(url);
    this.socket.addEventListener('open', () => opened.resolve());
    this.socket.addEventListener('error', () => {
      const error = failure('CDP_CONNECTION_FAILED', 'Isolated CDP connection failed', 'cdp');
      opened.reject(error);
      for (const pending of this.pending.values()) pending.reject(error);
      this.targetDestruction?.reject(error);
      if (!this.closing) context.fail(error);
    });
    this.socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); } catch { context.fail(failure('CDP_INVALID_MESSAGE', 'Invalid CDP response', 'cdp')); return; }
      if (message.id) {
        const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id);
        if (pending.method === 'Page.navigate') {
          this.context.mark('navigation-response-received', { commandId: message.id, loaderId: message.result?.loaderId,
            frameId: message.result?.frameId, protocolError: Boolean(message.error), navigationError: Boolean(message.result?.errorText) });
        } else if (pending.method === 'Browser.close') {
          this.context.mark('browser-close-response-received', { commandId: message.id, protocolError: Boolean(message.error) });
        }
        if (message.error) pending.reject(failure('CDP_COMMAND_FAILED', pending.method + ': ' + message.error.message, 'cdp'));
        else pending.resolve(message.result || {});
      } else {
        const lifecycle = message.params;
        const destruction = this.targetDestruction;
        if (destruction && !destruction.observed && message.method === 'Target.targetDestroyed' &&
            message.sessionId === undefined && lifecycle?.targetId === destruction.targetId) {
          destruction.observed = true;
          this.context.mark('target-destroyed-observed');
          destruction.resolve();
        }
        if (this.navigationSessionId && message.sessionId === this.navigationSessionId) {
          if (this.navigationResourceEvent && message.method?.startsWith('Network.')) {
            if (lifecycle) this.navigationResourceEvent(message.method, lifecycle);
            return;
          }
          if (message.method === 'Page.lifecycleEvent' && ['init', 'DOMContentLoaded', 'load'].includes(lifecycle?.name)) {
            this.context.mark('navigation-lifecycle-received', { name: lifecycle.name, loaderId: lifecycle.loaderId, frameId: lifecycle.frameId });
          } else if (message.method === 'Page.frameStartedLoading' || message.method === 'Page.frameStoppedLoading') {
            this.context.mark('navigation-frame-load', { state: message.method === 'Page.frameStartedLoading' ? 'started' : 'stopped', frameId: lifecycle?.frameId });
          }
        }
        this.events.push(message); if (this.events.length > 200) this.events.shift();
        for (const listener of [...this.listeners]) listener(message);
        if (message.method === 'Runtime.exceptionThrown') context.fail(failure('FIXTURE_SCRIPT_ERROR', 'Isolated fixture raised an unhandled JavaScript exception', 'result'));
      }
    });
    this.socket.addEventListener('close', event => {
      context.mark('cdp-transport-closed', { code: event.code }); closed.resolve();
      const error = failure('CDP_DISCONNECTED', 'CDP disconnected before explicit close', 'cdp');
      for (const pending of this.pending.values()) pending.method === 'Browser.close' && this.closing ? pending.resolve({ peerClosed: true }) : pending.reject(error);
      this.targetDestruction?.reject(error);
      this.pending.clear(); if (!this.closing) context.fail(error);
    });
  }
  async send(method, params = {}, sessionId) {
    await this.context.wait(this.opened, 'cdp-connect', this.closing);
    const id = ++this.nextId, pending = deferred(); pending.method = method; this.pending.set(id, pending);
    this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    if (method === 'Page.navigate') this.context.mark('navigation-request-sent', { commandId: id });
    if (method === 'Browser.close') this.context.mark('browser-close-request-sent', { commandId: id });
    return this.context.wait(pending.promise, method, this.closing);
  }
  async work(phase, operation) {
    this.workPhase = phase;
    this.context.mark('cdp-work-started', { phase });
    const output = await operation();
    this.context.mark('cdp-work-completed', { phase });
    this.workPhase = null;
    return output;
  }
  event(method, predicate, sessionId) {
    const match = value => value.method === method && (!sessionId || value.sessionId === sessionId) && predicate(value.params || {});
    const existing = this.events.find(match); if (existing) return Promise.resolve(existing.params);
    return new Promise(resolve => { const listener = message => { if (match(message)) { this.listeners.delete(listener); resolve(message.params); } }; this.listeners.add(listener); });
  }
  async closeTarget(targetId) {
    assert.ok(!this.targetDestruction, 'Only one owned target may be closed at a time');
    const destroyed = deferred();
    // The event can arrive before the command response. Arm before sending.
    this.targetDestruction = { targetId, ...destroyed };
    try {
      const closed = await this.send('Target.closeTarget', { targetId });
      assert.equal(closed.success, true, 'The exact owned target must acknowledge closure');
      this.context.mark('target-close-acknowledged');
      await this.context.wait(destroyed.promise, 'target-destroyed', true);
    } finally {
      this.targetDestruction = undefined;
    }
  }
  async closeBrowser() {
    this.closing = true;
    const result = await this.send('Browser.close');
    this.context.mark('browser-close-acknowledged', { acknowledgement: result.peerClosed ? 'peer-closed-after-request' : 'protocol-response' });
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.context.mark('cdp-transport-close-requested'); this.socket.close();
    }
    await this.context.wait(this.closed, 'cdp-transport-close', true);
    return { acknowledgement: result.peerClosed ? 'peer-closed-after-request' : 'protocol-response' };
  }
  dispose() {
    this.closing = true;
    this.targetDestruction?.reject(failure('CDP_DISCONNECTED', 'Owned CDP connection disposed during target close', 'cdp'));
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) this.socket.close();
    this.listeners.clear();
  }
}

function plainPath(candidate, leafType) {
  const absolute = path.resolve(candidate); let current = absolute;
  while (true) {
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (stat) {
      assert.ok(!stat.isSymbolicLink(), 'Reparse/symlink evidence paths are forbidden');
      if (current !== absolute || leafType === 'directory') assert.ok(stat.isDirectory(), 'Evidence ancestors must be ordinary directories');
      else if (leafType === 'file') assert.ok(stat.isFile() && stat.nlink === 1, 'Evidence target must be an ordinary unshared file');
    }
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
  return absolute;
}
function viewportValue(value) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Viewport must contain explicit numeric dimensions');
  const { width, height } = value;
  assert.ok(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 33554432, 'Viewport dimensions are invalid or exceed the capture bound');
  return { width, height };
}
function screenshotTarget(evidenceDirectory, screenshotPath) {
  assert.ok(typeof screenshotPath === 'string' && path.isAbsolute(screenshotPath) && !screenshotPath.includes('\0'), 'An explicit absolute screenshot PNG path is required');
  const directory = plainPath(evidenceDirectory, 'directory'), target = path.resolve(screenshotPath), relative = path.relative(directory, target);
  assert.ok(relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep), 'Screenshot must stay within the evidence directory');
  assert.ok(!relative.split(/[\\/]/).some(part => part.includes(':')) && path.extname(target).toLowerCase() === '.png', 'Only ordinary PNG evidence paths are allowed');
  plainPath(target, 'file');
  return target;
}
function validateEdgeOptions(options) {
  assert.ok(options && typeof options === 'object', 'Explicit isolated browser options are required');
  const { edge, url } = options, root = ownedTempRoot(options.root), targetUrl = new URL(url);
  assert.ok(typeof edge === 'string' && path.isAbsolute(edge) && fs.statSync(edge).isFile(), 'An explicit existing browser executable is required');
  assert.equal(targetUrl.protocol, 'file:', 'Only this invocation synthetic file fixture may be opened');
  const fixture = path.resolve(fileURLToPath(targetUrl));
  assert.ok(fixture.toLowerCase().startsWith((root + path.sep).toLowerCase()), 'Fixture must remain under this temporary root');
  plainPath(fixture, 'file'); assert.ok(fs.lstatSync(fixture).isFile(), 'Synthetic fixture must exist');
  assert.ok(Array.isArray(options.expectedViewports) && options.expectedViewports.length > 0 && options.expectedViewports.length <= 32, 'A bounded nonempty expected viewport array is required');
  const expectedViewports = options.expectedViewports.map(viewportValue), viewport = options.viewport === undefined ? undefined : viewportValue(options.viewport);
  const evidenceDirectory = plainPath(options.evidenceDirectory || path.join(__dirname, '../../.tools/isolated-edge-runner'), 'directory');
  assert.ok(!Object.hasOwn(options, 'closeStrategy'), 'Owned resource release has one fixed session-target-browser order');
  let screenshotPath;
  if (options.screenshotPath !== undefined) {
    assert.ok(viewport && expectedViewports.length === 1 && viewport.width === expectedViewports[0].width && viewport.height === expectedViewports[0].height, 'Screenshot requires one matching explicit viewport');
    screenshotPath = screenshotTarget(evidenceDirectory, options.screenshotPath);
  }
  return { edge, root, targetUrl, expectedViewports, viewport, screenshotPath, evidenceDirectory };
}
function writeScreenshotPng({ evidenceDirectory, screenshotPath, data, viewport }) {
  const expected = viewportValue(viewport), target = screenshotTarget(evidenceDirectory, screenshotPath);
  assert.ok(typeof data === 'string' && data.length > 0 && data.length <= 44739244 && data.length % 4 === 0 && /^[a-z0-9+/]*={0,2}$/i.test(data), 'Screenshot must be bounded canonical PNG base64');
  const bytes = Buffer.from(data, 'base64'), signature = Buffer.from([137,80,78,71,13,10,26,10]), ending = Buffer.from([0,0,0,0,73,69,78,68,174,66,96,130]);
  assert.ok(bytes.length >= 45 && bytes.length <= 33554432 && bytes.toString('base64') === data && bytes.subarray(0,8).equals(signature) && bytes.readUInt32BE(8) === 13 && bytes.toString('ascii',12,16) === 'IHDR' && bytes.subarray(-12).equals(ending), 'Screenshot is not a complete PNG');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert.deepEqual({ width, height }, expected, 'PNG dimensions must match the verified viewport');
  const parent = path.dirname(target); fs.mkdirSync(parent, { recursive: true }); screenshotTarget(evidenceDirectory, target);
  const staging = path.join(parent, '.capture-' + randomUUID() + '.png'); let descriptor;
  try {
    descriptor = fs.openSync(staging, 'wx', 0o600); fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); fs.closeSync(descriptor); descriptor = undefined;
    screenshotTarget(evidenceDirectory, target); fs.renameSync(staging, target);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(staging); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { path: target, bytes: bytes.length, width, height, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function isOwnedReadinessWait(error, endpointFile) {
  if (!['ENOENT','EBUSY'].includes(error?.code) || typeof error.path!=='string' || !path.isAbsolute(error.path)) return false;
  const normalize=value=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);
  return normalize(error.path)===normalize(endpointFile);
}
async function waitForOwnedDevToolsEndpoint(profile, context) {
  const ownedProfile=path.resolve(profile);
  assert.equal(ownedProfile,path.resolve(context.metadata.profile),'Readiness can inspect only this invocation profile');
  assert.equal(path.dirname(ownedProfile),path.resolve(context.root),'Readiness profile must be an immediate child of the isolated root');
  assert.match(path.basename(ownedProfile),/^edge-profile-[a-f0-9-]+$/i,'Readiness profile must be generated for this invocation');
  plainPath(ownedProfile,'directory');
  const endpointFile=path.join(ownedProfile,'DevToolsActivePort');
  const counts=context.metadata.devToolsReadiness={polls:0,enoent:0,ebusy:0,partial:0};
  let endpoint;
  while(!endpoint){
    counts.polls++;let content;
    try{content=await fsp.readFile(endpointFile,'utf8')}catch(error){
      if(!isOwnedReadinessWait(error,endpointFile))throw error;
      const key=error.code==='EBUSY'?'ebusy':'enoent';counts[key]++;
      if(counts[key]===1)context.mark('cdp-readiness-wait',{code:error.code});
    }
    if(content){
      const [port,browserPath]=content.trim().split(/\r?\n/);
      if(browserPath){
        assert.ok(/^\d+$/.test(port)&&Number(port)>0&&Number(port)<65536&&/^\/devtools\/browser\/[a-z0-9-]+$/i.test(browserPath),'Invalid isolated CDP endpoint');
        endpoint='ws://127.0.0.1:'+port+browserPath;
      }else counts.partial++;
    }
    if(!endpoint)await context.wait(new Promise(resolve=>setTimeout(resolve,20)),'cdp-ready');
  }
  return endpoint;
}

async function runIsolatedEdge(options) {
  const { edge, root, targetUrl, expectedViewports, viewport, screenshotPath, evidenceDirectory } = validateEdgeOptions(options);
  const profile = path.join(root, 'edge-profile-' + randomUUID()); fs.mkdirSync(profile);
  let connection, ownedTargetId, ownedSessionId, stopResourceObservation;
  const output = await runProcessLifecycle({
    command: edge, args: ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--force-device-scale-factor=1', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--window-size=1280,720', 'about:blank'],
    root, profile, mode: 'real-edge-synthetic-layout', timeoutMs: 30000, evidenceDirectory,
    observerDotnet: process.env.ZHIKE_EDGE_OBSERVER_DOTNET,
    async readResult(context) {
      context.metadata.resourceReleaseOrder = 'owned-session-target-browser';
      const endpoint=await waitForOwnedDevToolsEndpoint(profile,context);
      connection = new CdpConnection(endpoint, context); await context.wait(connection.opened, 'cdp-connect'); context.mark('cdp-ready');
      const observe = async () => {
        const data = await connection.send('SystemInfo.getProcessInfo');
        const ids = data.processInfo.map(row => Number(row.id));
        assert.ok(ids.includes(context.child.pid), 'CDP browser must belong to the newly spawned process');
        await context.observeProcessIds(ids);
      };
      await observe();
      await connection.send('Target.setDiscoverTargets', { discover: true });
      const target = await connection.send('Target.createTarget', { url: 'about:blank' });
      assert.ok(typeof target.targetId === 'string' && target.targetId, 'This invocation must create its own target');
      ownedTargetId = target.targetId;
      context.mark('owned-target-created');
      const attached = await connection.send('Target.attachToTarget', { targetId: target.targetId, flatten: true }), sessionId = attached.sessionId;
      assert.ok(typeof sessionId === 'string' && sessionId, 'Only a session attached to this invocation target may be used');
      ownedSessionId = sessionId;
      connection.navigationSessionId = sessionId;
      context.mark('owned-session-attached');
      await connection.send('Page.enable', {}, sessionId); await connection.send('Runtime.enable', {}, sessionId);
      if (viewport) {
        await connection.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false, screenWidth: viewport.width, screenHeight: viewport.height }, sessionId);
        context.mark('viewport-configured', viewport);
      }
      await connection.send('Page.setLifecycleEventsEnabled', { enabled: true }, sessionId);
      if (process.env.ZHIKE_EDGE_NETWORK_DIAGNOSTICS === '1') {
        await connection.send('Network.enable', {}, sessionId);
        stopResourceObservation = observeNavigationResources(connection, context);
      }
      context.mark('navigation-started');
      const navigation = await connection.work('navigation-response', () => connection.send('Page.navigate', { url: targetUrl.href }, sessionId));
      assert.ok(navigation.loaderId && !navigation.errorText, 'Synthetic file navigation must succeed');
      await connection.work('navigation-load', () => context.wait(
        connection.event('Page.lifecycleEvent', event => event.name === 'load' && event.loaderId === navigation.loaderId, sessionId), 'navigation-load',
      ));
      context.mark('navigation-load-matched', { loaderId: navigation.loaderId, frameId: navigation.frameId });
      if (viewport) {
        const observed = await connection.work('viewport-read', () => connection.send('Runtime.evaluate', {
          expression: '({width:innerWidth,height:innerHeight})', returnByValue: true,
        }, sessionId));
        assert.ok(!observed.exceptionDetails, 'Viewport measurement must succeed');
        assert.deepEqual(observed.result?.value, viewport, 'Actual viewport must match Emulation before reading results');
        context.metadata.viewport = observed.result.value; context.mark('viewport-verified', observed.result.value);
      }
      const expression = '(' + function waitForMatrix() {
        return new Promise(resolve => {
          const complete = () => { const value = document.getElementById('result')?.textContent; if (value) { observer.disconnect(); resolve(value); } };
          const observer = new MutationObserver(complete); observer.observe(document, { childList: true, subtree: true, characterData: true }); complete();
        });
      }.toString() + ')()';
      const evaluated = await connection.work('matrix-result', () => connection.send('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true,
      }, sessionId));
      assert.ok(!evaluated.exceptionDetails && evaluated.result?.type === 'string', 'Synthetic matrix must return its real completed JSON');
      context.mark('result-validation-started');
      const bytes = evaluated.result.value, results = JSON.parse(bytes);
      assert.equal(results.length, expectedViewports.length, 'Every real browser case must finish before close');
      assert.deepEqual(results.map(row => row.viewport), expectedViewports, 'Result viewports must exactly match this invocation cases');
      context.metadata.resultCases = results.length; context.metadata.resultBytes = Buffer.byteLength(bytes); context.metadata.resultSha256 = createHash('sha256').update(bytes).digest('hex');
      context.stageResultEvidence(bytes);
      context.mark('result-verified', { cases: results.length });
      if (screenshotPath) {
        const screenshot = await connection.work('screenshot-capture', () => connection.send('Page.captureScreenshot', {
          format: 'png', fromSurface: true, captureBeyondViewport: false,
        }, sessionId));
        context.metadata.screenshot = writeScreenshotPng({ evidenceDirectory, screenshotPath, data: screenshot.data, viewport });
        await context.wait(Promise.resolve(), 'screenshot-write');
        context.mark('screenshot-written', { bytes: context.metadata.screenshot.bytes, width: viewport.width, height: viewport.height });
      }
      await connection.work('result-process-identities', observe);
      return results;
    },
    requestClose: async context => {
      stopResourceObservation?.();
      if (!connection) throw failure('CDP_NOT_READY', 'No owned CDP connection exists for graceful close', 'request-close');
      if (connection.workPhase) context.mark('cdp-work-pending-at-close', { phase: connection.workPhase });
      // These identifiers came only from this newly created target/session.
      // Protocol failure remains a failed run; it is never a cleanup pass.
      connection.closing = true;
      if (ownedSessionId) {
        await connection.send('Target.detachFromTarget', { sessionId: ownedSessionId });
        ownedSessionId = undefined; context.mark('owned-session-detached');
      }
      if (ownedTargetId) {
        await connection.closeTarget(ownedTargetId);
        ownedTargetId = undefined; context.mark('owned-target-close-confirmed');
      }
      assert.ok(!ownedTargetId && !ownedSessionId, 'All invocation-owned page resources must be released before the browser');
      context.mark('owned-browser-close-requested');
      return connection.closeBrowser();
    },
    dispose: context => {
      connection?.dispose();
      if (context.metadata.resultReady) {
        const names = context.metadata.events.map(event => event.event);
        const ordered = ['owned-target-created', 'owned-session-attached', 'result-verified', 'result-ready', 'close-requested', 'owned-session-detached', 'owned-target-close-confirmed', 'owned-browser-close-requested'];
        let previous = -1;
        for (const name of ordered) {
          const index = names.indexOf(name);
          assert.ok(index > previous && names.lastIndexOf(name) === index, 'Actual owned lifecycle must complete once in order: ' + name);
          previous = index;
        }
        for (const name of ['target-close-acknowledged', 'target-destroyed-observed']) {
          const index = names.indexOf(name);
          assert.ok(index > names.indexOf('owned-session-detached') && index < names.indexOf('owned-target-close-confirmed') &&
            names.lastIndexOf(name) === index, 'Owned release requires the actual target acknowledgement and destruction once: ' + name);
        }
        // Peer closure and OS exit notifications can race with protocol ACKs.
        // Require every real event and the owned request boundary, not one
        // arbitrary cross-channel delivery order.
        for (const name of ['browser-close-acknowledged', 'cdp-transport-closed', 'close-request-complete', 'process-exit', 'streams-close']) assert.ok(names.indexOf(name) > previous && names.lastIndexOf(name) === names.indexOf(name), 'Actual owned close event is required once: ' + name);
        assert.ok(names.indexOf('close-request-complete') > names.indexOf('browser-close-acknowledged') && names.indexOf('close-request-complete') > names.indexOf('cdp-transport-closed'), 'Release must await the browser acknowledgement and actual transport close');
        assert.ok(names.indexOf('streams-close') > names.indexOf('process-exit') && names.indexOf('streams-close') > names.indexOf('close-request-complete'), 'Process and stream release must both complete after owned connection release');
        assert.ok(context.metadata.identities.some(identity => identity.pid === context.metadata.pid && identity.startedTicks), 'Observed browser ownership must include the exact spawned PID and creation identity');
        assert.equal(path.dirname(context.metadata.profile), context.root, 'Observed browser profile must belong only to this invocation');
      }
    },
  });
  return { results: output.result, metadata: output.metadata };
}

function recordVisualAssertions(metadata) {
  if (!metadata.kernelObserver) return;
  const entry = { event: 'page-assertions-complete', invocation: metadata.invocation, elapsedMs: performance.now() - metadata.startedMonotonicMs };
  fs.writeFileSync(metadata.evidenceFile.replace(/\.json$/, '.assertions.json'), JSON.stringify(entry) + '\n', { flag: 'wx' });
}

module.exports = { runIsolatedEdge, recordVisualAssertions, runProcessLifecycle, probeIdentities, startWindowsIdentityProbe, validateEdgeOptions, writeScreenshotPng, waitForOwnedDevToolsEndpoint, isOwnedReadinessWait, observeNavigationResources, CdpConnection };
