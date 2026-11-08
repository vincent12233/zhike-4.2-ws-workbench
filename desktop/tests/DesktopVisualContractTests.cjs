'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(repo, file), 'utf8');
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
for (const route of expectedRoutes) {
  assert.match(index + main, route === 'gptAssistantNav' ? new RegExp(route) : new RegExp(`(?:data-view|Tag)=\\"${route}\\"`), `missing legacy route ${route}`);
}

for (const token of ['--navy:#172033', '--navy-2:#202b40', '--teal:#13a892', '--text:#202939', '--line:#e8edf2'])
  assert.match(styles, new RegExp(token.replace('#', '\\#')), `missing original visual token ${token}`);
assert.match(v41, /page-heading|metric-card|table-toolbar/, 'legacy page component system must remain available');
assert.match(main + mainCode, /LegacyUiHost|LegacyUiHostPage/, 'WinUI shell must host the original page system');
assert.match(main, /PaneDisplayMode="LeftCompact"/, 'desktop shell must keep compact left navigation');
assert.match(main, /x:Name="NativeHeader"/, 'native header must be independently collapsible');
assert.match(main, /x:Name="HeaderRow"/, 'native header row must collapse with the header');
assert.match(mainCode, /ApplyShellChrome\(\)/, 'shell chrome visibility must be centralized');
assert.match(mainCode, /NativeHeader\.Visibility\s*=\s*showNativeChrome/, 'legacy host must hide the duplicate native header');
assert.match(mainCode, /HeaderRow\.Height\s*=\s*showNativeChrome/, 'legacy host must reclaim the native header height');
assert.match(mainCode, /RootNavigation\.IsPaneVisible\s*=\s*showNativeChrome/, 'legacy host must hide the duplicate native navigation pane');
for (const token of ['ZhikeSuccessBrush', 'ZhikeSuccessBackgroundBrush', 'ZhikeWarningBrush', 'ZhikeDangerBrush', 'ZhikeAiBrush'])
  assert.match(app, new RegExp(token), `native shell missing semantic token ${token}`);
assert.match(app, /ZhikePageBackgroundBrush[^\n]*Color="#F4F7FB"/, 'native shell background must align with the web visual system');
assert.match(app, /ZhikeTealBrush[^\n]*Color="#0EA991"/, 'native shell accent must align with the web visual system');
assert.match(main, /HeaderRow" Height="52"/, 'native header must use the compact 52px rhythm');
assert.match(main, /ZhikeSuccessBackgroundBrush/, 'native status pill must use semantic success background');
assert.doesNotMatch(main, /Background="#E7F8F3"|Foreground="#0A806E"/, 'native header must not keep hardcoded status colors');

console.log('desktop visual contract: legacy routes, tokens and host boundary are present');
