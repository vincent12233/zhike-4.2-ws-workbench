'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(repo, file), 'utf8');
const index = read('resources/app/index.html');
const styles = read('resources/app/styles.css');
const v41 = read('resources/app/modules/v41-ui.css');
const main = read('desktop/src/Zhike.Desktop/MainWindow.xaml');

const expectedRoutes = [
  'home', 'intake', 'operations', 'stage-board', 'customers', 'segments', 'hot', 'groups', 'vip',
  'tickets', 'registrations', 'deposits', 'analytics', 'ws-workbench', 'automation', 'quality',
  'data', 'activity', 'recycle', 'settings', 'phone-registry', 'gptAssistantNav',
];
for (const route of expectedRoutes) {
  assert.match(index + main, route === 'gptAssistantNav' ? new RegExp(route) : new RegExp(`(?:data-view|Tag)=\\"${route}\\"`), `missing legacy route ${route}`);
}

for (const token of ['--navy:#172033', '--navy-2:#202b40', '--teal:#13a892', '--text:#202939', '--line:#e8edf2'])
  assert.match(styles, new RegExp(token.replace('#', '\\#')), `missing original visual token ${token}`);
assert.match(v41, /page-heading|metric-card|table-toolbar/, 'legacy page component system must remain available');
assert.match(main, /LegacyUiHost|LegacyUiHostPage/, 'WinUI shell must host the original page system');
assert.match(main, /PaneDisplayMode="LeftCompact"/, 'desktop shell must keep compact left navigation');

console.log('desktop visual contract: legacy routes, tokens and host boundary are present');
