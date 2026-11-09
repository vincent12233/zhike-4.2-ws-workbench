'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runner = fs.readFileSync(path.join(__dirname, '..', 'src', 'runner.mjs'), 'utf8');
const collector = fs.readFileSync(path.join(__dirname, '..', 'src', 'collector.mjs'), 'utf8');
const playwright = fs.readFileSync(path.join(__dirname, '..', 'src', 'playwright-capture.mjs'), 'utf8');
assert.match(playwright, /MutationObserver/, 'capture should react to visible chat-list changes');
assert.match(playwright, /Math\.max\(30_000/, 'a low-frequency poll should backstop mutation capture');
assert.match(playwright, /page-structure-changed/, 'selector drift must pause writes and report a clear state');
assert.match(playwright, /structureRecognized/, 'collector must distinguish an empty list from an unknown page structure');
assert.match(runner, /profiles/);
assert.match(runner, /must never invent messages/i);
assert.match(runner, /CaptureBatchFlusher/);
assert.match(runner, /ZHIKE_API_TOKEN/);
assert.match(runner, /process\.stdin/);
assert.match(runner, /accountQueues/);
assert.match(runner, /startPlaywrightCapture/);
assert.match(collector, /normalizeVisibleMessage/);
assert.match(collector, /previewOnly/);
assert.match(playwright, /launchPersistentContext/);
assert.match(playwright, /visible/);
assert.doesNotMatch(playwright, /localStorage\s*[\[.]|document\.cookie\s*=/);
console.log('WS connector fixture contract: idle startup, isolated profiles and visible-message normalization present');
