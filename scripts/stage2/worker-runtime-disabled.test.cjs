'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { runRuntime } = require('./worker-runtime-test-helper.cjs');

const root = path.resolve(__dirname, '..', '..');
const result = runRuntime(root, ['disabled']);
if (result.error) throw result.error;
assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
const payload = JSON.parse(`${result.stdout}\n${result.stderr}`.split(/\r?\n/).filter(Boolean).at(-1));
assert.equal(payload.ok, true);
assert.equal(payload.state, 'disabled');
assert.equal(payload.running, false);
assert.equal(payload.workerProcessStarted, false);
assert.equal(payload.productionWorkerStarted, false);
console.log('stage2 Worker runtime disabled gate leaves legacy execution path untouched');
