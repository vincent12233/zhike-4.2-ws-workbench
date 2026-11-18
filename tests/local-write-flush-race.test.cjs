'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(repo, 'resources', 'app', 'app.js'), 'utf8').replaceAll('\r\n', '\n');
const match = source.match(/async function flushStateWrites\(\)\{([^}]+(?:\}[^}]*)*?)\n?\s*\}\n\s*const persist/);
assert(match, 'flushStateWrites implementation is present');
const body = match[1];
assert.match(body, /let pendingFlush=null/, 'flush tracks a write scheduled during flush');
assert.match(body, /pendingFlush=enqueueStateWrite\(data\)/, 'flush captures the pending write promise');
assert.match(body, /await \(pendingFlush\|\|dbWritePromise\)/, 'flush waits for the newly queued write before returning');

console.log('local write flush race contract passed');
