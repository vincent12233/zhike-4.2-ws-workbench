'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const desktopRoot = path.join(repo, 'desktop', 'src', 'Zhike.Desktop');
const readDesktop = relative => fs.readFileSync(path.join(desktopRoot, relative), 'utf8');

for (const service of ['ApiClient.cs', 'LocalQueue.cs', 'LocalServiceManager.cs', 'WindowLayoutService.cs', 'WebViewProfileService.cs', 'WsAccountStore.cs'])
  assert.equal(fs.existsSync(path.join(desktopRoot, 'Services', service)), true, `missing desktop service ${service}`);

const windowXaml = readDesktop('MainWindow.xaml');
const windowCode = readDesktop('MainWindow.xaml.cs');
const appXaml = readDesktop('App.xaml');
const hostCode = readDesktop('Views/LegacyUiHostPage.xaml.cs');
const hostXaml = readDesktop('Views/LegacyUiHostPage.xaml');
const project = readDesktop('Zhike.Desktop.csproj');

assert.match(appXaml, /XamlControlsResources/);
for (const token of ['ZhikePageBackgroundBrush', 'ZhikeNavyBrush', 'ZhikeTealBrush', 'ZhikeSurfaceBrush'])
  assert.match(appXaml, new RegExp(token), `App.xaml missing visual token ${token}`);
assert.match(windowXaml, /<Frame x:Name="ContentFrame"/);
assert.doesNotMatch(windowXaml, /<NavigationView\b|NativeHeader/);
assert.match(windowCode, /知客 6\.0\.1  Horizon Atelier/, 'native window title must show the installed release version');
assert.match(windowCode, /OnAppWindowClosing/);
assert.match(windowCode, /FlushThenCloseAsync/);
assert.match(windowCode, /ContentFrame\.Navigate\(typeof\(LegacyUiHostPage\)\)/);
assert.doesNotMatch(windowCode, /NativeFallbackRoutes|FallbackRequested|typeof\((?:Home|Customers|Import|Operations|AiFollowup|WsWorkbench)Page\)/);
assert.match(windowCode, /SetIcon\(/);
assert.match(windowCode, /_allowCloseAfterFlush\s*=\s*true/);

assert.match(hostCode, /FlushBeforeCloseAsync/);
assert.match(hostCode, /PROFILE_CLEAR_FAILED/);
assert.match(hostCode, /OnLegacyNavigationStarting/);
assert.match(hostCode, /OnWsNavigationStarting/);
assert.match(hostCode, /NewWindowRequested/);
assert.match(hostCode, /args\.Handled\s*=\s*true/);
assert.match(hostCode, /CloseWsOverlayAsync\(false/);
assert.match(hostCode, /TimeSpan\.FromSeconds\(5\)/);
assert.match(hostCode, /Debug\.WriteLine/);
assert.match(hostXaml, /WebViewHost[^>]*SizeChanged="OnWebViewHostSizeChanged"/);
assert.doesNotMatch(hostXaml + hostCode, /打开兼容页面|OpenNativeFallback|FallbackRequested/);
assert.match(hostCode, /__zhikeWsDiscoverAll/);
assert.match(hostCode, /lastMessagePreview/);
assert.match(hostCode, /unreadCount/);

const excludedPages = project.match(/<Page Remove="([^"]+)"/)?.[1] || '';
const excludedCode = project.match(/<Compile Remove="([^"]+)"/)?.[1] || '';
for (const page of ['HomePage', 'CustomersPage', 'ImportPage', 'OperationsPage', 'AiFollowupPage', 'WsWorkbenchPage']) {
  assert.match(excludedPages, new RegExp(`${page}\\.xaml`));
  assert.match(excludedCode, new RegExp(`${page}\\.xaml\\.cs`));
}

const layout = readDesktop('Services/WindowLayoutService.cs');
assert.match(layout, /DpiScale/);
assert.match(layout, /SaveAsync/);
assert.match(layout, /LoadAsync/);
const profile = readDesktop('Services/WebViewProfileService.cs');
assert.match(profile, /ws-profiles/);
assert.match(profile, /CreateWithOptionsAsync/);
assert.match(profile, /Task<bool> ClearProfileAsync/);
const accounts = readDesktop('Services/WsAccountStore.cs');
assert.match(accounts, /accounts\.json/);
assert.match(accounts, /File\.Move\(temporary, _path, true\)/);
const queue = readDesktop('Services/LocalQueue.cs');
assert.match(queue, /File\.Move\(temp, _path, true\)/);
assert.match(queue, /corrupt-/);
assert.doesNotMatch(queue, /password|cookie|qr/i);
const api = readDesktop('Services/ApiClient.cs');
assert.match(api, /ConfigureLocalSidecar/);
assert.match(api, /GetStateDocumentAsync/);
assert.match(api, /CommitImportAsync/);
assert.doesNotMatch(api, /api\/v2\//);
assert.match(project, /Microsoft\.Web\.WebView2" Version="1\.0\.3719\.77"/);

console.log('desktop smoke contract: single workbench, WebView2 boundary, SQLite services, close safety and retired fallback exclusion pass');
