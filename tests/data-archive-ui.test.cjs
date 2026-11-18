'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'resources/app/modules/v4-data-center.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'resources/app/modules/v4.css'), 'utf8');

assert.match(ui, /async function archiveSummary\(\)/, 'data center must expose an archive summary loader');
assert.match(ui, /\/api\/data-archive\/summary\?allAccounts=1/, 'data center must query the shared archive summary API');
for (const marker of [
  'v4ArchiveBridge',
  'data-v4-archive="customers"',
  'data-v4-archive="contacts"',
  'data-v4-archive="history"',
  'data-v4-archive="messages"',
  'data-v4-archive="pending"',
  'data-v4-archive="followups"',
  'data-v4-archive="groups"',
  'data-v4-archive="unlinked"',
  'data-v4-refresh-archive',
]) assert.match(ui, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\\\$&')), `archive bridge UI missing ${marker}`);
assert.match(ui, /archiveSummary\(\)\.catch/, 'archive summary failures must stay local to the data-center refresh');
for (const selector of ['.v4-archive-bridge', '.v4-archive-grid', '.v4-archive-footer']) {
  assert.match(css, new RegExp(`\\${selector}`), `archive bridge styling missing ${selector}`);
}

console.log('data-archive-ui: data center renders the SQLite archive bridge and refresh contract');
