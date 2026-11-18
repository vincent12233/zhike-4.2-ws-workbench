'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const { runProcessLifecycle } = require('../../../tests/helpers/isolated-edge-runner.cjs');

async function readObservation(file) {
  const deadline = performance.now() + 2500;
  while (performance.now() < deadline) {
    const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
    if (rows.at(-1)?.kind === 'observer-exit') return rows;
    await delay(15);
  }
  throw new Error('The owned observer did not record its own close');
}

async function calibrate(dotnet, evidenceDirectory, timedOut) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-kernel-calibration-'));
  const script = `process.stdout.write('READY');process.stdin.resume();process.stdin.on('data',()=>${timedOut ? 'setInterval(()=>{},1000)' : 'setTimeout(()=>process.exit(0),500)'})`;
  const metadata = await runProcessLifecycle({
    command: process.execPath, args: ['-e', script], root, timeoutMs: 4000, mode: 'kernel-calibration', evidenceDirectory,
    observerDotnet: dotnet,
    readResult: context => context.waitForOutput(value => value.includes('READY') ? true : undefined),
    requestClose: context => context.child.stdin.end('STOP\n'),
  }).then(result => {
    assert.equal(timedOut, false);
    return result.metadata;
  }, error => {
    assert.equal(timedOut, true);
    assert.equal(error.phase, 'process-exit');
    assert.equal(error.code, 'EDGE_RUNNER_TIMEOUT');
    return error.metadata;
  });
  const rows = await readObservation(metadata.kernelObserver.file);
  assert.ok(rows.every(row => row.invocation === metadata.invocation));
  const find = kind => rows.find(row => row.kind === kind);
  const armed = find('watch-armed').body;
  assert.equal(armed.verified, true);
  assert.equal(armed.Pid, metadata.pid);
  assert.equal(armed.handlePid, metadata.pid);
  assert.equal(armed.StartedTicks, metadata.identities[0].startedTicks);
  assert.equal(find('observer-exit').code, 0);
  const clocks = rows.filter(row => row.kind === 'clock');
  assert.equal(clocks.length, 2);
  const bracketWidth = row => row.runnerReceivedElapsedMs - row.body.runnerSentElapsedMs;
  const clock = clocks.sort((first, second) => bracketWidth(first) - bracketWidth(second))[0];
  const bracketWidthMs = bracketWidth(clock);
  assert.ok(bracketWidthMs >= 0 && bracketWidthMs < 100, 'The two monotonic clocks must have a narrow measured offset bracket');
  const ended = find('watch-ended').body;
  assert.equal(ended.root.pid, metadata.pid);
  assert.equal(ended.root.handlePid, metadata.pid);
  assert.equal(ended.root.waitStatusBeforeQuery, ended.waitStatus);
  assert.equal(ended.root.rawExitCodeError, null);
  assert.equal(ended.root.handlePidError, null);
  assert.equal(ended.root.processTimesError, null);
  assert.ok(ended.root.queryEndedMs >= ended.root.queryStartedMs);
  const fromNode = name => metadata.events.find(row => row.event === name);
  if (timedOut) {
    assert.equal(metadata.status, 'Failed');
    assert.equal(metadata.timeoutMs, 4000);
    assert.equal(metadata.cleanupSafe, false);
    assert.equal(metadata.forceTerminated, true);
    assert.equal(fromNode('node-release-state').exitObserved, false);
    assert.ok(ended.lastRunningMs - clock.body.monotonicMs + clock.body.runnerSentElapsedMs > metadata.timeoutMs - 150);
    const running = find('watch-sample').body.root;
    assert.equal(running.handlePid, metadata.pid);
    assert.equal(running.waitStatusBeforeQuery, 258);
    assert.equal(running.waitStatusAfterQuery, 258);
    assert.equal(running.rawExitCode, 259);
    assert.equal(running.rawExitCodeError, null);
    assert.equal(running.exitUnixMs, null);
    assert.equal(running.exitCode, null);
  } else {
    assert.equal(metadata.status, 'Passed');
    assert.equal(metadata.cleanupSafe, true);
    assert.equal(metadata.forceTerminated, false);
    assert.equal(ended.ending, 'root-exited');
    assert.equal(ended.root.waitStatusAfterQuery, 0);
    assert.equal(ended.root.rawExitCode, 0);
    assert.equal(ended.root.exitCode, 0);
    assert.ok(ended.root.exitUnixMs > 0);
    assert.ok(ended.root.exitFileTimeUtcRaw > 0);
    assert.ok(ended.monotonicMs - clock.body.monotonicMs + clock.body.runnerSentElapsedMs <= fromNode('process-exit').elapsedMs + 100);
    fs.rmdirSync(root);
  }
  console.log(JSON.stringify({ timedOut, invocation: metadata.invocation, kernel: ended.ending, bracketWidthMs, lifecycle: metadata.evidenceFile, observation: metadata.kernelObserver.file }));
}

(async () => {
  const dotnet = process.argv[2];
  assert.ok(dotnet, 'Supply an absolute local dotnet.exe path');
  const evidence = path.resolve(__dirname, '../../../.tools/edge-exit-observer');
  await calibrate(dotnet, evidence, false);
  await calibrate(dotnet, evidence, true);
})().catch(error => { console.error(error); process.exitCode = 1; });
