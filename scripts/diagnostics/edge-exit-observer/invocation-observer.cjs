'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');

function startWindowsExitObservation({ dotnet, stem, invocation, timeoutMs, elapsed }) {
  const library = path.join(__dirname, 'observer/bin/Release/net10.0/Observer.dll');
  assert.equal(process.platform, 'win32');
  assert.ok(path.isAbsolute(dotnet) && fs.statSync(dotnet).isFile(), 'Use a local absolute dotnet.exe path');
  assert.ok(fs.statSync(library).isFile(), 'Build the Windows exit observer in this worktree');

  const file = stem + '.kernel.jsonl';
  const observer = spawn(dotnet, [library, '--invocation'], { cwd: path.dirname(stem), windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  const evidence = fs.createWriteStream(file, { flags: 'wx', mode: 0o600 });
  const lines = createInterface({ input: observer.stdout, crlfDelay: Infinity });
  let clock, clockSamples = 0, identity, armed = false, finished = false, ending = false, observerStopped = false;
  evidence.on('error', error => console.error('Cannot persist Windows exit observation: ' + (error.code || error.name)));
  const record = (entry, runnerReceivedElapsedMs = elapsed()) => {
    if (evidence.destroyed || evidence.writableEnded) return;
    evidence.write(JSON.stringify({ ...entry, invocation, runnerReceivedElapsedMs }) + '\n');
  };
  const send = message => observer.stdin.write(JSON.stringify({ invocation, ...message }) + '\n');
  const flush = () => {
    if (identity && clockSamples === 2 && !armed) {
      armed = true;
      // The clock sample occurred between send and receive. Watch through the
      // latest plausible deadline; preserve the bracket in the evidence.
      send({ kind: 'watch', identity, deadlineMs: clock.monotonicMs + timeoutMs - clock.runnerSentElapsedMs });
    }
    if (finished && (!identity || armed) && !ending) {
      ending = true;
      observer.stdin.end();
    }
  };
  lines.on('line', line => {
    const receivedElapsedMs = elapsed();
    let event;
    try { event = JSON.parse(line); }
    catch { record({ kind: 'observer-invalid-output' }); return; }
    record(event, receivedElapsedMs);
    if (event.kind === 'ready' && !ending) {
      send({ kind: 'clock', runnerSentElapsedMs: elapsed() });
    } else if (event.kind === 'clock' && event.body?.invocation === invocation) {
      const bracketWidthMs = receivedElapsedMs - event.body.runnerSentElapsedMs;
      if (!clock || bracketWidthMs < clock.bracketWidthMs) clock = { ...event.body, bracketWidthMs };
      if (++clockSamples === 1 && !ending) send({ kind: 'clock', runnerSentElapsedMs: elapsed() });
      else flush();
    } else if (event.kind === 'stopped') {
      observerStopped = true;
    }
  });
  lines.on('error', error => record({ kind: 'observer-stream-error', code: error.code || error.name }));
  observer.stdin.on('error', error => record({ kind: 'observer-request-error', code: error.code || error.name }));
  observer.on('error', error => record({ kind: 'observer-process-error', code: error.code || error.name }));
  const limit = setTimeout(() => {
    if (observerStopped) return;
    record({ kind: 'observer-capture-deadline' });
    try { observer.kill(); } // This is the diagnostic subprocess's retained handle.
    catch (error) { record({ kind: 'observer-termination-error', code: error.code || error.name }); }
  }, Math.max(1, timeoutMs + 2000 - elapsed()));
  limit.unref();
  observer.once('close', (code, signal) => {
    clearTimeout(limit);
    lines.close();
    record({ kind: 'observer-exit', code, signal });
    evidence.end();
  });
  return {
    file, pid: observer.pid,
    arm(row) {
      if (identity) return;
      identity = { pid: row.pid, startedTicks: row.startedTicks, role: 'root' };
      flush();
    },
    finish() { finished = true; flush(); },
  };
}

module.exports = { startWindowsExitObservation };
