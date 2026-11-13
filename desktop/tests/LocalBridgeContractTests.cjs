'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const apiClient = read('desktop/src/Zhike.Desktop/Services/ApiClient.cs');
const adapter = read('desktop/src/Zhike.Desktop/Services/LegacyApiAdapter.cs');
const manager = read('desktop/src/Zhike.Desktop/Services/LocalServiceManager.cs');

assert.match(apiClient, /X-Zhike-Api-Token/,
  'local sidecar requests must carry the guarded loopback token header');
assert.match(manager, /ZHIKE_SHUTDOWN_TOKEN/,
  'sidecar must expose a bounded authenticated shutdown path');
assert.match(adapter, /local SQLite|loopback|本机/i,
  'legacy adapter must identify the local-only transport');
assert.doesNotMatch(adapter, /ExplicitlyUnsupportedPrefixes/,
  'local WS routes must not be rejected by the former Postgres-only adapter');
assert.match(adapter, /key\.StartsWith\("\/api\//,
  'local adapter must forward supported legacy API paths to server.mjs');

console.log('local bridge contract: token header, local WS route forwarding and shutdown guard present');
