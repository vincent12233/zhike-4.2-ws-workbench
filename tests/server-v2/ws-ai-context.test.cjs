'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(repo, 'server/src/Zhike.Infrastructure/Repositories/WsRepository.cs'), 'utf8');

// RED contract: every newly ingested message must give the AI worker a small,
// account-scoped conversation window. The window is bounded and ordered so a
// long chat cannot blow up provider latency or cross an account boundary.
assert.match(source, /LoadRecentContextAsync\(/, 'WS ingestion must load a bounded recent conversation context');
assert.match(source, /FROM messages[\s\S]{0,220}account_id\s*=\s*\$1[\s\S]{0,220}conversation_id\s*=\s*\$2/i, 'context query must scope both account and conversation');
assert.match(source, /ORDER BY COALESCE\(sent_at,\s*observed_at\) DESC[\s\S]{0,120}LIMIT (?:20|\{MaxContextMessages\})/i, 'context query must cap and fetch newest messages, including observed-only rows');
assert.match(source, /context\s*=\s*context/i, 'AI job payload must carry the context window');
assert.match(source, /MaxContextMessageChars|ContextMessageChars|2000/, 'each context message must be bounded');
assert.match(source, /MaxContextChars|ContextChars|20_000|20000/, 'the complete context payload must be bounded');
assert.match(source, /Reverse\(\)|\.Reverse\(\)/, 'context must be restored to chronological order for the prompt');

console.log('ws-ai-context: bounded, account-scoped chronological AI context contract passes');
