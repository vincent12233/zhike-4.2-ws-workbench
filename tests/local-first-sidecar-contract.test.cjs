'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const repo = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(repo, 'scripts', 'build-winui-bundle.ps1'), 'utf8');
assert.match(script, /node\.exe/);
assert.match(script, /server\.mjs/);
assert.match(script, /state-delta\.cjs/);
assert.match(script, /migrations/);
assert.doesNotMatch(script, /blockedResourceNames[^\n]*node\.exe/);

const installer = fs.readFileSync(path.join(repo, 'scripts', 'build-winui-installer.ps1'), 'utf8');
assert.doesNotMatch(installer, /blockedStageNames[^\n]*node\.exe/);
assert.doesNotMatch(installer, /blockedStageNames[^\n]*server\.mjs/);

const app = path.join(repo, 'resources/app');
const server = fs.readFileSync(path.join(app, 'server.mjs'), 'utf8');
const sidecarFiles = [...server.matchAll(/\brequire\('\.\/([^/'\\]+)'\)/g)].map(match => match[1]);
assert.ok(sidecarFiles.includes('migration-runner.cjs'), 'the sidecar starts through its migration runner');
const allowlist = script.split('$resourceAllowList = @(')[1].split('\n)')[0];
assert.ok(allowlist.includes("'migration-runner.cjs'"), 'bundle must include migration-runner.cjs for sidecar startup');
const bundleGuard = script.split('$requiredRuntimeFiles = @(')[1].split('\n)')[0];
const installerGuard = installer.split('$requiredStageFiles = @(')[1].split('\n)')[0];
for (const dependency of sidecarFiles) {
  assert.ok(fs.existsSync(path.join(app, dependency)), `sidecar dependency exists: ${dependency}`);
  assert.ok(allowlist.includes(`'${dependency}'`), `bundle must include the sidecar dependency ${dependency}`);
  assert.ok(bundleGuard.includes(`'${dependency}'`), `bundle must reject a missing sidecar dependency ${dependency}`);
  assert.ok(installerGuard.includes(`'resources\\app\\${dependency}'`), `installer must reject a missing sidecar dependency ${dependency}`);
}

console.log('local-first sidecar contract: Node runtime and SQLite service assets are eligible for the WinUI bundle');
