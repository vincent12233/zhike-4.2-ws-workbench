'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const main = read('desktop/src/Zhike.Desktop/MainWindow.xaml.cs');
const mainXaml = read('desktop/src/Zhike.Desktop/MainWindow.xaml');
const host = read('desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs');
const hostXaml = read('desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml');
const project = read('desktop/src/Zhike.Desktop/Zhike.Desktop.csproj');
const bundle = read('scripts/build-winui-bundle.ps1');
const packageJson = JSON.parse(read('resources/app/package.json'));

assert.match(main, /ContentFrame\.Navigate\(typeof\(LegacyUiHostPage\)\)/,
  'every desktop route must enter the complete WebView2 workbench');
assert.doesNotMatch(main, /ZHIKE_(?:DESKTOP_)?LEGACY_UI_HOST|NativeFallbackRoutes|FallbackRequested/);
assert.doesNotMatch(main, /typeof\((?:Home|Customers|Import|Operations|AiFollowup|WsWorkbench)Page\)/,
  'retired partial native pages must not be routable');
assert.doesNotMatch(mainXaml, /<NavigationView\b|NativeHeader|OnNavigationChanged/,
  'the native window must not keep a second hidden sidebar/router');
assert.match(mainXaml, /<Frame x:Name="ContentFrame"/);

assert.doesNotMatch(host, /FallbackRequested|OpenNativeFallback|TryFallbackAsync/);
assert.doesNotMatch(hostXaml, /打开兼容页面|OpenNativeFallback/);
assert.match(host, /GetOrCreateProfileAsync\("workbench-ui"\)/,
  '6.0 must own a fresh workbench WebView profile instead of reusing the retired UI profile');
assert.doesNotMatch(host, /GetOrCreateProfileAsync\("legacy-ui"\)/);
assert.match(host, /NewWindowRequested/);
assert.match(host, /args\.Handled\s*=\s*true/);
assert.doesNotMatch(host, /Process\.Start|Launcher\.LaunchUriAsync/,
  'embedded workbench and WhatsApp must not silently launch an external client/browser');

const excludedPages = project.match(/<Page Remove="([^"]+)"/)?.[1]?.split(';') || [];
const excludedCode = project.match(/<Compile Remove="([^"]+)"/)?.[1]?.split(';') || [];
for (const page of ['HomePage', 'CustomersPage', 'ImportPage', 'OperationsPage', 'AiFollowupPage', 'WsWorkbenchPage']) {
  assert.ok(excludedPages.includes(`Views\\${page}.xaml`), `${page} XAML must be excluded from the production binary`);
  assert.ok(excludedCode.includes(`Views\\${page}.xaml.cs`), `${page} code-behind must be excluded from the production binary`);
  assert.match(bundle, new RegExp(`desktop/src/Zhike\\.Desktop/Views/${page}\\.xaml`), `${page} must be omitted from the formal source delivery`);
}

for (const retired of ['resources/app/main.cjs', 'resources/app/preload.cjs', 'resources/app/ws-preload.cjs', 'infra', 'server', 'connectors/ws-worker'])
  assert.match(bundle, new RegExp(retired.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `formal source delivery must deny ${retired}`);
assert.equal(packageJson.main, undefined, 'resource package must not expose an Electron entry point');
assert.equal(packageJson.zhikeRuntime.host, 'WinUI 3 + WebView2');
assert.equal(packageJson.zhikeRuntime.storage, 'SQLite');

console.log('single runtime contract: one WinUI/WebView2 workbench, one router and no production native/Electron fallback');
