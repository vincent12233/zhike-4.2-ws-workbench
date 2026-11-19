'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTestDiagnostic } = require('../resources/app/test-diagnostics.cjs');

const envName = 'ZHIKE_TEST_DIAGNOSTIC_CONTRACT';
const previous = process.env[envName];
try {
  let output = '';
  process.env[envName] = '1';
  const diagnostic = createTestDiagnostic({
    envName,
    prefix: 'ZHIKE_TEST_CONTRACT',
    allowedFields: ['pathCount', 'errorCode'],
    write: value => { output += value; },
  });
  diagnostic.emit('phase.start', {
    pathCount: 3,
    errorCode: 'C:\\private\\workspace.sqlite',
    path: 'C:\\private\\workspace.sqlite',
    token: 'synthetic-secret-token',
  });
  const line = output.trim();
  assert.match(line, /^\[ZHIKE_TEST_CONTRACT\] /);
  assert.doesNotMatch(line, /private|workspace\.sqlite|synthetic-secret-token/i,
    'diagnostics must not serialize path or token values');
  const record = JSON.parse(line.slice(line.indexOf('{')));
  assert.equal(record.event, 'phase.start');
  assert.equal(record.pathCount, 3);
  assert.equal(record.errorCode, 'REDACTED');
  assert.equal(Object.hasOwn(record, 'path'), false);
  assert.equal(Object.hasOwn(record, 'token'), false);

  output = '';
  delete process.env[envName];
  createTestDiagnostic({ envName, prefix: 'ZHIKE_TEST_CONTRACT', allowedFields: ['pathCount'], write: value => { output += value; } })
    .emit('phase.start', { pathCount: 1 });
  assert.equal(output, '', 'diagnostics must remain silent unless the exact test flag equals 1');
} finally {
  if (previous === undefined) delete process.env[envName];
  else process.env[envName] = previous;
}

const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const migrationPackage = read('resources/app/device-migration-package.cjs');
const server = read('resources/app/server.mjs');
assert.match(migrationPackage, /envName: 'ZHIKE_TEST_DEVICE_MIGRATION_DIAGNOSTICS'/);
assert.match(migrationPackage, /'windows-path\.start'[\s\S]*'windows-path\.closed'/);
assert.match(migrationPackage, /'scrypt\.start'[\s\S]*'scrypt\.completed'/);
assert.match(server, /envName: 'ZHIKE_TEST_STARTUP_DIAGNOSTICS'/);
for (const phase of [
  'modules-loaded', 'workspace-lock-acquired', 'database-opened', 'migrations-start',
  'migrations-completed', 'workspace-bootstrap-completed', 'phone-index-repair-start',
  'phone-index-repair-completed', 'listen-start', 'listening',
]) assert.ok(server.includes(`testStartupDiagnostic('${phase}'`), `missing sidecar startup phase: ${phase}`);

console.log('test-only phase diagnostics contract: opt-in, bounded and free of path or credential payloads');
