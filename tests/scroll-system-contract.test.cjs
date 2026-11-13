'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const index = read('resources/app/index.html');
const css = read('resources/app/modules/scroll-system.css');
const coordinator = read('resources/app/modules/scroll-coordinator.js');
const nativeHost = read('desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs');

assert.match(index, /modules\/design-system\.css[\s\S]*modules\/horizon-atelier\.css[\s\S]*modules\/scroll-system\.css/, 'scroll ownership must load after the 6.0 visual layer');
const stylesheetOrder = [...index.matchAll(/href="\.\/modules\/([^"?]+\.css)"/g)].map(match => match[1]);
assert.equal(stylesheetOrder.at(-1), 'scroll-system.css', 'scroll ownership must be the final CSS layer');
assert.match(index, /modules\/desktop-host\.js[\s\S]*modules\/scroll-coordinator\.js/, 'scroll coordinator must start after the existing business and desktop modules');

assert.match(css, /\.view-container\s*\{[\s\S]*?overflow-y:auto!important/, 'normal pages have one vertical page owner');
assert.match(css, /\.table-scroll,[\s\S]*?overflow-x:auto!important;[\s\S]*?overflow-y:hidden!important/, 'business tables own horizontal overflow only');
assert.match(css, /--zk-scrollbar-size:11px/, 'desktop scrollbars have a usable drag target');
assert.match(css, /html\.zk-scroll-modal-open \.view-container\{overflow:hidden!important\}/, 'dialogs freeze the background page');
assert.match(css, /body\.ws-mode \.view-container\{overflow:hidden!important/, 'WS keeps a fixed outer canvas');
assert.match(css, /@media \(pointer:coarse\)[\s\S]*--zk-scrollbar-size:14px/, 'touch/coarse pointers get a larger scrollbar');
assert.match(css, /html\[data-desktop-host\][\s\S]*\.main-area\{overflow:hidden\}/, 'desktop host bounds use the same final scroll contract');
assert.match(css, /:where\(\[data-scroll-mode\],#mainNav,#viewContainer\)::\-webkit-scrollbar/, 'scrollbars are styled only on registered scroll owners');
assert.doesNotMatch(css, /(?:^|\n)\*::\-webkit-scrollbar/m, 'large customer tables must not pay a universal scrollbar selector cost');
assert.match(css, /\.business-batch-list,[\s\S]*?\.v4-dimension-table,[\s\S]*?overflow-y:auto/, 'bounded legacy business lists use the unified vertical owner');
assert.match(css, /\.modal-backdrop\{background:[^}]*backdrop-filter:none!important\}/, 'full-window modal blur is disabled for smooth WebView2 scrolling');

assert.match(coordinator, /mode: 'page'[\s\S]*mode: 'contain'[\s\S]*mode: 'horizontal'/, 'page, contained and horizontal ownership modes exist');
assert.match(coordinator, /selector: '\.business-batch-list', mode: 'contain'/, 'business batch history is registered as a contained region');
assert.match(coordinator, /selector: '\.v4-dimension-table', mode: 'contain'/, 'dimension drilldown is registered as a contained region');
assert.match(coordinator, /sessionStorage\.setItem\(STORAGE_KEY/, 'route/region scroll positions survive DOM replacement in the session');
assert.match(coordinator, /document\.addEventListener\('wheel',[\s\S]*passive: false/, 'wheel routing can contain boundary gestures');
assert.match(coordinator, /document\.addEventListener\('keydown', onKeyDown/, 'keyboard scrolling uses the same ownership model');
assert.match(coordinator, /function containedScrollOwner[\s\S]*parent\.dataset\.scrollMode !== 'contain'/,
  'nested bounded panes hand wheel input only to a contained parent instead of swallowing it or moving the page');
assert.match(coordinator, /new MutationObserver\(records =>[\s\S]*observer\.observe\(view, \{ childList: true \}\)/, 'only direct page replacement is observed');
assert.doesNotMatch(coordinator, /observe\([^)]*,\s*\{[^}]*subtree:\s*true/, 'the scroll coordinator must not scan every WS/table mutation');
const modalFingerprint = coordinator.match(/function safeModalFingerprint\(modal\) \{[\s\S]*?\n  \}/)?.[0] || '';
assert.match(modalFingerprint, /modalActionAttributes/, 'modal scroll identity uses developer-owned semantic action attributes');
assert.doesNotMatch(modalFingerprint, /textContent|innerText|\.value\b/, 'modal scroll identity never reads customer text or form values');
assert.match(coordinator, /filter\(\(\[key\]\) => !key\.startsWith\('modal:'\)\)/, 'ephemeral modal positions are not persisted across app sessions');

const boundsObserver = nativeHost.match(/BuildWsBoundsObserverScript\(\) => """([\s\S]*?)""";/)?.[1] || '';
assert.match(boundsObserver, /signature === lastSignature/, 'native WS bounds are sent only when they change');
assert.match(boundsObserver, /mutationObserver\.observe\(mutationRoot, \{ childList:true \}\)/, 'native bounds watch only the owned route root');
assert.doesNotMatch(boundsObserver, /window\.addEventListener\('scroll'[\s\S]*capture:true/, 'nested scroll no longer floods the native bridge');
assert.doesNotMatch(boundsObserver, /mutationObserver\.observe\(document\.documentElement[\s\S]*subtree:true/, 'native bounds do not observe the complete document');

console.log('scroll system contract: single-axis ownership, accessible bars, modal freeze and bounded WS telemetry pass');
