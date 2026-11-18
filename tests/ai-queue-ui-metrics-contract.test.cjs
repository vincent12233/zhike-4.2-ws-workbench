'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'resources', 'app', 'modules', 'ws-workbench.js'), 'utf8');
assert.match(source, /deadLetter/, 'WS workbench state and queue summary must expose dead-letter jobs');
assert.match(source, /retryCount/, 'WS workbench state must retain cumulative retry metrics');
assert.match(source, /function aiQueueSignature[\s\S]{0,240}deadLetter/, 'queue refresh signature must invalidate when dead-letter metrics change');
assert.match(source, /待重试[^\n]*死信/, 'AI analysis panel must display retryable and dead-letter metrics');
console.log('ai queue UI metrics contract: retry and dead-letter indicators are visible and refresh-safe');
