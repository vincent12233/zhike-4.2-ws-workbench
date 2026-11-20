'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const { copyIsolatedAppFixture } = require('../../tests/helpers/isolated-app-fixture.cjs');
const repo = path.resolve(__dirname, '../..');
const app = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-sidecar-code-'));
let run;
try {
  copyIsolatedAppFixture(path.join(repo, 'resources/app'), app);
  fs.copyFileSync(process.env.ZHIKE_TEST_NODE || process.execPath, path.join(app, 'node.exe'));
  const dotnet = process.env.ZHIKE_TEST_DOTNET || path.join(repo, '.tools/dotnet10/dotnet.exe');
  run = spawnSync(dotnet, ['run', '--project', path.join(__dirname, 'NativeReadinessProbe/NativeReadinessProbe.csproj'), '-c', 'Release', '--', app],
    { cwd: repo, encoding: 'utf8', timeout: 100000, windowsHide: true });
  if (run.error) throw run.error;
} finally {
  fs.rmSync(app, { recursive: true, maxRetries: 8, retryDelay: 100 });
}
assert.equal(run.status, 0, run.stdout + run.stderr);
const result = JSON.parse(run.stdout.trim().split(/\r?\n/).at(-1));
for (const flag of ['ok','inheritedIsolationRejected','productionGroupReadsAvailable','mockGroupWritesRejected','healthScopeTruthful','readyWithoutUiPump','cancellationPropagated','unauthorizedShutdownRejected','authenticatedGracefulShutdown']) assert.equal(result[flag], true, flag);
assert.equal(result.exitCode, 0); assert.equal(result.productionOpened, false); assert.equal(result.pendingUiCallbacks, 0);
console.log('stage5.1 real sidecar native readiness: UI-context independence, authenticated graceful shutdown and cancellation propagation PASS');
