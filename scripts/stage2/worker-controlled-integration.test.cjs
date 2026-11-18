'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runRuntime } = require('./worker-runtime-test-helper.cjs');

const root = path.resolve(__dirname, '..', '..');
const appSource = fs.readFileSync(path.join(root, 'desktop', 'src', 'Zhike.Desktop', 'App.xaml.cs'), 'utf8');
const flagsPath = path.join(root, 'desktop', 'src', 'Zhike.Desktop', 'Services', 'WorkerFeatureFlags.cs');
const controllerPath = path.join(root, 'desktop', 'src', 'Zhike.Desktop', 'Services', 'WorkerRuntimeController.cs');
const supervisorPath = path.join(root, 'desktop', 'src', 'Zhike.Desktop', 'Services', 'WorkerSupervisor.cs');

assert.equal(fs.existsSync(flagsPath), true, 'formal Worker feature flag boundary is missing');
assert.equal(fs.existsSync(controllerPath), true, 'formal Worker runtime controller is missing');
assert.match(fs.readFileSync(flagsPath, 'utf8'), /WorkerRuntimeEnabled/);
assert.match(fs.readFileSync(flagsPath, 'utf8'), /WorkerQueueAdapterEnabled/);
assert.match(fs.readFileSync(flagsPath, 'utf8'), /WorkerFencingEnabled/);
assert.match(fs.readFileSync(flagsPath, 'utf8'), /false/);
assert.match(fs.readFileSync(controllerPath, 'utf8'), /StartAsync/);
assert.match(fs.readFileSync(controllerPath, 'utf8'), /RotateTokenAsync/);
assert.match(fs.readFileSync(controllerPath, 'utf8'), /RequestAsync/);
const supervisorSource = fs.readFileSync(supervisorPath, 'utf8');
assert.match(supervisorSource, /ReferenceEquals\(_worker, process\)/,
  'stale Worker Exited events must not mutate a newer process session');
assert.match(supervisorSource, /_generation\s*!=\s*processGeneration/,
  'Worker Exited events must be fenced by the process generation');
assert.doesNotMatch(appSource, /WorkerRuntime\.StartAsync\(/, 'desktop launch must not auto-start the controlled Worker');
assert.match(appSource, /WorkerFeatureFlags\.Load/);

const result = runRuntime(root);
if (result.error) throw result.error;
assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
const output = `${result.stdout}\n${result.stderr}`;
const lines = output.split(/\r?\n/).filter(Boolean);
const payload = JSON.parse(lines.at(-1));
assert.equal(payload.ok, true, output);
assert.equal(payload.flags.workerRuntimeEnabled, true);
assert.equal(payload.flags.workerQueueAdapterEnabled, true);
assert.equal(payload.flags.workerFencingEnabled, true);
assert.equal(payload.started, true);
assert.equal(payload.heartbeatObserved, true);
assert.equal(payload.requestCancelled, true);
assert.equal(payload.crashRecovered, true);
assert.equal(payload.tokenRotated, true);
assert.equal(payload.concurrentRotation, true);
assert.equal(payload.restartStorm, true);
assert.equal(payload.concurrentLifecycle, true);
assert.equal(payload.stopped, true);
assert.equal(payload.productionWorkerStarted, false);
assert.equal(payload.productionDatabaseOpened, false);
assert.equal(payload.tempRootClean, true);
console.log('stage2 controlled Worker lifecycle, heartbeat, recovery and token rotation passed');
