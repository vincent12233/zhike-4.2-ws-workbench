'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const provider = read('server/src/Zhike.Worker/Providers/HttpAiAnalysisProvider.cs');
const dispatcher = read('server/src/Zhike.Worker/JobDispatcher.cs');
const sync = read('server/src/Zhike.Infrastructure/Repositories/AiAnalysisRepository.cs');
const reminder = read('server/src/Zhike.Worker/Workers/FollowupReminderWorker.cs');

// Task 4 RED contract: provider output is a natural-chat profile contract,
// not a generic single-message sentiment response.
for (const token of ['BuildPrompt', '自然聊天', '不要生成调查问卷', 'profileFacts', 'evidence', 'missingFields', 'naturalNextTopics', 'noReply', 'replySuggestion']) {
  assert.match(provider, new RegExp(token), `provider must expose ${token}`);
}
assert.match(provider, /requiresConfirmation|previewOnly/, 'reply suggestions must be preview-only');
assert.match(provider, /敏感|password|验证码|付款|退款|金融|法律|医疗/, 'sensitive reply guard must be explicit');
assert.match(provider, /429|quota|Timeout|timeout|格式|schema/i, 'provider must classify quota/timeout/schema errors');

// Dispatcher must stop malformed/low-confidence results before customer or
// follow-up side effects, while keeping the job retryable/dead-letterable.
assert.match(dispatcher, /Validate|IsValid|[Cc]onfidence.*0\.6|[Cc]onfidence.*0\.60|最低置信度/, 'dispatcher must gate low-confidence results');
assert.match(sync, /pending|Pending/, 'low-confidence facts must remain pending');
assert.match(dispatcher, /AiAnalysis.*(Malformed|Schema|Quota|Timeout)|Quota|Timeout/, 'dispatcher must distinguish provider failure classes');
assert.match(dispatcher, /duplicate|idempot|already/i, 'duplicate jobs must short-circuit side effects');

// Repository must carry exact Task 1 profile field/state/evidence semantics,
// protect manual locks, and dedupe reminders with a cooldown-aware key.
for (const field of ['preferred_name', 'age', 'gender', 'occupation', 'work_context', 'is_investor', 'investment_years', 'holdings', 'investment_habits', 'investment_preferences', 'family_context', 'life_interests', 'future_plans']) {
  assert.match(sync, new RegExp(field), `repository must map ${field}`);
}
for (const state of ['known', 'missing', 'pending', 'declined']) assert.match(sync, new RegExp(state), `repository must preserve ${state} state`);
assert.match(sync, /manual[_ ]?lock|manual_locked/i, 'repository must preserve manual locks');
assert.match(sync, /evidence|source_message_id|analysis_id/i, 'repository must persist evidence references');
assert.match(sync, /cooldown|last.*followup|dedupe.*analysis|source_message_id/i, 'follow-up writes must be cooldown/dedupe aware');
assert.match(sync, /account_id.*conversation_id|conversation_id.*account_id/, 'profile/customer resolution must remain account and conversation scoped');
assert.match(sync, /ON CONFLICT.*job_id|existing.*analysis|duplicate/i, 'repeated analyses must be idempotent');
assert.match(sync, /AutoSyncAllowed|MinimumConfidence/, 'repository must gate low-confidence writes');
assert.doesNotMatch(sync, /input\.Fields/, 'repository must not reference a non-existent legacy result field map');
assert.match(sync, /ValidateConversationScopeAsync/, 'cross-account conversations must be rejected before customer creation');

// Reminder worker must atomically mark and enqueue one notification.
assert.match(reminder, /FOR UPDATE SKIP LOCKED/);
assert.match(reminder, /cooldown|dedupe|notified|ON CONFLICT/i);

console.log('server-v2 AI hot-chat worker contract: natural profile, safety and reminder gates pass');
