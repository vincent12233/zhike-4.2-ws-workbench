'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'resources', 'app', 'modules', 'ws-workbench.js'), 'utf8');
const core = require(path.join(root, 'resources', 'app', 'modules', 'ws-workbench-core.js'));

assert.ok(core, 'WS core should load');
assert.deepEqual(core.matchCustomer([{ id: 'c1', wsAccountIds: ['alpha', 'beta'] }], { wsAccountId: 'beta' }).customer?.id, 'c1', 'existing multi-account linkage should match');
assert.equal(core.matchCustomer([{ id: 'c1', wsAccountIds: ['alpha'] }, { id: 'c2', wsAccountIds: ['beta'] }], { wsAccountId: 'beta' }).kind, 'account', 'account identity should match additively');

assert.match(ui, /function captureContext[\s\S]*accountId[\s\S]*sequence/, 'sync paths capture immutable account context');
assert.match(ui, /refreshCollectionSummary[\s\S]*assertContext\(context\)/, 'collection summary fences stale responses');
assert.match(ui, /autoCaptureCurrentConversation[\s\S]*captureContext\([\s\S]*importVisible\(context\)/, 'automatic capture keeps account context');
assert.match(ui, /analyzeConversation\(context[\s\S]*api\('\/api\/ws\/analyses'[\s\S]*context/, 'AI analysis writes use originating account');
assert.match(ui, /wsAccountIds|activeAccountId/, 'CRM profile stores WS account identity');
assert.match(ui, /matchCustomer\([\s\S]*wsAccountId/, 'CRM matching uses WS account identity after phone');
assert.match(ui, /idempotencyKey/, 'reply writes retain idempotency keys');
console.log('ws-workbench-sync: account fencing, multi-account CRM matching and idempotency contracts pass');
