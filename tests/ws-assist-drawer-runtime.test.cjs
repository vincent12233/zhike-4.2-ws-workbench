'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(repo, 'resources/app/modules/ws-workbench.js'), 'utf8');
const css = fs.readFileSync(path.join(repo, 'resources/app/modules/ws-workbench.css'), 'utf8');
const coordinator = fs.readFileSync(path.join(repo, 'resources/app/modules/scroll-coordinator.js'), 'utf8');

assert.match(ui, /function readAssistDrawerState\(key/,
  'assistant drawer state must have a guarded local persistence reader');
assert.match(ui, /function writeAssistDrawerState\(key, value/,
  'assistant drawer state must have a guarded local persistence writer');
assert.match(ui, /assistDrawerOffset: readAssistDrawerState\('offset'\)/,
  'assistant drawer offset must survive a renderer redraw');
assert.match(ui, /function clampAssistDrawerWidth\(value\)/,
  'assistant drawer width must be clamped before it is persisted');
assert.match(ui, /data-ws-action="assist-drawer-handle"/,
  'assistant drawer must expose a native pointer drag handle');
assert.match(ui, /data-assist-drawer-drag="true"/,
  'assistant drawer header must expose a vertical drag surface');
assert.match(ui, /function handleAssistDrawerMoveStart\(event\)[\s\S]*?assistDrawerMove =/,
  'assistant drawer vertical offset must be updated without rebuilding the shell');
assert.match(ui, /const maxY = Math\.min\(64, Math\.max\(0, viewportHeight - 180\)\)/,
  'persisted drawer offsets must be clamped to the current viewport');
assert.match(ui, /function handleAssistDrawerMoveEnd\(event\)[\s\S]*?writeAssistDrawerState\('offset'/,
  'drawer movement must persist only after pointer release');
assert.match(ui, /keydown[\s\S]{0,500}Escape[\s\S]{0,500}closeAssistDrawer/,
  'Escape must close the assistant drawer');
assert.match(ui, /state\.assistDrawerOpen && !target\?\.closest\?\.\('#wsAssistDrawer, #wsBrowserHost/,
  'outside clicks must close the drawer without intercepting native WS clicks');
assert.match(ui, /function assistDrawerTabMeta\(tab\)/,
  'drawer header must derive its title from the selected tab');
assert.match(ui, /const meta = assistDrawerTabMeta\(nextTab\)[\s\S]{0,320}wsAssistDrawerTitle/,
  'switching a live tab must update the drawer title without a full redraw');
assert.doesNotMatch(ui, /currentHeader\.replaceWith\(nextHeader\.cloneNode\(true\)\)/,
  'background renders must preserve the live drawer header and resize handle');
assert.doesNotMatch(ui, /currentTabs\.replaceWith\(nextTabs\.cloneNode\(true\)\)/,
  'background renders must preserve the focused tab buttons');
assert.match(ui, /const activeBodyId = activeElement && currentBody\.contains\(activeElement\)[\s\S]{0,650}restored\.focus/,
  'background card refreshes must restore an active editor and its caret');
assert.match(ui, /render\(\{ skipNativeResize: true \}\);[\s\S]{0,220}focusAssistDrawerTab/,
  'opening a drawer tab must not resize the native WS WebView');
assert.doesNotMatch(ui, /function handleAssistDrawerResizeEnd\(event\)[\s\S]{0,500}queueResizeWsView\(\)/,
  'drawer resizing must not send native WebView resize calls');
assert.match(ui, /assistDrawerTab[\s\S]{0,600}data-assist-section/,
  'tab selection must resolve to an existing assistant card group');
assert.match(ui, /focus\(\)/,
  'assistant drawer must return focus to a stable trigger after close');
assert.match(css, /\.ws-assist-drawer\{[^}]*position:absolute/,
  'desktop assistant drawer must stay in the page layer and not alter native WebView bounds');
assert.match(css, /\.ws-assist-drawer-backdrop\{[^}]*pointer-events:auto/,
  'assistant drawer backdrop must receive outside clicks');
assert.match(css, /@media \(max-width:900px\)[\s\S]*?\.ws-assist-drawer\{[^}]*bottom:0/,
  'narrow windows must use a bottom sheet assistant drawer');
assert.match(coordinator, /ws-assist-drawer-body/,
  'scroll coordinator must recognize the assistant drawer body');
assert.doesNotMatch(coordinator, /ws-assist-panel.*scrollTop/,
  'scroll coordinator must not restore scroll on the unstable assistant root');

console.log('ws-assist-drawer-runtime: persistence, focus, drag, layer and scroll contracts are present');
