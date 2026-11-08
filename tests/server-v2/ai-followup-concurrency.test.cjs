'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(
  path.join(repo, 'server/src/Zhike.Infrastructure/Repositories/AiAnalysisRepository.cs'),
  'utf8',
);

// RED/GREEN contract: follow-up cooldown and insertion must be serialized by
// the same customer+reason key. Otherwise two concurrent analyses can both
// pass the recent-task check and insert distinct analysis-id dedupe keys.
const lockIndex = source.indexOf('pg_advisory_xact_lock');
const recentIndex = source.indexOf('FROM followup_tasks');
assert.ok(lockIndex >= 0, 'follow-up sync must take a PostgreSQL transaction advisory lock');
assert.ok(recentIndex >= 0, 'follow-up sync must retain the recent-task cooldown check');
assert.ok(lockIndex < recentIndex, 'follow-up advisory lock must be acquired before the cooldown query');
const lockBlock = source.slice(Math.max(0, lockIndex - 240), Math.min(source.length, lockIndex + 520));
assert.match(lockBlock, /followup/i, 'advisory lock namespace must identify follow-up work');
assert.match(lockBlock, /customerId|customer_id/i, 'advisory lock must include customer identity');
assert.match(lockBlock, /reasonKey|reason_key/i, 'advisory lock must include follow-up reason');

console.log('ai-followup-concurrency: customer/reason advisory lock precedes cooldown and dedupe');
