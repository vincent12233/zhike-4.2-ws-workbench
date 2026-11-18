'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const css = read('resources/app/modules/ws-workbench.css');
const scrollCss = read('resources/app/modules/scroll-system.css');
const coordinator = read('resources/app/modules/scroll-coordinator.js');
const host = read('resources/app/modules/desktop-host.js');
const perf = read('resources/app/modules/desktop-performance.js');

// 6.0.3 layout contracts: closing the assistant must release the column.
assert.match(css, /body\.ws-mode \.ws-layout\.assist-closed\{grid-template-columns:[^}]*var\(--ws-rail/,
  'closed assistant layout must use the narrow rail instead of reserving a full assistant column');
assert.doesNotMatch(css, /body\.ws-mode \.ws-layout\.assist-closed[^}]*minmax\(250px/,
  'closed assistant layout must not reserve 250px+');

// The center panel is a layout shell. Message list and assistant body own vertical scroll.
assert.match(scrollCss, /\.ws-center-panel\{overflow:hidden!important[^}]*\}/,
  'center panel must remain a non-scrolling layout shell');
assert.doesNotMatch(scrollCss, /\.ws-center-panel\{overflow-x:hidden!important;overflow-y:auto!important/,
  'center panel must not become a competing vertical scroll owner');
assert.doesNotMatch(coordinator, /selector: '\.ws-center-panel', mode: 'contain'/,
  'scroll coordinator must not register the WS center shell as a scroll owner');

// Large tables need a bounded vertical owner so the page is not forced to render a giant document.
assert.match(scrollCss, /\.table-scroll,[\s\S]*?overflow-y:auto!important/,
  'large data tables must expose a bounded vertical scroll owner');
assert.match(scrollCss, /\.table-scroll,[\s\S]*?max-height:.*(?:vh|px)/,
  'large data tables must have a bounded viewport');

// Refresh scheduling must have backpressure instead of an unbounded while loop.
assert.match(host, /MAX_REFRESH_ITERATIONS|refreshBudget|refreshFrame/, 'desktop refresh queue must expose a bounded frame budget');
assert.doesNotMatch(host, /while\s*\([^)]*pending[^)]*\)\s*\{[\s\S]{0,260}refresh\(/,
  'desktop refresh queue must not drain an unbounded loop in one dispatcher turn');

// A coalesced caller must keep a caller-level cancellation race.
assert.match(perf, /AbortSignal|abort/i, 'coalescer must retain caller cancellation semantics');
assert.match(perf, /requestCoalescer/, 'desktop request coalescer remains the single read-only dedupe entry');

console.log('ws-scroll-stability: closed rail, single owner, bounded tables, refresh backpressure and cancellable reads are required');


