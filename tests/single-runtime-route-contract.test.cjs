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
const appXaml = read('desktop/src/Zhike.Desktop/App.xaml');
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

// Native startup/error surfaces inherit WinUI's theme without adding another
// router or a new bridge that changes the embedded workbench's preferences.
const nativePalettes = Object.fromEntries(['Light','Dark','HighContrast'].map(theme => {
  const block = appXaml.match(new RegExp(`<ResourceDictionary x:Key="${theme}">([\\s\\S]*?)<\\/ResourceDictionary>`));
  assert.ok(block, `Native resources include the ${theme} dictionary`);
  return [theme, Object.fromEntries([...block[1].matchAll(/<SolidColorBrush x:Key="(Zhike[^"]+)" Color="([^"]+)"\s*\/>/g)].map(match => [match[1], match[2]]))];
}));
assert.equal(Object.keys(nativePalettes.Light).length,18,'All eighteen existing native tokens remain available');
for (const theme of ['Dark','HighContrast']) assert.deepEqual(Object.keys(nativePalettes[theme]).sort(),Object.keys(nativePalettes.Light).sort(),'Every theme has the same native resource contract');
for (const value of Object.values(nativePalettes.HighContrast)) assert.match(value,/^\{ThemeResource SystemColorWindow(?:Text)?Color\}$/,'High contrast respects Windows system colors');
for (const markup of [appXaml,mainXaml,hostXaml]) {
  assert.doesNotMatch(markup,/\{StaticResource Zhike/,'Native palette consumers cannot retain a light-only static brush reference');
  for (const match of markup.matchAll(/\{ThemeResource (Zhike[^}]+)\}/g)) assert.ok(nativePalettes.Light[match[1]],`Theme consumer ${match[1]} has a declared brush`);
}
function nativeContrast(first, second) {
  const luminance = hex => [1,3,5].map(start=>parseInt(hex.slice(start,start+2),16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
  const light=luminance(first),dark=luminance(second);
  return (Math.max(light,dark)+.05)/(Math.min(light,dark)+.05);
}
for (const theme of ['Light','Dark']) {
  const colors=nativePalettes[theme];
  for (const ink of ['Text','MutedText','Navy','NavySecondary','Blue','Teal']) {
    for (const surface of ['PageBackground','Surface','SurfaceMuted']) assert.ok(nativeContrast(colors[`Zhike${ink}Brush`],colors[`Zhike${surface}Brush`])>=4.5,`${theme} native ${ink}/${surface} meets normal-text contrast`);
  }
  for (const state of ['Success','Warning','Danger','Ai']) assert.ok(nativeContrast(colors[`Zhike${state}Brush`],colors[`Zhike${state}BackgroundBrush`])>=4.5,`${theme} native ${state} status stays readable`);
}

assert.doesNotMatch(host, /FallbackRequested|OpenNativeFallback|TryFallbackAsync/);
assert.doesNotMatch(hostXaml, /打开兼容页面|OpenNativeFallback/);
assert.match(host, /GetOrCreateProfileAsync\("workbench-ui"\)/,
  '6.0 must own a fresh workbench WebView profile instead of reusing the retired UI profile');
assert.doesNotMatch(host, /GetOrCreateProfileAsync\("legacy-ui"\)/);
assert.match(host, /NewWindowRequested/);
assert.match(host, /args\.Handled\s*=\s*true/);
assert.doesNotMatch(host, /Process\.Start|Launcher\.LaunchUriAsync/,
  'embedded workbench and WhatsApp must not silently launch an external client/browser');

for (const page of ['HomePage', 'CustomersPage', 'ImportPage', 'OperationsPage', 'AiFollowupPage', 'WsWorkbenchPage']) {
  assert.equal(fs.existsSync(path.join(repo, 'desktop/src/Zhike.Desktop/Views', `${page}.xaml`)), false, `${page} XAML must be retired from the single-runtime source`);
  assert.equal(fs.existsSync(path.join(repo, 'desktop/src/Zhike.Desktop/Views', `${page}.xaml.cs`)), false, `${page} code-behind must be retired from the single-runtime source`);
  assert.doesNotMatch(bundle, new RegExp(`desktop/src/Zhike\\.Desktop/Views/${page}\\.xaml`), `${page} must not be listed in the formal source delivery`);
}

for (const retired of ['resources/app/main.cjs', 'resources/app/preload.cjs', 'resources/app/ws-preload.cjs', 'infra', 'server', 'connectors/ws-worker'])
  assert.match(bundle, new RegExp(retired.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `formal source delivery must deny ${retired}`);
assert.equal(packageJson.main, undefined, 'resource package must not expose an Electron entry point');
assert.equal(packageJson.zhikeRuntime.host, 'WinUI 3 + WebView2');
assert.equal(packageJson.zhikeRuntime.storage, 'SQLite');

console.log('single runtime contract: one WinUI/WebView2 workbench, one router and no production native/Electron fallback');
