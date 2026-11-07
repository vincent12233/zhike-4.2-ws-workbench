'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const desktopRoot = path.join(repo, 'desktop', 'src', 'Zhike.Desktop');
const pages = ['HomePage', 'CustomersPage', 'ImportPage', 'OperationsPage', 'WsWorkbenchPage', 'AiFollowupPage'];
for (const page of pages) {
  assert.equal(fs.existsSync(path.join(desktopRoot, 'Views', `${page}.xaml`)), true, `missing ${page}.xaml`);
  assert.equal(fs.existsSync(path.join(desktopRoot, 'Views', `${page}.xaml.cs`)), true, `missing ${page}.xaml.cs`);
}
for (const service of ['ApiClient.cs', 'LocalQueue.cs', 'WindowLayoutService.cs', 'WebViewProfileService.cs', 'NotificationService.cs'])
  assert.equal(fs.existsSync(path.join(desktopRoot, 'Services', service)), true, `missing desktop service ${service}`);

const windowXaml = fs.readFileSync(path.join(desktopRoot, 'MainWindow.xaml'), 'utf8');
for (const tag of ['customers', 'import', 'operations', 'ws', 'ai']) assert.match(windowXaml, new RegExp(`Tag="${tag}"`));
const wsXaml = fs.readFileSync(path.join(desktopRoot, 'Views', 'WsWorkbenchPage.xaml'), 'utf8');
assert.match(wsXaml, /WebView2/);
assert.match(wsXaml, /ToggleLeftPane/);
assert.match(wsXaml, /ToggleRightPane/);
const wsCode = fs.readFileSync(path.join(desktopRoot, 'Views', 'WsWorkbenchPage.xaml.cs'), 'utf8');
assert.match(wsCode, /GridLength\(_leftCollapsed \? 0 : 220\)/);
assert.match(wsCode, /GridLength\(_rightCollapsed \? 0 : 300\)/);
const layout = fs.readFileSync(path.join(desktopRoot, 'Services', 'WindowLayoutService.cs'), 'utf8');
assert.match(layout, /Math\.Max\(820/);
assert.match(layout, /Math\.Max\(540/);
assert.match(layout, /DpiScale/);
const profile = fs.readFileSync(path.join(desktopRoot, 'Services', 'WebViewProfileService.cs'), 'utf8');
assert.match(profile, /ws-profiles/);
assert.match(profile, /CreateWithOptionsAsync/);
const queue = fs.readFileSync(path.join(desktopRoot, 'Services', 'LocalQueue.cs'), 'utf8');
assert.match(queue, /File\.Move\(temp, _path, true\)/);
assert.doesNotMatch(queue, /password|cookie|qr/i);

console.log('desktop smoke contract: native page responsibilities, WS WebView2 boundary, collapse layout, DPI floor and offline queue pass');
