'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const ws = read('resources/app/modules/ws-workbench.js');
const scroll = read('resources/app/modules/scroll-coordinator.js');
const css = read('resources/app/modules/ws-workbench.css');
const app = read('resources/app/app.js');
const gpt = read('resources/app/modules/gpt-assistant.js');

// The native WS surface must remain mounted while state changes redraw the
// surrounding shell; detaching the anchor causes WebView2 to jump/flicker.
assert.doesNotMatch(ws, /preservedBrowserHost\?\.remove\?\.\(\)/,
  'WS redraw must never detach the live browser host');
assert.doesNotMatch(ws, /preservedAssistPanel\?\.remove\?\.\(\)/,
  'WS redraw must never detach the live assistant scroll pane');
assert.match(ws, /mountWsWorkbenchShell\(/,
  'WS redraws must use an incremental shell patcher');
assert.match(ws, /browserResizeObservedHost/,
  'ResizeObserver must be retained for the same WS host node');

// A contained pane only owns a wheel event when it actually moves. At a
// boundary the browser must be allowed to hand the gesture to its parent/page.
assert.match(scroll, /if \(mode === 'contain'\) \{[\s\S]*?const owner = containedScrollOwner\(region, 'y', delta, modalOpen \? modal : null\);[\s\S]*?if \(!owner \|\| !applyDelta\(owner, 'y', delta\)\) return;[\s\S]*?event\.preventDefault\(\);/,
  'contained wheel routing must not swallow boundary events');

// The three-column WS layout must shrink its center column instead of forcing
// a 520px minimum that overflows ordinary desktop windows.
assert.match(css, /body\.ws-mode \.ws-layout\{[^}]*minmax\(0,1fr\)/,
  'WS center column must be shrinkable');
assert.doesNotMatch(css, /body\.ws-mode \.ws-layout\{[^}]*minmax\(520px,1fr\)/,
  'WS layout must not force a 520px center minimum');

// Archive/registration profile buttons must route through the same customer
// drawer action as table row clicks.
assert.match(app, /const customerButton=e\.target\.closest\('button\[data-customer\]'\)/,
  'customer profile buttons need an explicit delegated click handler');
assert.match(app, /customerButton[\s\S]*showCustomer\(customer\)/,
  'customer profile buttons must open the customer drawer');

// GPT settings/import bridge failures must be surfaced instead of becoming
// unhandled async rejections.
assert.match(gpt, /if\(e\.target\.id!=='gptProvider'\)return;[\s\S]*?try\{/,
  'provider status refresh must be guarded');
assert.match(gpt, /if\(action==='save-key'\|\|action==='remove-key'\)\{[\s\S]*?try\{[\s\S]*?await window\.zhikeAI\.removeKey\(\{provider\}\);[\s\S]*?\}catch\(error\)\{if\(settingsContextCurrent\(context\)\)/,
  'shared key mutation handler must guard remove-key errors and reject stale UI updates');
assert.match(gpt, /async function importExcelLocally\(file\)\{[\s\S]*?try\{[\s\S]*?loadState\(\)/,
  'Excel import state/bridge failures must be handled');

console.log('frontend high-priority fixes: WS mount, scroll boundaries, responsive layout, customer links and GPT errors contract pass');
