'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repo, file), 'utf8');
const index = read('resources/app/index.html');
const styles = read('resources/app/styles.css');
const v41 = read('resources/app/modules/v41-ui.css');
const app = read('desktop/src/Zhike.Desktop/App.xaml');
const main = read('desktop/src/Zhike.Desktop/MainWindow.xaml');
const mainCode = read('desktop/src/Zhike.Desktop/MainWindow.xaml.cs');

const expectedRoutes = [
  'home', 'intake', 'operations', 'stage-board', 'customers', 'segments', 'hot', 'groups', 'vip',
  'tickets', 'registrations', 'deposits', 'analytics', 'ws-workbench', 'automation', 'quality',
  'data', 'activity', 'recycle', 'settings', 'phone-registry', 'gptAssistantNav',
];
for (const route of expectedRoutes)
  assert.match(index, route === 'gptAssistantNav' ? new RegExp(route) : new RegExp(`data-view=\\"${route}\\"`), `workbench route is missing: ${route}`);

for (const token of ['--navy:#172033', '--navy-2:#202b40', '--teal:#13a892', '--text:#202939', '--line:#e8edf2'])
  assert.match(styles, new RegExp(token.replace('#', '\\#')), `missing visual token ${token}`);
assert.match(v41, /page-heading|metric-card|table-toolbar/);
assert.match(mainCode, /LegacyUiHostPage/, 'WinUI must host the complete workbench');
assert.match(main, /<Frame x:Name="ContentFrame"/);
assert.doesNotMatch(main, /<NavigationView\b|NativeHeader|HeaderRow/,
  'formal desktop must not keep a second hidden navigation system');
assert.doesNotMatch(mainCode, /ApplyShellChrome|NativeFallbackRoutes|ZHIKE_(?:DESKTOP_)?LEGACY_UI_HOST/);
for (const token of ['ZhikeSuccessBrush', 'ZhikeSuccessBackgroundBrush', 'ZhikeWarningBrush', 'ZhikeDangerBrush', 'ZhikeAiBrush'])
  assert.match(app, new RegExp(token), `native host missing semantic token ${token}`);
assert.match(app, /ZhikePageBackgroundBrush[^\n]*Color="#F4F7FB"/);
assert.match(app, /ZhikeTealBrush[^\n]*Color="#0EA991"/);

console.log('desktop visual contract: one Horizon workbench route system and one WinUI host boundary are present');
