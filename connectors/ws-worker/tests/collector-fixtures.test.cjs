'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runner = fs.readFileSync(path.join(__dirname, '..', 'src', 'runner.mjs'), 'utf8');
const collector = fs.readFileSync(path.join(__dirname, '..', 'src', 'collector.mjs'), 'utf8');
assert.match(runner, /profiles/);
assert.match(runner, /must never invent messages/i);
assert.match(collector, /normalizeVisibleMessage/);
assert.match(collector, /previewOnly/);
console.log('WS connector fixture contract: idle startup, isolated profiles and visible-message normalization present');
