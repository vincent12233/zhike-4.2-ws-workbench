'use strict';
// Reply draft persistence contract.
//
// The operator's unsent reply text must survive a window close/reopen, scoped
// per account + conversation, without leaking across accounts, without storing
// AI previews/errors, without silently truncating or evicting unsent text.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const app = path.join(repo, 'resources', 'app');
const workbench = fs.readFileSync(path.join(app, 'modules', 'ws-workbench.js'), 'utf8');

// Recovery copies preserve input; send/copy limits belong to those actions.
assert.match(workbench, /const DRAFT_STORAGE_KEY = 'zhike\.ws\.reply-drafts';/, 'a dedicated storage key must be used');
assert.doesNotMatch(workbench, /DRAFT_MAX_CHARS|DRAFT_MAX_ENTRIES/, 'recovery must not silently clip or evict text');
assert.match(workbench, /function restoreDraftReply\(key\)/, 'draft restore must be keyed');
assert.match(workbench, /function scheduleDraftPersist\(key, value\)/, 'typing must debounce its write');
assert.match(workbench, /function flushDraftPersist\(\)/, 'an explicit flush must exist for shutdown');

// Only the reply textarea schedules persistence — not capture text or profile fields.
const applyInput = workbench.slice(workbench.indexOf('function applyInput('), workbench.indexOf('function activate()'));
assert.ok(applyInput.length > 0 && applyInput.length < 20000, 'applyInput must be extractable');
assert.match(applyInput, /target\.id === 'wsReplyInput'[\s\S]*?updateReplyDraftInput\(/, 'reply typing uses the same revision/persistence path as adopted suggestions');
assert.doesNotMatch(applyInput, /wsVisibleChat[\s\S]{0,200}scheduleDraftPersist/, 'captured chat text is never persisted as a draft');

// currentDraft must restore from the store when a draft is absent in memory.
const currentDraft = workbench.slice(workbench.indexOf('function currentDraft()'), workbench.indexOf('const HOT_PROFILE_LABELS'));
assert.match(currentDraft, /restoreDraftReply\(key\)/, 'an absent in-memory draft is restored from storage');
assert.match(currentDraft, /draft\.replyInput = restored/, 'the restored text lands in replyInput only');

// Shutdown flushes pending writes; the composed reply clears the stored draft.
assert.match(workbench, /beforeunload[\s\S]{0,200}flushDraftPersist\(\)/, 'beforeunload must flush pending draft writes');
assert.match(workbench, /draft\.replyInput = '';\s*\n\s*persistDraftReply\(/, 'a handled reply must clear its stored draft');

// The reply composer renders the restored text and only replyInput is echoed.
assert.match(workbench, /id="wsReplyInput"[\s\S]{0,120}\$\{esc\(draft\.replyInput\)\}/, 'the composer pre-fills from the draft');

assert.match(workbench, /id="wsDraftPersistenceStatus"[\s\S]{0,120}draftPersistenceMessage/, 'storage failure must have a visible composer status');
assert.match(workbench, /action === 'retry-draft-persist'[\s\S]{0,100}flushDraftPersist/, 'failed writes have a retry action');
console.log('ws reply draft persistence: scoping, complete recovery, visible failure, retry and clear contract pass');
