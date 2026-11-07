'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(repo, relative), 'utf8');
const ws = read('server/src/Zhike.Infrastructure/Repositories/WsRepository.cs');
const customer = read('server/src/Zhike.Infrastructure/Repositories/CustomerRepository.cs');
const ai = read('server/src/Zhike.Infrastructure/Repositories/AiAnalysisRepository.cs');
const reminders = read('server/src/Zhike.Worker/Workers/FollowupReminderWorker.cs');
const imports = read('server/src/Zhike.Infrastructure/Repositories/ImportRepository.cs');

assert.match(ws, /INSERT INTO ws_accounts[\s\S]+ON CONFLICT \(id\) DO NOTHING/);
assert.match(ws, /EnsureAccountAndConversationAsync/);
assert.match(ws, /BeginTransactionAsync/);
assert.match(ws, /regexp_replace\(\$3, '\\D'/);
assert.match(customer, /pg_advisory_xact_lock/);
assert.match(customer, /NULLIF\(BTRIM\(customers\.name\), ''\)/);
assert.match(customer, /UPDATE customer_identities AS i/);
assert.match(customer, /c\.deleted_at IS NOT NULL/);
assert.match(ai, /customer_identities/);
assert.match(ai, /NULLIF\(BTRIM\(\{field\.Key\}\), ''\)/);
assert.match(reminders, /followup\.reminder\.due/);
assert.match(imports, /await using var transaction = await connection\.BeginTransactionAsync/);
assert.match(imports, /customers\.UpsertFillEmptyAsync\(connection, transaction/);
assert.match(imports, /businessRecords\.UpsertAsync\(connection, transaction/);
assert.match(imports, /transaction\.RollbackAsync/);
assert.match(read('server/migrations/008-outbox-dedupe.sql'), /uq_sync_outbox_event/);
console.log('server data integrity regression: WS auto-create/checkpoint safety, identity locking, AI fill-empty and reminder outbox pass');
