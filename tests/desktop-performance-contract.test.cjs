'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(repo, 'resources/app/index.html'), 'utf8');
const modulePath = path.join(repo, 'resources/app/modules/desktop-performance.js');
assert.equal(fs.existsSync(modulePath), true, 'desktop performance module must exist');
assert.match(index, /modules\/desktop-performance\.js/);
const source = fs.readFileSync(modulePath, 'utf8');
for (const token of ['shellInteractiveMs: 1500', 'routeSwitchMs: 300', 'wsMountMs: 3000', 'pauseHiddenPolling', 'requestCoalescer'])
  assert.match(source, new RegExp(token.replace(/[{}]/g, '\\$&')), `performance contract missing ${token}`);

console.log('desktop performance contract: budgets, hidden-poll pause and request coalescing are present');
