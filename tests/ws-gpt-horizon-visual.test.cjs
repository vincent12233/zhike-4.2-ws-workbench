'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const modules = path.join(__dirname, '../resources/app/modules');
const ws = readFileSync(path.join(modules, 'ws-workbench.css'), 'utf8');
const wsRuntime = readFileSync(path.join(modules, 'ws-workbench.js'), 'utf8');
const gpt = readFileSync(path.join(modules, 'gpt-modern.css'), 'utf8');
const global = readFileSync(path.join(modules, 'global-6.css'), 'utf8');
const finish = gpt.slice(gpt.indexOf('/* Horizon 6.0 GPT finish.'));
assert.ok(finish, 'GPT Horizon finish exists');

function balanced(name, css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0;
  for (const char of withoutComments) {
    if (char === '{') depth++;
    if (char === '}') { depth--; assert.ok(depth >= 0, `${name} has an unmatched closing brace`); }
  }
  assert.equal(depth, 0, `${name} has an unmatched opening brace`);
}
balanced('WS', ws);
balanced('GPT', gpt);

assert.match(global, /html:not\(\[data-view="ws-workbench"\]\):not\(\[data-view="gpt"\]\)/, 'global page finishing excludes WS/GPT');
assert.match(wsRuntime, /host\.state\.view = 'ws-workbench';\s*document\.documentElement\.dataset\.view = 'ws-workbench';/, 'opening WS updates the page route marker so home chrome cannot remain visible');
assert.match(ws, /body\.ws-mode \.ws-error-banner\{[^}]*rgba\(103,39,38/, 'WS errors use the cockpit palette');
assert.match(ws, /body\.ws-mode \.ws-status-badge\[data-status="等待登录"\]/, 'pending WS login has a dark status style');
assert.match(ws, /body\.ws-mode \.ws-hot-profile-field\[data-state="pending"\]\{[^}]*background:rgba\(145,111,56/, 'pending profile facts do not fall back to the old light card');
assert.match(ws, /body\.ws-mode \.ws-hot-profile-input\[aria-readonly="true"\]\{[^}]*background:rgba\(2,13,19/, 'read-only profile fields remain legible on dark cards');
assert.match(ws, /body\.ws-mode \.ws-followup-alert\.urgent\{border-left-color:/, 'urgent reminders retain their distinct cue');
assert.match(ws, /\.ws-layout\.left-collapsed\.right-collapsed/, 'both WS sidebars remain collapsible');
assert.match(ws, /\.ws-browser-host:after\{[^}]*pointer-events:none/, 'browser frame decoration cannot intercept WhatsApp clicks');
assert.match(ws, /\.ws-session-list\{flex:1 1 auto;min-height:0\}/, 'conversation list retains its own scroll region');
assert.match(ws, /@media \(min-width:901px\)\{[\s\S]*?body\.ws-mode \.view-container\{[^}]*padding:5px 10px 6px!important/, 'WS desktop overrides global bottom padding that clipped the login viewport');
assert.match(ws, /body\.ws-mode \.ws-page-heading\{[^}]*margin:0!important;[^}]*padding:0 2px 3px!important/, 'WS title chrome stays compact despite global Horizon page rules');
assert.match(ws, /body\.ws-mode \.ws-login-toolbar\{[^}]*grid-template-columns:minmax\(130px,1fr\) minmax\(0,2fr\)/, 'WS account summary and runtime status share one row');
assert.match(ws, /body\.ws-mode \.ws-toolbar-actions\{[^}]*flex-wrap:nowrap;[^}]*overflow-x:auto/, 'all multi-account toolbar actions remain reachable without an extra row');
assert.match(ws, /body\.ws-mode \.ws-browser-host\{[^}]*min-height:min\(320px,calc\(100dvh - 300px\)\)/, 'embedded login gets at least 320 CSS pixels on a normal desktop window');
assert.doesNotMatch(ws.slice(ws.indexOf('/* Keep the native WhatsApp login/chat surface large')), /transform:\s*scale|zoom\s*:/, 'the embedded WhatsApp page is never scaled');

assert.match(finish, /\.gpt-page \.gpt-message:not\(\.is-error\) \.gpt-message-body\{[^}]*background:linear-gradient/, 'GPT messages use the Horizon dark surface');
assert.match(finish, /@container \(max-width:760px\)\{[\s\S]*?\.gpt-page \.gpt-modern \.gpt-context\{[^}]*overflow-y:auto/, 'narrow GPT controls remain scrollable');
assert.match(finish, /\.gpt-page \.gpt-modern \.gpt-context \.gpt-history[^}]*display:grid/, 'narrow GPT history remains reachable');
assert.match(finish, /\.gpt-page \.gpt-modern \.gpt-context \.gpt-provider-card\{display:flex\}/, 'narrow GPT provider settings remain reachable');
assert.match(finish, /\.gpt-page \.gpt-modern \.gpt-context \.gpt-local-import[^}]*display:block/, 'narrow GPT local file import remains reachable');
assert.doesNotMatch(finish, /display:none/, 'Horizon finish must not hide an operation');
assert.match(finish, /@media \(max-height:620px\)\{[\s\S]*?max-height:min\(25dvh,140px\)/, 'short windows keep a bounded control scroller');
console.log('WS and GPT Horizon visual scope, dark states, narrow control reachability and scroll contract pass');
