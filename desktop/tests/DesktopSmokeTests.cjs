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
for (const service of ['ApiClient.cs', 'LocalQueue.cs', 'WindowLayoutService.cs', 'WebViewProfileService.cs', 'NotificationService.cs', 'WsAccountStore.cs'])
  assert.equal(fs.existsSync(path.join(desktopRoot, 'Services', service)), true, `missing desktop service ${service}`);

const windowXaml = fs.readFileSync(path.join(desktopRoot, 'MainWindow.xaml'), 'utf8');
for (const tag of ['customers', 'import', 'operations', 'ws', 'ai']) assert.match(windowXaml, new RegExp(`Tag="${tag}"`));
const wsXaml = fs.readFileSync(path.join(desktopRoot, 'Views', 'WsWorkbenchPage.xaml'), 'utf8');
assert.doesNotMatch(wsXaml, /Microsoft\.Web\.WebView2\.WinUI/);
assert.match(wsXaml, /ToggleLeftPane/);
assert.match(wsXaml, /ToggleRightPane/);
const wsCode = fs.readFileSync(path.join(desktopRoot, 'Views', 'WsWorkbenchPage.xaml.cs'), 'utf8');
assert.match(wsCode, /using Microsoft\.UI\.Xaml\.Controls;/);
assert.doesNotMatch(wsCode, /Microsoft\.Web\.WebView2\.WinUI/);
assert.match(wsCode, /new WebView2/);
assert.match(wsCode, /GridLength\(_leftCollapsed \? 0 : 220\)/);
assert.match(wsCode, /GridLength\(_rightCollapsed \? 0 : 300\)/);
assert.match(wsCode, /_suppressAccountSelection/);
const homeXaml = fs.readFileSync(path.join(desktopRoot, 'Views', 'HomePage.xaml'), 'utf8');
assert.match(homeXaml, /PairServer/);
const homeCode = fs.readFileSync(path.join(desktopRoot, 'Views', 'HomePage.xaml.cs'), 'utf8');
assert.match(homeCode, /ComputePairingProof/);
const layout = fs.readFileSync(path.join(desktopRoot, 'Services', 'WindowLayoutService.cs'), 'utf8');
assert.match(layout, /Math\.Max\(820/);
assert.match(layout, /Math\.Max\(540/);
assert.match(layout, /DpiScale/);
assert.match(layout, /SaveAsync/);
assert.match(layout, /LoadAsync/);
const profile = fs.readFileSync(path.join(desktopRoot, 'Services', 'WebViewProfileService.cs'), 'utf8');
assert.match(profile, /ws-profiles/);
assert.match(profile, /CreateWithOptionsAsync/);
assert.match(profile, /SHA256/);
const accountStore = fs.readFileSync(path.join(desktopRoot, 'Services', 'WsAccountStore.cs'), 'utf8');
assert.match(accountStore, /accounts\.json/);
assert.match(accountStore, /File\.Move\(temporary, _path, true\)/);
const queue = fs.readFileSync(path.join(desktopRoot, 'Services', 'LocalQueue.cs'), 'utf8');
assert.match(queue, /File\.Move\(temp, _path, true\)/);
assert.match(queue, /corrupt-/);
assert.doesNotMatch(queue, /password|cookie|qr/i);

const api = fs.readFileSync(path.join(desktopRoot, 'Services', 'ApiClient.cs'), 'utf8');
assert.match(api, /TryCreateFromEnvironment/);
assert.match(api, /api\/v2\/customers\{suffix\}/);
assert.match(api, /search=/);
assert.match(api, /api\/v2\/business-records\{suffix\}/);
assert.match(api, /CommitImportAsync/);
assert.match(api, /api\/v2\/import\/batches\/commit/);

const project = fs.readFileSync(path.join(desktopRoot, 'Zhike.Desktop.csproj'), 'utf8');
assert.match(project, /Microsoft\.Web\.WebView2" Version="1\.0\.3719\.77"/);

const pageContracts = {
  CustomersPage: ['SearchBox', 'RefreshCustomers', 'CustomersEmptyState', 'CustomersStatus', 'GetCustomersAsync'],
  ImportPage: ['CsvInput', 'PreviewImport', 'CommitImport', 'ImportEmptyState', 'PreviewImportAsync', 'LocalQueue'],
  OperationsPage: ['OperationsPivot', 'RefreshOperations', 'OperationsEmptyState', 'GetBusinessRecordsAsync'],
  AiFollowupPage: ['StateFilter', 'RefreshFollowups', 'FollowupEmptyState', 'GetFollowupsAsync'],
};
for (const [page, tokens] of Object.entries(pageContracts)) {
  const xaml = fs.readFileSync(path.join(desktopRoot, 'Views', `${page}.xaml`), 'utf8');
  const code = fs.readFileSync(path.join(desktopRoot, 'Views', `${page}.xaml.cs`), 'utf8');
  for (const token of tokens) assert.match(`${xaml}\n${code}`, new RegExp(token), `${page} missing ${token}`);
}

console.log('desktop smoke contract: native page responsibilities, WS WebView2 boundary, collapse layout, API-backed states and offline queue pass');
