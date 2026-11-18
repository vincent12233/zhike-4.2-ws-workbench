'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(repo, 'resources/app/server.mjs'), 'utf8');
assert.match(server, /function deriveWsCustomerGroupStatus\(/,
  'group event projection must derive customer aggregate status from memberships');
assert.match(server, /applyWsCustomerGroupStatus\(customer, normalizedEvent\.type\)/,
  'ingest projection must update the group status projection after a group transition');
assert.match(server, /active\.some\(item => item\.status === '在群'\)/,
  'customer status must stay in-group while any group membership remains active');
console.log('customer-group-membership: status projection contract present');
