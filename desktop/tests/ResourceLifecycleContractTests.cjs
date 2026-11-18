'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const repo = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');

const apiClient = read('desktop/src/Zhike.Desktop/Services/ApiClient.cs');
const host = read('desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs');
const server = read('resources/app/server.mjs');

assert.match(apiClient, /class\s+ApiClient[^\n{]*:\s*IDisposable/,
  'ApiClient must expose deterministic disposal for its owned HttpClient');
assert.match(apiClient, /void\s+Dispose\s*\(\)/,
  'ApiClient must implement a disposal method');
assert.match(host, /ReplaceApiClient\(App\.LocalService\?\.CreateApiClient\(\)\)/,
  'sidecar recovery must replace ApiClient through the disposing helper');
assert.match(host, /previous\?\.Dispose\(\)/,
  'replacing the sidecar client must dispose the previous client');
assert.match(host, /private\s+(?:readonly\s+)?EventHandler\??\s+_wsSessionsChangedHandler/,
  'WS SessionsChanged callback must be stored so it can be unsubscribed');
assert.match(host, /SessionsChanged\s*-=\s*_wsSessionsChangedHandler/,
  'WS SessionsChanged callback must be removed when the page unloads');
assert.match(host, /_initializeGate\.WaitAsync|_initializ(?:e|ation)Gate\.WaitAsync/,
  'WebView initialization must be serialized across Loaded and Navigated callers');
assert.match(host, /await\s+ReleaseForgottenWsAccountAsync\(forgottenId,\s*cancellationToken\)/,
  'forgetting an account must close its pooled WebView before removing the runtime record');
assert.doesNotMatch(host, /\b_wsCollectorSyncGates\b|\b_wsGroupMonitorConfigs\b/,
  'RD02 removes the unsafe collector-owned dictionaries entirely; forgotten accounts cannot retain entries in them');
const releaseStart = host.indexOf('    private async Task ReleaseForgottenWsAccountAsync(');
const releaseEnd = host.indexOf('    private async Task<BridgeResponse> HandleWsActionAsync(', releaseStart);
assert.ok(releaseStart >= 0 && releaseEnd > releaseStart, 'the actual account release boundary must remain present');
const release = host.slice(releaseStart, releaseEnd);
assert.match(release, /await App\.WsService\.CloseAccountAsync\(normalized,\s*cancellationToken\)/,
  'forgetting an account must still close its currently owned pooled session');
assert.match(release, /_wsStatusSequence\.TryRemove\(normalized,\s*out\s+_\)/,
  'forgetting an account must remove remaining per-account status state');
assert.match(release, /_wsView = null;[\s\S]*?_wsViewAccountId = string\.Empty;[\s\S]*?Interlocked\.Increment\(ref _wsGeneration\);[\s\S]*?HideWsOverlay\(\)/,
  'forgetting the visible account must clear its reference, invalidate late callbacks and hide the old overlay');
assert.match(release, /_activeWsAccountId = "default";[\s\S]*?SyncPooledWsPresentation\(\)/,
  'forget must restore a valid active account and synchronize pooled presentation');
assert.match(server, /const\s+assetStream\s*=\s*createReadStream\(filePath\)[\s\S]{0,240}assetStream\.on\(['"]error['"]/,
  'static file streams must handle asynchronous read errors');

console.log('resource lifecycle contract: ApiClient disposal, WS callback ownership, serialized initialization and stream error handling are required');
