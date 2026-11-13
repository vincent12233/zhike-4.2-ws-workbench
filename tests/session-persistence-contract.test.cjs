'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const app = read('resources/app/app.js');
const server = read('resources/app/server.mjs');
const manager = read('desktop/src/Zhike.Desktop/Services/LocalServiceManager.cs');

assert.doesNotMatch(server, /\/api\/local-migration\//);
assert.doesNotMatch(server, /\/api\/import\/legacy\//);
assert.doesNotMatch(server, /local_migrations|localFirstMigration|pendingImportTimer/);
assert.match(app, /const stored\s*=\s*null/,
  'the 6.0 session must not seed SQLite from a WebView localStorage cache');
assert.doesNotMatch(app, /zhike-offline-crm-v1|localStorage\.setItem\(dbKey/);
assert.match(server, /x-zhike-api-token/i);
assert.match(manager, /ZHIKE_API_TOKEN/);
assert.match(manager, /ZHIKE_SHUTDOWN_TOKEN/);
assert.match(manager, /WaitForHealthAsync/);

console.log('session persistence contract: isolated SQLite session, guarded loopback token and restart-safe sidecar pass');
