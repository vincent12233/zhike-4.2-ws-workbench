'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Services', 'ApiClient.cs'), 'utf8');

assert.doesNotMatch(source, /api\/v2\//, 'native fallback must not depend on the retired remote API');
for (const route of ['api/health', 'api/state', 'api/ws/accounts', 'api/ws/ingest/batch']) assert.match(source, new RegExp(route.replace('/', '\\/')));
assert.match(source, /GetCustomersAsync[\s\S]*GetStateDocumentAsync/);
assert.match(source, /GetBusinessRecordsAsync[\s\S]*AddTicketRows/);
assert.match(source, /PreviewImportAsync[\s\S]*localImportBatches/);
assert.match(source, /CommitImportAsync[\s\S]*PutStateAsync/);
assert.match(source, /NormalizePhone/);
assert.match(source, /InferRowTarget/);
assert.match(source, /EnsureCustomer/);
assert.match(source, /BusinessKey/);
assert.match(source, /DateValue/);
assert.match(source, /买入日期/);
assert.match(source, /卖出日期/);
assert.match(source, /不得.*登记日期|Never manufacture today's registration date/);
assert.match(source, /_localImportHashes/);
assert.match(source, /TryGetValue\(batchId/);

console.log('desktop ApiClient local-only contract passed');
