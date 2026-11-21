'use strict';
// V5.0 §24/§25: WS workspace rail geometry and toolbar compaction.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(repo, 'resources/app/modules/ws-workbench.css'), 'utf8');
const index = fs.readFileSync(path.join(repo, 'resources/app/index.html'), 'utf8');
const scope = 'html[data-view="ws-workbench"]';

const results = [];
function check(name, fn) {
  try { fn(); results.push(true); console.log('PASS ' + name); }
  catch (error) { results.push(false); console.log('FAIL ' + name + ' :: ' + error.message); }
}
const rule = pattern => pattern.test(css);

check('every destination row is a 44px grid with an aligned icon column', () => {
  assert.ok(rule(/html\[data-view="ws-workbench"\] #mainNav \.nav-item\{[^}]*grid-template-columns:20px minmax\(0,1fr\) auto[^}]*min-height:44px/), 'nav row grid');
  assert.ok(rule(/html\[data-view="ws-workbench"\] #mainNav \.nav-item svg\{[^}]*width:19px/), 'icon size');
});
check('labels truncate instead of stretching the rail', () => {
  assert.ok(rule(/html\[data-view="ws-workbench"\] #mainNav \.nav-item>span\{[^}]*text-overflow:ellipsis/));
});
check('the legacy aurora animation is gone from the rail', () => {
  assert.ok(rule(/html\[data-view="ws-workbench"\] #mainNav \.nav-item\{[^}]*animation:none!important/));
  assert.ok(rule(/html\[data-view="ws-workbench"\] #mainNav \.nav-item\.active\{[^}]*animation:none!important/));
});
check('active and hover states are distinguishable without motion', () => {
  assert.ok(rule(/html\[data-view="ws-workbench"\] #mainNav \.nav-item:hover:not\(\.active\)\{[^}]*rgba\(114,215,226,\.10\)/));
  assert.ok(rule(/html\[data-view="ws-workbench"\] #mainNav \.nav-item\.active\{[^}]*inset 3px 0 #7dffe6/));
});
check('badges keep a stable width and right alignment', () => {
  for (const tone of ['coral', 'amber', 'muted']) assert.ok(rule(new RegExp('html\\[data-view="ws-workbench"\\] #mainNav \\.nav-count\\.' + tone + '\\{')), tone);
  assert.ok(rule(/\.nav-count\{[^}]*font-variant-numeric:tabular-nums/));
  assert.ok(rule(/\.nav-count\{[^}]*margin-left:auto/));
});
check('the rail scrolls with a quiet thin scrollbar', () => {
  assert.ok(rule(/html\[data-view="ws-workbench"\] #mainNav\{[^}]*scrollbar-width:thin/));
  assert.ok(rule(/#mainNav::-webkit-scrollbar\{width:8px\}/));
});
check('the bottom account area is separated, truncated and 44px tall', () => {
  assert.ok(rule(/html\[data-view="ws-workbench"\] #sidebar \.sidebar-bottom\{[^}]*border-top/));
  assert.ok(rule(/html\[data-view="ws-workbench"\] #sidebar \.profile-button\{[^}]*min-height:44px/));
  assert.ok(rule(/profile-button strong\)\{[^}]*text-overflow:ellipsis/));
});
check('collapsed rail keeps only icons', () => {
  assert.ok(rule(/html\[data-view="ws-workbench"\] #sidebar\.collapsed #mainNav \.nav-item\{grid-template-columns:1fr/));
  assert.ok(rule(/html\[data-view="ws-workbench"\] #sidebar\.collapsed #mainNav :is\(\.nav-item span,\.nav-count,\.live-dot,\.nav-group-label\)\{display:none!important\}/));
});
check('the toolbar is compact but keeps 44px controls', () => {
  assert.ok(rule(/html\[data-view="ws-workbench"\] \.topbar\{min-height:56px!important/));
  assert.ok(rule(/html\[data-view="ws-workbench"\] \.global-search\{height:44px!important/));
  assert.ok(rule(/html\[data-view="ws-workbench"\] \.top-actions\{gap:8px!important/));
});
check('the sync status and breadcrumb never clip mid-word', () => {
  assert.ok(rule(/html\[data-view="ws-workbench"\] \.topbar \.sync-status\{[^}]*text-overflow:ellipsis/));
  assert.ok(rule(/html\[data-view="ws-workbench"\] \.topbar \.breadcrumbs strong\{[^}]*text-overflow:ellipsis/));
});
check('the rail keeps every destination and badge hook the app updates', () => {
  for (const id of ['navCustomerCount', 'navHotCount', 'navVipCount', 'navTicketCount', 'navRegistrationCount', 'navQualityCount', 'navPhoneRegistryCount']) {
    assert.ok(index.includes(`id="${id}"`), id);
  }
  assert.ok(index.includes('id="mainNav"'));
  assert.ok(index.includes('class="sidebar-bottom"'));
});

const failed = results.filter(ok => !ok).length;
console.log(`WS shell chrome: ${results.length - failed}/${results.length}`);
if (failed) process.exit(1);
