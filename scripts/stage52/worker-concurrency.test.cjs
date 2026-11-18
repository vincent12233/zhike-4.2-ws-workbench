'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const repo = path.resolve(__dirname, '../..');
const executable = process.argv.includes('--no-build')
  ? path.join(repo, 'scripts/stage2/WorkerRuntimeIntegration/bin/Release/net10.0-windows/WorkerRuntimeIntegration.exe')
  : require('../stage2/worker-runtime-test-helper.cjs').ensureRuntimeExecutable(repo);
assert.ok(fs.existsSync(executable));
const directory = path.join(repo, '.tools/stage52-worker-raw', 'concurrent-' + crypto.randomUUID());
fs.mkdirSync(directory, { recursive: true });
const environment = { ...process.env }; delete environment.ZHIKE_WORKER_TEST_TRACE;
const run = index => new Promise(resolve => {
  const begin = performance.now();
  execFile(executable, [], { cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 120000, env: environment }, (error, stdout, stderr) => {
    fs.writeFileSync(path.join(directory, index + '.stdout.log'), stdout || '');
    fs.writeFileSync(path.join(directory, index + '.stderr.log'), stderr || '');
    let payload; try { payload = JSON.parse((stdout || '').trim().split(/\r?\n/).at(-1)); } catch {}
    if (payload) delete payload.currentSid;
    resolve({ index, elapsedMs: Math.round(performance.now() - begin), passed: !error && payload?.ok === true && payload?.tempRootClean === true, errorCode: error?.code || null, payload });
  });
});
(async () => {
  const runs = await Promise.all([1, 2, 3, 4].map(run));
  const output = { sameAssemblyConcurrentProcesses: 4, passed: runs.filter(row => row.passed).length, failed: runs.filter(row => !row.passed).length, runs, productionWorkerStarted: false, productionDatabaseOpened: false };
  fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ ...output, runs: runs.map(({ payload, ...row }) => row), evidenceDirectory: directory }));
  assert.equal(output.failed, 0);
  const remaining = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'WorkerRuntimeIntegration.exe' -and $_.ExecutablePath -eq '" + executable.replace(/'/g, "''") + "' }).Count"], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.ifError(remaining.error); assert.equal(remaining.status, 0); assert.equal(Number(remaining.stdout.trim()), 0);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
