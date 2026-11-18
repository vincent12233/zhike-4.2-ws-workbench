'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function ensureRuntimeExecutable(root) {
  const project = path.join(root, 'scripts', 'stage2', 'WorkerRuntimeIntegration', 'WorkerRuntimeIntegration.csproj');
  const executable = path.join(root, 'scripts', 'stage2', 'WorkerRuntimeIntegration', 'bin', 'Release', 'net10.0-windows', 'WorkerRuntimeIntegration.exe');
  const build = spawnSync(path.join(root, '.tools', 'dotnet10', 'dotnet.exe'), [
    'build', project, '-c', 'Release', '--nologo',
  ], { cwd: root, encoding: 'utf8', stdio: 'inherit', timeout: 120000, windowsHide: true });
  if (build.error) throw build.error;
  assert.equal(build.status, 0, 'isolated Worker integration project must build');
  assert.equal(fs.existsSync(executable), true, 'isolated Worker apphost was not produced');
  return executable;
}

function runRuntime(root, args = []) {
  const executable = ensureRuntimeExecutable(root);
  return spawnSync(executable, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
    windowsHide: true,
  });
}

module.exports = { ensureRuntimeExecutable, runRuntime };
