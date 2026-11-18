'use strict';
// Fresh lifecycle execution using the already-accepted isolated .NET runtime.
// Timing is an observation, not a newly invented acceptance threshold.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { spawnSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..', '..');
const helper = require('../stage2/worker-runtime-test-helper.cjs');
const executable = helper.ensureRuntimeExecutable(repo);
const cpuBefore = process.cpuUsage();
const started = performance.now();
const result = spawnSync(executable, [], { cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 120000 });
assert.ifError(result.error);
assert.equal(result.status, 0, 'isolated Worker regression exited unsuccessfully');
const payload = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
for (const key of ['ok', 'started', 'heartbeatObserved', 'requestCancelled', 'crashRecovered', 'tokenRotated', 'concurrentRotation', 'restartStorm', 'concurrentLifecycle', 'stopped', 'tempRootClean']) assert.equal(payload[key], true, key);
assert.equal(payload.productionWorkerStarted, false);
assert.equal(payload.productionDatabaseOpened, false);
const command = "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'WorkerRuntimeIntegration.exe' -and $_.ExecutablePath -eq '" + executable.replace(/'/g, "''") + "' }).Count";
const remaining = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
assert.ifError(remaining.error); assert.equal(remaining.status, 0); assert.equal(Number(remaining.stdout.trim()), 0, 'isolated runtime process remains');
const cpu = process.cpuUsage(cpuBefore);
const output = { stage: '5.1', status: 'Passed', test: 'existing isolated WorkerRuntimeController lifecycle', durationMs: +((performance.now() - started).toFixed(1)), parentCpuUserMs: cpu.user / 1000, parentCpuSystemMs: cpu.system / 1000, lifecycle: { heartbeat: true, cancellation: true, crashRecovery: true, tokenRotation: true, restartStorm: true, concurrentLifecycle: true, stopped: true, temporaryRootClean: true }, matchingTestProcessesRemaining: 0, workerCpuAndMemory: 'NotMeasuredByThisWrapper', productionWorkerStarted: false, productionDatabaseOpened: false };
if (process.argv[2]) {
  const outputPath = path.resolve(process.argv[2]);
  if (!outputPath.startsWith(path.join(repo, 'docs', 'superpowers', 'reports') + path.sep)) throw new Error('Worker evidence output must be inside the reports directory');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify(output));
