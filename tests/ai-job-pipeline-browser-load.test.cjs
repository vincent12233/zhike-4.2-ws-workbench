'use strict';

// ai-job-pipeline-core.js is required by the sidecar and also loaded by
// index.html as a classic script. In the browser it must not throw
// "module is not defined" or leak its declarations into the page's global
// scope, and Node must still receive the full API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '..');
const file = path.join(repo, 'resources/app/modules/ai-job-pipeline-core.js');
const source = fs.readFileSync(file, 'utf8');

assert.match(fs.readFileSync(path.join(repo, 'resources/app/index.html'), 'utf8'), /<script src="\.\/modules\/ai-job-pipeline-core\.js"><\/script>/,
  'index.html loads the module as a classic script');

// Browser: a fresh realm without CommonJS globals, like a WebView2 page.
const window = {};
const context = vm.createContext({ window, console });
vm.runInContext('globalThis.window = globalThis;', context);
assert.doesNotThrow(() => vm.runInContext(source, context, { filename: 'ai-job-pipeline-core.js' }), 'the classic script must not throw');
const browserApi = vm.runInContext('globalThis.ZhikeAiJobPipeline', context);
assert.equal(typeof browserApi?.createAiJobPipeline, 'function', 'the browser receives window.ZhikeAiJobPipeline');
for (const name of ['STATUS', 'PipelineError', 'createAiJobPipeline', 'text', 'clone', 'status', 'normalizeJob', 'module']) {
  assert.equal(vm.runInContext(`typeof ${name}`, context), 'undefined', `${name} must not leak into the page global scope`);
}

// Node: the sidecar and tests keep the same CommonJS exports.
const nodeApi = require(file);
const expected = ['STATES', 'status', 'legacyStatus', 'canTransition', 'transition', 'claim', 'cancel', 'scheduleRetry', 'isTerminal',
  'nextRetryAt', 'advanceCheckpoint', 'makeIdempotencyKey', 'validateResult', 'STATUS', 'TRANSITIONS', 'PipelineError', 'normalizeStatus',
  'toLegacyStatus', 'normalizeJob', 'normalizeLegacyJob', 'checkpointProgress', 'mergeCheckpoint', 'createMemoryStore', 'createAiJobPipeline'];
assert.deepEqual(Object.keys(nodeApi).sort(), expected.slice().sort(), 'CommonJS exports are unchanged');
assert.deepEqual(Object.keys(browserApi).sort(), expected.slice().sort(), 'the browser API matches the CommonJS API');
assert.equal(nodeApi.status('QUEUED'), browserApi.status('QUEUED'));

console.log('AI job pipeline core loads as a browser script without leaking globals and keeps its CommonJS API');
