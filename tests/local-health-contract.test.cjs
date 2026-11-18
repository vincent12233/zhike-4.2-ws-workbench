'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const { version } = require(path.join(repo, 'resources', 'app', 'package.json'));
const source = fs.readFileSync(path.join(repo, 'resources', 'app', 'server.mjs'), 'utf8');

assert.equal(source.match(/const APP_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1], version,
  'local sidecar exposes the shipped app version');
assert.match(source, /url\.pathname === ['"]\/api\/health['"][\s\S]{0,700}appVersion:\s*APP_VERSION/, 'health response includes the app version');
for (const field of ['schemaVersion', 'databaseStatus', 'workerStatus', 'storage']) {
  assert.match(source, new RegExp(`${field}\\s*:`), `health response includes ${field}`);
}
assert.match(source, /databaseStatus:\s*['"]queryable['"]/, 'schema read does not claim full SQLite integrity');
assert.match(source, /databaseCheck:\s*['"]schema-read['"]/, 'health reports the exact database observation');
assert.match(source, /workerStatus:\s*['"]unknown['"]/, 'sidecar cannot infer native Worker liveness');
assert.match(source, /sidecarStatus:\s*['"]running['"]/, 'HTTP listener status is separate from Worker status');

console.log('local health contract passed');
