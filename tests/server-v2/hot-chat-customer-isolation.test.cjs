'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const hot = read('server/src/Zhike.Infrastructure/Repositories/HotChatProfileRepository.cs');
const ai = read('server/src/Zhike.Infrastructure/Repositories/AiAnalysisRepository.cs');

// is_investor is a hot-chat profile fact. It has no compatible legacy
// customers.status meaning and must never overwrite that business status.
assert.doesNotMatch(hot, /\["is_investor"\]\s*=\s*"status"/i,
  'is_investor must not be projected into the legacy customer status column');
assert.match(hot, /"is_investor"/, 'hot-chat profile must retain the investor fact');

// Every PostgreSQL hot-chat mutation must fence the account + conversation +
// customer tuple before reading or writing a profile.
assert.match(hot, /ValidateScopeAsync\(connection, transaction, accountId, conversationId, customerId/,
  'profile upsert must validate account/conversation/customer scope');
assert.match(hot, /WHERE id = \$1 AND account_id = \$2 AND conversation_id = \$3 AND customer_id = \$4/,
  'profile updates must remain account/conversation/customer scoped');

// AI identity resolution must be deterministic: linked conversation first,
// then explicit customer id, then phone; ambiguous phone matches are rejected
// rather than silently merged.
assert.match(ai, /ValidateConversationScopeAsync\(connection, transaction, input\.AccountId, input\.ConversationId/,
  'AI sync must validate account ownership before resolving a customer');
assert.match(ai, /ORDER BY i\.is_primary DESC, i\.customer_id LIMIT 2/,
  'identity lookup must bound candidates to detect ambiguity');
assert.match(ai, /candidates\.Count > 1\) throw new InvalidOperationException\("电话号码匹配到多个客户，未自动合并。"\)/,
  'ambiguous identity matches must require manual confirmation');
assert.match(ai, /phoneCandidates\.Count > 1\) throw new InvalidOperationException\("电话号码匹配到多个客户，未自动合并。"\)/,
  'ambiguous legacy phone matches must require manual confirmation');
assert.match(ai, /UPDATE conversations SET customer_id = COALESCE\(customer_id, \$2\)/,
  'AI sync must never replace an already linked conversation customer');

console.log('server-v2 hot-chat customer isolation: legacy status safety, account fencing and ambiguity guards pass');
