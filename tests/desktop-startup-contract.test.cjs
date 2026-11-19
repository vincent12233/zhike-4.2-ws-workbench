'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '..');
const xaml = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'MainWindow.xaml'), 'utf8');

// NavigationViewItem.Icon is converted by WinUI XAML at runtime.  The XAML
// compiler does not reject unknown Symbol names, so a typo can make the
// entire desktop process terminate in Microsoft.UI.Xaml before a window is
// shown. Keep this contract deliberately explicit and close to the Windows
// SDK Symbol enum used by the project.
const supportedSymbols = new Set([
  'Home', 'Add', 'Calendar', 'ViewAll', 'Contact', 'List', 'Message', 'People',
  'Favorite', 'ContactInfo', 'Important', 'Sync', 'Delete', 'Setting', 'Phone',
  'Sort', 'Target', 'FourBars', 'ProtectedDocument', 'Library', 'Clock', 'Calculator',
]);

const icons = [...xaml.matchAll(/Icon="([^"]+)"/g)].map((match) => match[1]);
const invalid = icons.filter((icon) => !supportedSymbols.has(icon));
assert.deepEqual(invalid, [], `MainWindow.xaml contains unsupported WinUI Symbol icons: ${invalid.join(', ')}`);

console.log('desktop startup contract: all MainWindow navigation icons resolve to WinUI Symbol values');

const hostPath = path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Views', 'LegacyUiHostPage.xaml');
const hostXaml = fs.readFileSync(hostPath, 'utf8');
const hostCode = fs.readFileSync(`${hostPath}.cs`, 'utf8');
const hostMethod = (name) => hostCode.match(new RegExp(`^    (?:private|public) [^\n]+\\b${name}\\([^\n]*\\n[\\s\\S]+?^    \\}`, 'm'))?.[0] || '';

assert.match(hostXaml, /<InfoBar x:Name="HostStatus"[^>]*IsOpen="True"[^>]*Severity="Informational"[^>]*连接本机服务/);
assert.match(hostXaml, /<Button Content="重试加载" Click="RetryHost"/);
const initializeHost = hostMethod('EnsureInitializedAsync');
assert.match(initializeHost, /await App\.EnsureLocalServiceAsync[\s\S]*ShowHostLoading\("正在加载知客页面。"\)[\s\S]*_webView\.Source = /);
assert.doesNotMatch(initializeHost, /HostStatus\.IsOpen\s*=\s*false/);
assert.match(hostMethod('OnLegacyNavigationStarting'), /args\.Cancel = !IsAllowedNavigation[\s\S]*!args\.Cancel && IsWorkbenchDocument\(args\.Uri\)[\s\S]*_workbenchNavigationId = args\.NavigationId/);
const complete = hostMethod('OnLegacyNavigationCompleted');
assert.match(complete, /if \(_workbenchNavigationId != args\.NavigationId\) return;[\s\S]*if \(success\)[\s\S]*HostActions\.Visibility == Visibility\.Collapsed && HostStatus\.Severity == InfoBarSeverity\.Informational[\s\S]*HostStatus\.IsOpen = false;/);
assert.match(complete, /var success = args\.IsSuccess[\s\S]*IsWorkbenchDocument\(core\.Source\);[\s\S]*ShowHostLoadError\(/);
assert.match(hostMethod('OnLegacyProcessFailed'), /ShowHostLoadError\(/);
assert.match(hostMethod('ShowHostLoadError'), /_workbenchNavigationId = null;[\s\S]*InfoBarSeverity\.Error[\s\S]*HostActions\.Visibility = Visibility\.Visible/);
assert.match(hostMethod('TryReloadAsync'), /ShowHostLoading\([\s\S]*?\.Reload\(\);[\s\S]*?catch[\s\S]*ShowHostLoadError\(/);

const appPath = path.join(repo, 'resources', 'app');
const html = fs.readFileSync(path.join(appPath, 'index.html'), 'utf8');
const appCode = fs.readFileSync(path.join(appPath, 'app.js'), 'utf8');
const startMarkup = html.match(/<section\b[^>]*id="viewContainer"[^>]*>([\s\S]*?)<\/section>/)?.[1];
assert.match(startMarkup, /<p\b[^>]*role="status"[^>]*>正在读取本机资料…<\/p>/);
const initializeBackend = appCode.match(/^  async function initializeBackend\(\)\{[\s\S]*?^  \}/m)?.[0];
assert.ok(initializeBackend, 'use the application’s real backend initialization');
assert.match(appCode, /\$\('#viewContainer'\)\.innerHTML=horizonBanner/, 'the home renderer replaces the initial view contents');

async function checkInitialRead(response, expectedOutcome) {
  const viewContainer = { innerHTML: startMarkup };
  const calls = [];
  let finishRead;
  const read = new Promise((resolve) => { finishRead = resolve; });
  const initialize = vm.runInNewContext(`${initializeBackend}\ninitializeBackend`, {
    window: { __LOCAL_DB__: true },
    stateVersion: '',
    lastCommittedState: null,
    dbWriteFailure: null,
    beginMetricsRead: () => 1,
    completeMetricsRead: (_, outcome) => calls.push(outcome),
    fetch: (url) => { assert.equal(url, '/api/state'); return read; },
    applySharedData: () => calls.push('apply'),
    cloneStateData: (value) => value,
    statePayload: () => ({}),
    render: () => { viewContainer.innerHTML = '<main>工作台</main>'; calls.push('render'); },
    markSyncVersion: () => {},
    toast: () => calls.push('error-notice'),
  });

  const pending = initialize();
  assert.equal(viewContainer.innerHTML, startMarkup, 'leave the status visible while the real read is pending');
  assert.deepEqual(calls, []);
  finishRead(response);
  await pending;
  assert.deepEqual(calls, expectedOutcome);
  assert.equal(viewContainer.innerHTML, '<main>工作台</main>');
}

Promise.all([
  checkInitialRead({ ok: true, json: async () => ({ initialized: true }) }, ['apply', 'applied', 'render']),
  checkInitialRead({ ok: false }, ['error-notice', 'error', 'render']),
]).then(() => {
  console.log('desktop startup contract: the native status tracks local navigation and application rendering replaces the initial data status');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
