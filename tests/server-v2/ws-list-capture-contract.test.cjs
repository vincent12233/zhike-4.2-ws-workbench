'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const contracts = read('server/src/Zhike.Contracts/WsConnectorContracts.cs');
const routes = read('server/src/Zhike.Api/Routes/WsRoutes.cs');
const repository = read('server/src/Zhike.Infrastructure/Repositories/WsRepository.cs');
const transport = read('connectors/ws-worker/src/checkpoint-client.mjs');

assert.match(contracts, /record\s+WsConversationEnvelope\s*\(/, 'WS ingest contract exposes conversation-list rows');
assert.match(contracts, /IReadOnlyList<WsConversationEnvelope>\?\s+Conversations/, 'batch request carries conversation list');
assert.match(transport, /Array\.isArray\(batch\.conversations\)/, 'connector transport forwards list-level capture');
assert.match(transport, /\n\s*conversations,\s*\n/, 'connector transport includes conversations in payload');
assert.match(routes, /request\.Conversations/, 'API validates list-level capture rows');
assert.match(routes, /WsConversationInput/, 'API maps list rows to repository input');
assert.match(repository, /record\s+WsConversationInput\s*\(/, 'repository exposes conversation-list input');
assert.match(repository, /conversations\s*\?\?\s*Array\.Empty<WsConversationInput>/, 'batch transaction consumes conversation rows');
assert.match(repository, /ConversationsAccepted/, 'batch result reports conversation rows accepted');
assert.match(repository, /candidate|ambigu|多候选|Count\s*==\s*1/, 'phone matching has an ambiguity guard');
assert.doesNotMatch(repository, /UNION ALL\s+SELECT id FROM customers[\s\S]{0,240}LIMIT 1/, 'phone matching must not arbitrarily bind one duplicate customer');
assert.match(repository, /ORDER BY\s+COALESCE\(sent_at,\s*observed_at\)\s+DESC/, 'AI context ordering includes undated messages');

console.log('WS list capture contract: conversation forwarding, persistence, ambiguity guard and context ordering pass');
