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
const ai = fs.readFileSync(path.join(root, 'AiBridgeService.cs'), 'utf8');
assert.match(ai, /MaxResponseBytes/);
assert.match(ai, /ReadContentWithLimitAsync/);
assert.match(ai, /max_output_tokens/);
assert.match(ai, /AddOrUpdate/);
assert.match(ai, /ICollection<KeyValuePair/);

const adapter = fs.readFileSync(path.join(root, 'LegacyApiAdapter.cs'), 'utf8');
assert.match(adapter, /ExplicitlyUnsupportedPrefixes/);
assert.match(adapter, /UNSUPPORTED/);
assert.match(adapter, /api\/ws\/checkpoints/);
assert.match(adapter, /api\/ws\/heartbeat/);
assert.match(adapter, /api\/v2\/legacy\/state\/version/);
assert.match(adapter, /UnescapeDataString/);
assert.match(adapter, /EscapeDataString/);
assert.match(adapter, /TryParse\(suffix/);
assert.match(adapter, /snapshot id is invalid/);
assert.match(adapter, /snapshotCreated/);
assert.match(adapter, /skipped/);
assert.match(adapter, /BUSINESS_REJECTED/);
assert.match(adapter, /NO_CHANGE/);
assert.match(adapter, /importCommit/);
assert.doesNotMatch(adapter, /StartsWith\("\/api\/ws\/"[^\n]*\)\s*\)\s*\n\s*v2Path\s*=/,
  'adapter must not blindly forward every legacy WS route to v2');

console.log('legacy bridge contract: versioned request/response and compatibility mappings are present');
