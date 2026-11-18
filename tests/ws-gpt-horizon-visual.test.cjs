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
const gptTitle = [...gpt.matchAll(/\.gpt-page \.gpt-page-heading \.page-title\s*\{([^}]*)\}/g)]
  .flatMap(([, rule]) => rule.match(/font-size:[^;]+/g) || []);
assert.deepEqual(gptTitle, ['font-size:var(--ds-font-page,20px)!important'],
  'the GPT-only title owner takes precedence over legacy important title rules at all widths');
const gptCheckHeights = [...gpt.matchAll(/\.gpt-page [^{}\n]*\.gpt-context-section \.gpt-check\s*\{([^}]*)\}/g)]
  .flatMap(([, rule]) => rule.match(/min-height:[^;]+/g) || []);
assert.deepEqual(gptCheckHeights, ['min-height:var(--ds-control-height,44px)'],
  'wide and narrow GPT checkbox labels share the 44px hit target');

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

assert.match(global, /html\[data-palette\]:not\(\[data-view="ws-workbench"\]\):not\(\[data-view="gpt"\]\)/, 'palette-aware global page finishing explicitly excludes WS/GPT');
assert.match(wsRuntime, /host\.state\.view = 'ws-workbench';\s*document\.documentElement\.dataset\.view = 'ws-workbench';/, 'opening WS updates the page route marker so home chrome cannot remain visible');
assert.match(ws, /body\.ws-mode \.ws-error-banner\{[^}]*rgba\(103,39,38/, 'WS errors use the cockpit palette');
assert.match(ws, /body\.ws-mode \.ws-status-badge\[data-status="等待登录"\]/, 'pending WS login has a dark status style');
assert.match(ws, /body\.ws-mode \.ws-hot-profile-field\[data-state="pending"\]\{[^}]*background:rgba\(145,111,56/, 'pending profile facts do not fall back to the old light card');
assert.match(ws, /body\.ws-mode \.ws-hot-profile-input\[aria-readonly="true"\]\{[^}]*background:rgba\(2,13,19/, 'read-only profile fields remain legible on dark cards');
assert.match(ws, /body\.ws-mode \.ws-followup-alert\.urgent\{border-left-color:/, 'urgent reminders retain their distinct cue');
assert.match(ws, /\.ws-layout\.left-collapsed\.right-collapsed/, 'both WS sidebars remain collapsible');
assert.match(ws, /\.ws-browser-host:after\{[^}]*pointer-events:none/, 'browser frame decoration cannot intercept WhatsApp clicks');
assert.match(ws, /\.ws-session-list\{flex:1 1 auto;min-height:0\}/, 'conversation list retains its own scroll region');
const workspaceStart = ws.indexOf('body.ws-workspace-active{');
assert.ok(workspaceStart >= 0, 'the independent WS workspace has one scoped design section');
assert.equal([...ws.matchAll(/body\.ws-workspace-active\s*\{/g)].length, 1, 'one active WS root owns workspace presentation');
const workspace = ws.slice(workspaceStart);
assert.doesNotMatch(workspace, /html\[data-motion="off"\]\s+html\b/, 'the motion gate must target the same document root as density');
assert.equal([...workspace.matchAll(/--ws-table-pad-block:\s*4px\b/g)].length, 1, 'compact table padding has one owner');
assert.match(workspace, /html\[data-density="compact"\] body\.ws-workspace-active \.ws-workbench-shell\s*\{\s*--ws-row-height:47px;\s*--ws-table-pad-block:4px;\s*\}/, 'compact table spacing is independent of motion settings');

const shellDescendants = ['', '::before', '::after'].map(suffix => 'body.ws-workspace-active .ws-workbench-shell *' + suffix);
const motionRules = [...workspace.matchAll(/(?:^|[{}])([^{}]*\.ws-workbench-shell \*[^{}]*)\{([^{}]*)\}/g)]
  .filter(([, , declarations]) => /animation:\s*none\s*!important/.test(declarations));
assert.equal(motionRules.length, 2, 'the shell has one motion rule for each preference source');
const [[, explicitMotion], [, systemMotion]] = motionRules;
const selectors = list => list.split(',').map(selector => selector.trim());
assert.deepEqual(selectors(explicitMotion), shellDescendants.map(selector => 'html[data-motion="off"] ' + selector),
  'every selector in the explicit motion rule must require the app motion setting to be off');
assert.deepEqual(selectors(systemMotion), shellDescendants, 'system reduced motion covers the shell and its pseudo-elements');
assert.match(workspace, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*body\.ws-workspace-active \.ws-workbench-shell \*,\s*body\.ws-workspace-active \.ws-workbench-shell \*::before,\s*body\.ws-workspace-active \.ws-workbench-shell \*::after\s*\{[^}]*animation:\s*none\s*!important/,
  'the system motion rule is scoped to the reduced-motion media query');

assert.match(workspace, /body\.ws-workspace-active \.view-container\{[^}]*flex:1 1 0[^}]*padding:0!important[^}]*overflow:hidden/, 'the active WS route gives its own shell the remaining viewport');
for (const token of ['--ws-bg:var(--ds-bg,#f3f6fd)', '--ws-panel:var(--ds-surface,#fff)', '--ws-nav-width:250px', '--ws-nav-rail:76px', '--ws-control-height:var(--ds-control-height,44px)', '--ws-space:16px']) assert.ok(workspace.includes(token), `WS workspace retains its ${token} design contract`);
assert.match(workspace, /color-scheme:var\(--ds-color-scheme,light\)/, 'WS controls follow the explicitly selected shared palette');
assert.match(workspace, /--ws-on-accent:var\(--ds-on-primary-fill,#fff\)/, 'gradient accent text uses the shared fill contrast foreground');
assert.match(workspace, /\.ws-error-banner\{[^}]*background:var\(--ws-danger-soft\);color:var\(--ws-danger\)/, 'active WS errors use the semantic danger palette');
assert.match(workspace, /\.ws-page-heading \.page-title\)\{[^}]*font-size:var\(--ds-font-page,20px\)!important/, 'WS headings retain the readable workspace title size');
assert.match(workspace, /\.workspace-chat \.ws-login-toolbar\{[^}]*display:flex[^}]*min-height:54px;padding:4px 12px/, 'foreground chat fits 44px controls plus padding and border in one stable 54px command band');
assert.match(workspace, /\.workspace-chat \.ws-toolbar-actions\{[^}]*flex-wrap:nowrap[^}]*overflow-x:auto/, 'foreground chat actions remain reachable without adding a toolbar row');
assert.match(workspace, /\.workspace-chat \.ws-toolbar-actions>\.btn\{[^}]*min-height:44px[^}]*font-size:var\(--ds-font-body,14px\)/, 'chat controls retain readable targets across display scales');
assert.match(workspace, /\.workspace-chat \.ws-browser-host\{[^}]*flex:1 1 0[^}]*min-height:0/, 'the native host fills the remaining chat region without a competing fixed height');
assert.doesNotMatch(workspace, /transform:\s*scale|zoom\s*:/, 'the embedded WhatsApp page is never scaled');

assert.match(finish, /\.gpt-page \.gpt-message:not\(\.is-error\) \.gpt-message-body\{[^}]*background:linear-gradient/, 'GPT messages use the Horizon dark surface');
assert.match(finish, /@container \(max-width:760px\)\{[\s\S]*?\.gpt-page \.gpt-modern \.gpt-context\{[^}]*overflow-y:auto/, 'narrow GPT controls remain scrollable');
assert.match(finish, /\.gpt-page \.gpt-modern \.gpt-context \.gpt-history[^}]*display:grid/, 'narrow GPT history remains reachable');
assert.match(finish, /\.gpt-page \.gpt-modern \.gpt-context \.gpt-provider-card\{display:flex\}/, 'narrow GPT provider settings remain reachable');
assert.match(finish, /\.gpt-page \.gpt-modern \.gpt-context \.gpt-local-import[^}]*display:block/, 'narrow GPT local file import remains reachable');
assert.doesNotMatch(finish, /display:none/, 'Horizon finish must not hide an operation');
assert.match(finish, /@media \(max-height:620px\)\{[\s\S]*?max-height:min\(25dvh,140px\)/, 'short windows keep a bounded control scroller');
console.log('WS and GPT Horizon visual scope, dark states, narrow control reachability and scroll contract pass');
