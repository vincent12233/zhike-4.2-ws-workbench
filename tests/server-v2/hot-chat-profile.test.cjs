'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(repo, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(repo, relative));

assert.equal(exists('server/migrations/011-hot-chat-profiles.sql'), true, 'Postgres migration 011 is required');
const migration = read('server/migrations/011-hot-chat-profiles.sql');
for (const table of ['hot_chat_profiles', 'hot_chat_profile_fields', 'hot_chat_events', 'hot_chat_sync_outbox']) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
}
assert.match(migration, /JSONB/i, 'profile values and event payloads must be JSONB');
assert.match(migration, /account_id\s+TEXT/i);
assert.match(migration, /conversation_id\s+TEXT/i);
assert.match(migration, /UNIQUE\s*\(\s*customer_id\s*,\s*account_id\s*,\s*conversation_id\s*\)/i);
assert.match(migration, /source_message_id/i);
assert.match(migration, /analysis_id/i);
assert.match(migration, /version\s+BIGINT/i);
assert.match(migration, /INSERT INTO schema_migrations\s*\(version/i);
assert.match(migration, /VALUES\s*\(11\s*,/i);
assert.match(migration, /CREATE INDEX/i);
assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DROP DATABASE/i, 'profile migration must be rollback-safe and non-destructive');
assert.match(migration, /ON CONFLICT/i, 'profile migration must be replay-safe');

assert.equal(exists('server/src/Zhike.Contracts/HotChatContracts.cs'), true, 'hot-chat contracts are required');
const contracts = read('server/src/Zhike.Contracts/HotChatContracts.cs');
for (const token of ['HotChatProfileDto', 'HotChatProfileFieldDto', 'HotChatEventRequest', 'HotChatProfileUpsertRequest', 'CustomerDto']) {
  assert.match(contracts, new RegExp(`(record|class)\\s+${token}`));
}
assert.match(contracts, /StatusColor/);
assert.match(contracts, /ProfileSummary/);
assert.match(contracts, /Tags/);

assert.equal(exists('server/src/Zhike.Infrastructure/Repositories/HotChatProfileRepository.cs'), true);
const repository = read('server/src/Zhike.Infrastructure/Repositories/HotChatProfileRepository.cs');
for (const token of ['GetAsync', 'UpsertAsync', 'UpsertFieldAsync', 'AppendEventAsync', 'GetDiagnosticsAsync']) {
  assert.match(repository, new RegExp(`\\b${token}\\b`));
}
assert.match(repository, /BeginTransactionAsync/);
assert.match(repository, /ON CONFLICT/i);
assert.match(repository, /customer_id/);
assert.match(repository, /account_id/);
assert.match(repository, /conversation_id/);
assert.match(repository, /fill-empty|NULLIF\(BTRIM/i);
assert.match(repository, /sync_outbox|hot_chat_sync_outbox/);
assert.match(repository, /ValidateScopeAsync/);

assert.equal(exists('server/src/Zhike.Api/Routes/HotChatRoutes.cs'), true);
const routes = read('server/src/Zhike.Api/Routes/HotChatRoutes.cs');
for (const endpoint of ['/profiles', '/profiles/{id}', '/profiles/{id}/fields', '/profiles/{id}/events', '/diagnostics']) {
  assert.match(routes, new RegExp(endpoint.replace(/[{}]/g, '\\$&')));
}
assert.match(routes, /Results\.Conflict/);
assert.match(routes, /X-State-Version|State-Version/i);
assert.match(routes, /MapHotChatRoutes/);

const program = read('server/src/Zhike.Api/Program.cs');
assert.match(program, /AddSingleton<HotChatProfileRepository>/);
assert.match(program, /MapHotChatRoutes\(\)/);

const customer = read('server/src/Zhike.Infrastructure/Repositories/CustomerRepository.cs');
assert.match(customer, /StatusColor|status_color/i, 'customer projection must expose hot-chat color');
assert.match(customer, /ProfileSummary|profile_summary/i, 'customer projection must expose hot-chat summary');
assert.match(customer, /Tags|tags/i, 'customer projection must expose hot-chat tags');

console.log('server-v2 hot-chat profile contract checks passed');
