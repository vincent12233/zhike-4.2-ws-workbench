'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const root = path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Services');
const contract = fs.readFileSync(path.join(repo, 'docs', 'compatibility-contract-v5.1.md'), 'utf8');

for (const file of ['DesktopBridgeService.cs', 'LegacyApiAdapter.cs', 'BridgeContracts.cs', 'LegacyBridgeScript.cs'])
  assert.equal(fs.existsSync(path.join(root, file)), true, `missing bridge service ${file}`);
for (const token of ['requestId', 'bridgeVersion', 'unsupported', 'idempotency', 'api/state', 'api/ws'])
  assert.match(contract, new RegExp(token, 'i'), `bridge contract missing ${token}`);

const bridge = fs.readFileSync(path.join(root, 'DesktopBridgeService.cs'), 'utf8');
assert.match(bridge, /InvokeAsync\(/);
assert.match(bridge, /Publish\(/);
assert.match(bridge, /redact|sensitive|secret/i);

console.log('legacy bridge contract: versioned request/response and compatibility mappings are present');
