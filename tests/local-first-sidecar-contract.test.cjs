'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const repo = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(repo, 'scripts', 'build-winui-bundle.ps1'), 'utf8');
assert.match(script, /node\.exe/);
assert.match(script, /server\.mjs/);
assert.match(script, /state-delta\.cjs/);
assert.match(script, /migrations/);
assert.doesNotMatch(script, /blockedResourceNames[^\n]*node\.exe/);

const installer = fs.readFileSync(path.join(repo, 'scripts', 'build-winui-installer.ps1'), 'utf8');
assert.doesNotMatch(installer, /blockedStageNames[^\n]*node\.exe/);
assert.doesNotMatch(installer, /blockedStageNames[^\n]*server\.mjs/);

console.log('local-first sidecar contract: Node runtime and SQLite service assets are eligible for the WinUI bundle');
