'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(repo, 'resources/app/modules/ws-workbench.css'), 'utf8');

assert.match(css, /body\.ws-mode \.view-container\{[^}]*overscroll-behavior:none/,
  'WS page must not pass wheel overscroll to the global page');
assert.match(css, /\.ws-layout\{[^}]*overscroll-behavior:contain/,
  'WS layout must contain nested scroll chains');
for (const selector of ['ws-account-list', 'ws-session-list', 'ws-capture-panel', 'ws-message-list', 'ws-assist-panel']) {
  const rule = new RegExp(`\\.${selector}[^}]*overscroll-behavior:contain`);
  assert.match(css, rule, `${selector} must own its scroll chain`);
}
assert.match(css, /\.ws-account-list[^}]*touch-action:pan-y/,
  'account list must route pointer scrolling vertically');
assert.match(css, /\.ws-message-list[^}]*scrollbar-gutter:stable/,
  'message list must keep layout stable while its scrollbar appears');

console.log('ws scroll routing contract: nested panes contain wheel/touch scrolling');
