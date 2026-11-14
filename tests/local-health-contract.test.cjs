'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(repo, 'resources', 'app', 'server.mjs'), 'utf8');

assert.match(source, /const APP_VERSION\s*=\s*['"]6\.0\.1['"]/, 'local sidecar exposes the shipped app version');
assert.match(source, /url\.pathname === ['"]\/api\/health['"][\s\S]{0,700}appVersion:\s*APP_VERSION/, 'health response includes the app version');
for (const field of ['schemaVersion', 'databaseStatus', 'workerStatus', 'storage']) {
  assert.match(source, new RegExp(`${field}\\s*:`), `health response includes ${field}`);
}
assert.match(source, /databaseStatus:\s*['"]healthy['"]/, 'healthy local SQLite status is explicit');
assert.match(source, /workerStatus:\s*['"]running['"]/, 'local worker status is explicit');

console.log('local health contract passed');
