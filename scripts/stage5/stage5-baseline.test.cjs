'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const head = require('node:child_process').execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
assert.match(head, /^[0-9a-f]{7,40}$/);
const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'resources/app/migrations/manifest.json'), 'utf8'));
assert.equal(manifest.supportedSchemaVersion, 25, 'stage 5 correlation migration is registered');
assert.equal(fs.existsSync(path.join(repo, 'scripts', 'run-tests.cjs')), true);
assert.match(fs.readFileSync(path.join(repo, 'scripts', 'run-tests.cjs'), 'utf8'), /stage5/);
console.log(`stage5 baseline: HEAD ${head}, schema ${manifest.supportedSchemaVersion}`);
