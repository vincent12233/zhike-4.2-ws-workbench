'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { runRuntime } = require('./worker-runtime-test-helper.cjs');

const root = path.resolve(__dirname, '..', '..');
const result = runRuntime(root, ['flags']);
if (result.error) throw result.error;
assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
const payload = JSON.parse(`${result.stdout}\n${result.stderr}`.split(/\r?\n/).filter(Boolean).at(-1));
assert.equal(payload.ok, true);
assert.deepEqual(payload.missing, { runtime: false, queue: false, fencing: false });
assert.deepEqual(payload.invalid, { runtime: false, queue: false, fencing: false });
assert.deepEqual(payload.valid, { runtime: true, queue: true, fencing: false });
assert.equal(payload.validSource, 'file');
assert.equal(payload.validRevision, 7);
console.log('stage2 feature flags default-off, invalid-safe and auditable-file loading passed');
