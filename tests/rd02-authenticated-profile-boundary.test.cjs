'use strict';
// Execute the actual profile/scheduler/session/ingress services with synthetic
// platform adapters. Host integration is checked independently below; this is
// not a WinUI login or real WhatsApp acceptance test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(repo, file), 'utf8');
const native = read('desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs');
function extract(start, end) {
  const a = native.indexOf(start), b = native.indexOf(end, a);
  assert.ok(a > 0 && b > a, 'Exact production method boundaries: ' + start);
  return native.slice(a, b);
}
const factory = extract('    private async Task<WsWebViewSessionRegistration> CreatePooledWsSessionAsync(', '    private static void OnWsNewWindowRequested');
assert.equal((factory.match(/new WebView2\b/g) || []).length, 2, 'Foreground and independent collector must be different controls');
assert.match(factory, /_wsProfiles\.GetOrCreateProfileAsync\(accountId\)/);
assert.doesNotMatch(factory, /GetOrCreateCollectorProfileAsync|BuildWsCollectorScript|AddScriptToExecuteOnDocumentCreatedAsync/, 'Ordinary account open must not initialize or authenticate a collector');
const profiles = read('desktop/src/Zhike.Desktop/Services/WebViewProfileService.cs');
assert.doesNotMatch(profiles, /File\.Copy|CopyProfileDirectory|stagingPath|backupPath/, 'Independent login must never copy existing authentication');
assert.match(profiles, /PrepareCollectorProfileAsync[\s\S]*Task\.FromException\(WsCollectionCapability\.Denied\(\)\)/, 'Retired copying API stays denied');
assert.match(profiles, /\.independent-collectors-v2[\s\S]*collector-v2/, 'Reserved profile namespace prevents role/account suffix collisions');
const initialize = extract('    private async Task EnsureWsCollectorInitializedAsync(', '    private async Task StopWsCollectorAsync(');
assert.match(initialize, /#if STAGE51_ISOLATED_UI[\s\S]*throw new InvalidOperationException[\s\S]*#else/, 'Isolated UI cannot connect a collector');
assert.match(initialize, /GetOrCreateCollectorProfileAsync\(session\.AccountId\)/);
assert.match(initialize, /OnWsWebMessageReceived\(session\.AccountId, session\.Generation, view, sender, args\)/, 'Callback must capture the host-owned source control');
assert.doesNotMatch(native, /PrepareCollectorProfileAsync\(/, 'Host cannot reopen the retired copy API');
const ingress = extract('    private async Task ProcessWsWebMessageAsync(', '    private bool EnqueueDeferredWsMessage(');
assert.match(ingress, /IsAllowedWsPopupNavigation\(args\.Source\)/, 'Trusted source origin is checked before ingestion');
assert.match(ingress, /WsCollectorIngress\.TryAuthorize\(/, 'Production ingress must use the executable host-source authorization guard');
assert.match(ingress, /App\.WsSessions\.IsCurrent\(sessionAccountId, sessionGeneration, sourceView\)/, 'Retired source controls cannot publish to replacement sessions');
assert.match(ingress, /_wsCollectorEpoch/, 'Deferred packets need a navigation/pause epoch fence');
assert.match(native, /record DeferredWsMessage\([\s\S]*WebView2 SourceView/, 'Deferred queue must retain host-owned source identity');
const drain = extract('    private async Task DrainDeferredWsMessagesAsync(', '    private async Task FlushWsQueueAsync(');
assert.match(drain, /deferred\.SourceView/, 'Deferred replay must not reconstruct provenance from page payload');
const capture = extract('    private async Task<BridgeResponse> ExecuteWsCaptureAsync(', '    private static JsonElement ParseWebViewJsonResult');
assert.match(capture, /ExecuteCollectorCommandAsync/, 'Automatic capture must use the independent collector gateway');
assert.match(capture, /BuildWsVisibleCaptureScript\(accountId\)/, 'Explicit one-shot foreground import remains available');
const command = extract('    private async Task<BridgeResponse> ExecuteCollectorCommandAsync(', '    private void SyncPooledWsPresentation');
assert.match(command, /session\.CollectorState != "running"/);
assert.match(command, /ExecuteCollectorScriptAsync\(session, script, cancellationToken\)/);
assert.doesNotMatch(command, /session\.View\.CoreWebView2\.ExecuteScriptAsync/, 'Missing collector cannot fall back to foreground traversal');
const output = execFileSync(process.env.ZHIKE_TEST_DOTNET || 'dotnet', [
  'run', '--project', path.join(repo, 'desktop/tests/Rd02CollectionBoundaryRuntime/Rd02CollectionBoundaryRuntime.csproj'), '-c', 'Release',
], { cwd: repo, encoding: 'utf8', timeout: 90000, maxBuffer: 1024 * 1024, windowsHide: true });
process.stdout.write(output);
assert.match(output, /"passed":13,"failed":0/, 'All linked-service and real ingress cases must execute');
console.log(JSON.stringify({ suite: 'independent collector authentication boundary', services: 'actual linked production C#', hostIntegration: 'static source and generation/epoch guards', realWinUI: 'NotTested', realProfile: false, realWhatsApp: false }));
