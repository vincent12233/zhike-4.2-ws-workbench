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
const startBadge = html.match(/<span class="([^"]+)" id="syncStatus"[^>]*>([^<]+)<\/span>/);
assert.deepEqual(startBadge?.slice(1), ['sync-status pending', '正在读取本机资料…']);
const initializeBackend = appCode.match(/^  async function initializeBackend\(\)\{[\s\S]*?^  \}/m)?.[0];
const finalizeBackend = appCode.match(/^  const legacyInitializeBackend=initializeBackend;\r?\n  initializeBackend=async function\(\)\{[\s\S]*?^  \};/m)?.[0];
const markSyncVersion = appCode.match(/^  function markSyncVersion\(version\)\{[\s\S]*?^  \}/m)?.[0];
assert.ok(initializeBackend && finalizeBackend && markSyncVersion, 'use the application’s real backend initialization and status handling');
assert.match(appCode, /\$\('#viewContainer'\)\.innerHTML=horizonBanner/, 'the home renderer replaces the initial view contents');

async function checkInitialRead(response, expectedOutcome, expectedBadge, initialWrite = false) {
  const viewContainer = { innerHTML: startMarkup };
  const badge = { className: startBadge[1], textContent: startBadge[2] };
  const calls = [];
  let finishRead;
  let beginWrite;
  let finishWrite;
  const read = new Promise((resolve) => { finishRead = resolve; });
  const writeStarted = new Promise((resolve) => { beginWrite = resolve; });
  const write = new Promise((resolve) => { finishWrite = resolve; });
  const runtime = vm.runInNewContext(`${markSyncVersion}\n${initializeBackend}\n${finalizeBackend}\n({initializeBackend,markSyncVersion})`, {
    window: { __LOCAL_DB__: Boolean(response) },
    $: (selector) => selector === '#syncStatus' ? badge : null,
    initialBackendReadPending: true,
    stateVersion: '',
    lastCommittedState: null,
    dbWriteFailure: null,
    syncReadFailure: null,
    pendingStateData: null,
    queuedWriteCount: 0,
    writeConflict: null,
    beginMetricsRead: () => 1,
    completeMetricsRead: (_, outcome) => calls.push(outcome),
    fetch: (url) => { assert.equal(url, '/api/state'); return read; },
    applySharedData: () => calls.push('apply'),
    cloneStateData: (value) => value,
    statePayload: () => ({}),
    persist: () => calls.push('initialize-write'),
    flushStateWrites: () => { beginWrite(); return write; },
    render: () => { viewContainer.innerHTML = '<main>工作台</main>'; calls.push('render'); },
    toast: () => calls.push('error-notice'),
  });

  const pending = runtime.initializeBackend();
  if (response) {
    assert.equal(viewContainer.innerHTML, startMarkup, 'leave the status visible while the real read is pending');
    runtime.markSyncVersion();
    assert.equal(badge.textContent, startBadge[2], 'unrelated sync updates cannot signal readiness during the initial read');
    assert.deepEqual(calls, []);
  }
  finishRead(response);
  if (initialWrite) {
    await Promise.race([writeStarted, pending.then(() => assert.fail('initialization skipped its first write'))]);
    runtime.markSyncVersion();
    assert.equal(viewContainer.innerHTML, startMarkup);
    assert.equal(badge.textContent, startBadge[2], 'the first write must settle before reporting readiness');
    finishWrite();
  }
  await pending;
  assert.deepEqual(calls, expectedOutcome);
  assert.equal(viewContainer.innerHTML, '<main>工作台</main>');
  assert.equal(badge.textContent, expectedBadge);
  assert.equal(badge.className, expectedBadge === '已保存到本机' ? 'sync-status online' : 'sync-status error');
}

Promise.all([
  checkInitialRead({ ok: true, json: async () => ({ initialized: true }) }, ['apply', 'applied', 'render'], '已保存到本机'),
  checkInitialRead({ ok: true, json: async () => ({ initialized: false }) }, ['initialize-write', 'applied', 'render'], '已保存到本机', true),
  checkInitialRead({ ok: false }, ['error-notice', 'error', 'render'], '同步异常'),
  checkInitialRead(null, ['error', 'render'], '未连接本机服务'),
]).then(() => {
  console.log('desktop startup contract: the native status tracks local navigation and application rendering replaces the initial data status');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
