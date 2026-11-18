'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const pool = read('desktop/src/Zhike.Desktop/Services/WsWebViewSessionPool.cs');
const runtime = read('desktop/src/Zhike.Desktop/Services/WsRuntimeService.cs');
const host = read('desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs');
const profiles = read('desktop/src/Zhike.Desktop/Services/WebViewProfileService.cs');
const app = read('desktop/src/Zhike.Desktop/App.xaml.cs');

const between = (source, start, end) => {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `contract anchor is missing: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `contract anchor is missing: ${end}`);
  return source.slice(from, to);
};

// The process pool retains manually opened foreground account views. RD02
// removes automatic hidden collection, not multi-account Core continuity.
assert.match(pool, /WsWebViewSessionPool\(WsRuntimeCoordinator runtime, int capacity = 3\)/);
assert.match(pool, /if \(capacity < 2\) throw new ArgumentOutOfRangeException/);
assert.match(pool, /public int Capacity => _capacity/);
assert.match(app, /new\(WsRuntime, capacity: 3\)/,
  'the production process must retain bounded capacity for manually selected account sessions');

const acquire = between(pool, 'public async Task<WsWebViewSessionAcquireResult> GetOrCreateAsync', 'public bool TryGet');
assert.match(acquire, /runtime\.ForegroundAccountId[\s\S]*protectedIds\.Add\(runtime\.ForegroundAccountId\)/,
  'foreground account must be protected from LRU retirement');
assert.match(acquire, /runtime\.BackgroundAccountId[\s\S]*protectedIds\.Add\(runtime\.BackgroundAccountId\)/,
  'the currently leased background account must be protected from retirement');
assert.match(acquire, /SelectLruVictim\([\s\S]*protectedIds,[\s\S]*normalizedId\)/);
assert.match(acquire, /session pool is busy with protected foreground\/background accounts/,
  'capacity pressure must defer instead of destroying either protected session');
assert.doesNotMatch(acquire, /retired = _sessions\[victimId\];\s*_sessions\.Remove\(victimId\)/,
  'the LRU victim must stay addressable while the asynchronous replacement is being built');
assert.match(acquire, /var registration = await factory\(normalizedId, generation, cancellationToken\)[\s\S]*?ReferenceEquals\(current, retired\)/,
  'the replacement must be published only after the factory succeeds and the victim identity is rechecked');

const lru = between(pool, 'internal static string? SelectLruVictim', 'private static void ReleaseSession');
assert.match(lru, /!string\.Equals\(item\.AccountId, requestedAccountId/);
assert.match(lru, /!protectedAccountIds\.Contains\(item\.AccountId\)/);
assert.match(lru, /OrderBy\(item => item\.LastUsedAt\)/);
assert.match(lru, /ThenBy\(item => item\.AccountId, StringComparer\.OrdinalIgnoreCase\)/);

// Executable mirror of the declared deterministic eviction rule. These cases
// make the contract readable and catch accidental changes in protection/order.
const selectLru = (entries, protectedIds, requested) => entries
  .filter(item => item.id.toLowerCase() !== requested.toLowerCase()
    && !protectedIds.has(item.id.toLowerCase()))
  .sort((left, right) => left.used - right.used || left.id.localeCompare(right.id))
  .at(0)?.id ?? null;

assert.equal(selectLru([
  { id: 'old', used: 1 }, { id: 'new', used: 2 }, { id: 'requested', used: 0 },
], new Set(), 'requested'), 'old');
assert.equal(selectLru([
  { id: 'foreground', used: 1 }, { id: 'retire-me', used: 2 }, { id: 'newer', used: 3 },
], new Set(['foreground']), 'incoming'), 'retire-me');
assert.equal(selectLru([
  { id: 'foreground', used: 1 }, { id: 'background', used: 2 },
], new Set(['foreground', 'background']), 'incoming'), null,
  'a capacity-two pool must not evict either active lease');

// A callback from a retired WebView must never mutate the replacement account
// session. The monotonically increasing generation and optional view identity
// together fence every native callback.
assert.match(acquire, /Interlocked\.Increment\(ref _generation\)/);
const current = between(pool, 'public bool IsCurrent', 'public IReadOnlyList<WsWebViewSession> Sessions');
assert.match(current, /current\.Generation == generation/);
assert.match(current, /view is null \|\| ReferenceEquals\(current\.View, view\)/);
assert.match(host, /App\.WsSessions\.IsCurrent\(accountId, generation, view\)/,
  'navigation completion must be generation-fenced');
assert.match(host, /App\.WsSessions\.IsCurrent\(sessionAccountId, sessionGeneration\)/,
  'message ingestion must be generation-fenced');

// The runtime service, rather than a route, owns the 10-second scheduler. It
// gives foreground chat a non-driving heartbeat and flushes existing durable
// capture state; RD02 forbids automatic background leases/factory calls.
const bind = between(runtime, 'public void BindHost', 'public async Task<WsWebViewSessionAcquireResult> ShowAccountAsync');
assert.match(bind, /dispatcher\.CreateTimer\(\)/);
assert.match(bind, /_timer\.Interval = TimeSpan\.FromSeconds\(10\)/);
assert.match(bind, /_timer\.Tick \+= async \(_, _\) =>\s*\{[\s\S]*?try \{ await TickAsync\(\); \}/,
  'timer ticks must isolate transient async failures from the dispatcher pump');
assert.match(bind, /_timer\.Start\(\)/);
assert.match(host, /App\.WsService\.BindHost\(DispatcherQueue, CreatePooledWsSessionAsync, HeartbeatPooledWsSessionAsync, FlushWsQueueAsync\)/);

const tick = between(runtime, 'public async Task TickAsync', 'public async Task ShutdownAsync');
assert.match(tick, /RunHeartbeatAsync\(foreground, false/,
  'foreground WhatsApp must remain usable while still receiving a lightweight heartbeat');
assert.doesNotMatch(tick, /LeaseNextBackgroundAccount\(\)/, 'RD02 cannot lease an authenticated background collector');
assert.doesNotMatch(tick, /GetOrCreateAsync\(backgroundId, factory, cancellationToken\)/, 'background ticks cannot create account views without manual selection');
assert.doesNotMatch(tick, /RunHeartbeatAsync\([^\n]*true/, 'no periodic heartbeat may drive collection');
assert.match(tick, /_flush\(cancellationToken\)/);

const route = between(host, 'public async Task NavigateRouteAsync', 'public async Task<bool> TryReloadAsync');
assert.match(route, /!string\.Equals\(requestedRoute, "ws-workbench"[\s\S]*App\.WsService\.HideForeground\(\)[\s\S]*HideWsOverlay\(\)/,
  'leaving the WS page must hide only the visual foreground');
assert.doesNotMatch(route, /CloseWsOverlayAsync\s*\(|ForceDetachWsOverlay\s*\(|WsService\.ShutdownAsync\s*\(|WsService\.Abort\s*\(/,
  'ordinary route changes must retain manually opened process-owned account sessions');
const hideForeground = between(runtime, 'public void HideForeground', 'public async Task<bool> CloseAccountAsync');
assert.match(hideForeground, /_coordinator\.SetForegroundAccount\(null\)/);
assert.doesNotMatch(hideForeground, /Remove|Release|Close|Navigate/);
const showAccount = between(runtime, 'public async Task<WsWebViewSessionAcquireResult> ShowAccountAsync', 'public void HideForeground');
assert.match(showAccount, /_coordinator\.SetAccountEnabled\(accountId, true\)/,
  'explicitly opening an account must resume its foreground session');
const closeAccount = between(runtime, 'public async Task<bool> CloseAccountAsync', 'public async Task TickAsync');
assert.match(closeAccount, /_coordinator\.SetAccountEnabled\(accountId, false\)[\s\S]*_pool\.RemoveAsync/,
  'Close WS must disable the account before releasing its session so the scheduler cannot recreate it');
const heartbeat = between(host, 'private async Task HeartbeatPooledWsSessionAsync', 'private void SyncPooledWsPresentation');
assert.match(heartbeat, /if \(driveCollection\) return;/);
assert.doesNotMatch(heartbeat, /__zhikeWsDiscoverAll|__zhikeWsCollectAllRead|CollectorView|EnsureWsCollector/, 'foreground heartbeat cannot fall back to collection');
const presentation = between(host, 'private void SyncPooledWsPresentation', 'private void AttachLegacyHandlers');
assert.match(presentation, /var sessions = App\.WsService\.Sessions\(\)/);
assert.match(presentation, /var layoutAnchor = active \?\? sessions\.FirstOrDefault\(\)/,
  'a surviving manually opened account must retain layout/Core identity after another foreground account closes');
assert.match(presentation, /_wsView = layoutAnchor\.View[\s\S]*_wsViewAccountId = layoutAnchor\.AccountId/);

// Graceful desktop close and the bounded emergency path must both release all
// WebViews and detach native event handlers without a capture-script fallback.
const shutdown = between(runtime, 'public async Task ShutdownAsync', 'public void Abort');
assert.match(shutdown, /_timer\?\.Stop\(\)/);
assert.match(shutdown, /await _pool\.ReleaseAllAsync\(cancellationToken\)/);
const abort = between(runtime, 'public void Abort', 'public IReadOnlyList<WsWebViewSession> Sessions');
assert.match(abort, /_timer\?\.Stop\(\)/);
assert.match(abort, /_pool\.ReleaseAll\(\)/);
assert.match(host, /FlushBeforeCloseAsync[\s\S]*App\.WsService\.ShutdownAsync\(closeTimeout\.Token\)/);
assert.match(host, /ForceDetachWsOverlay\(\)[\s\S]*App\.WsService\.Abort\(\)/);

const factory = between(host, 'private async Task<WsWebViewSessionRegistration> CreatePooledWsSessionAsync', 'private static void OnWsNewWindowRequested');
assert.match(factory, /_wsProfiles\.GetOrCreateProfileAsync\(accountId\)/,
  'each account must use its isolated WebView2 profile');
assert.doesNotMatch(factory, /PrepareCollectorProfileAsync|GetOrCreateCollectorProfileAsync|BuildWsCollectorScript|AddScriptToExecuteOnDocumentCreatedAsync|WsCollectorHost/,
  'RD02 foreground factory cannot copy/bootstrap or inject a hidden/foreground collector');
assert.equal((factory.match(/new WebView2\b/g) || []).length, 1, 'each explicit account factory creates exactly one foreground WebView');
assert.match(host, /BuildWsVisibleCaptureScript\(accountId\)/, 'manual import retains its one-shot read-only capture');
assert.doesNotMatch(runtime, /CollectorView\.Source\s*=/, 'runtime cannot navigate a hidden account page');
assert.match(host, /fromBackgroundCollector = collectorRole == "background";[\s\S]{0,150}if \(fromBackgroundCollector\) return;/,
  'RD02 rejects background packets instead of deriving collection authority from a foreground login');
const collectorProfile = between(profiles, 'public Task<CoreWebView2Environment> GetOrCreateCollectorProfileAsync', 'public Task PrepareCollectorProfileAsync');
const prepareProfile = between(profiles, 'public Task PrepareCollectorProfileAsync', 'private async Task<CoreWebView2Environment> GetOrCreateEnvironmentAsync');
assert.match(collectorProfile, /Task\.FromException<CoreWebView2Environment>\(WsCollectionCapability\.Denied\(\)\)/);
assert.match(prepareProfile, /Task\.FromException\(WsCollectionCapability\.Denied\(\)\)/);
for (const deniedBody of [collectorProfile, prepareProfile]) {
  assert.doesNotMatch(deniedBody, /Directory\.|File\.|_environments|GetOrCreateEnvironmentAsync|Task\.Run|if\s*\(/,
    'compatibility collector entries deny before IO/environment/cache work, with no flag bypass');
}
assert.doesNotMatch(profiles, /CopyProfileDirectory|File\.Copy|Directory\.Move|stagingPath|backupPath/,
  'authenticated copy/replacement code is removed, rather than protected by a filename exclusion list');
const foregroundProfile = between(profiles, 'private async Task<CoreWebView2Environment> GetOrCreateEnvironmentAsync', 'public async Task<bool> ClearProfileAsync');
assert.match(foregroundProfile, /var profileId = safeId;/, 'foreground cache uses the original account identity');
assert.match(foregroundProfile, /CreateEnvironmentAsync\(id\)/, 'normal foreground environment creation remains');
assert.match(profiles, /public async Task<bool> ClearProfileAsync/, 'explicit selected-session clearing remains available');
assert.match(factory, /core\.NewWindowRequested \+= NewWindowRequested/);
assert.match(factory, /released\.CoreWebView2\.NewWindowRequested -= NewWindowRequested/,
  'release must detach popup handling from every retired session');
assert.doesNotMatch(factory, /window\.__zhikeStopCapture/, 'foreground release does not inject collector commands');
assert.match(factory, /(?:released\.Close\(\)|target\.Close\(\))/);

assert.doesNotMatch(host, /EnsureWsCollectorStartedAsync|WaitForWsCollectorReadyAsync|_wsCollectorBootstraps|WsCollectorHost\.Children\.Add/,
  'RD02 has no hidden startup, readiness retry or registration path');
const capture = between(host, 'private async Task<BridgeResponse> ExecuteWsCaptureAsync', 'private static JsonElement ParseWebViewJsonResult');
assert.ok(capture.indexOf('WsCollectionBlocked(') < capture.indexOf('TryGetSession('), 'automatic collection is denied before session/Core access');
assert.doesNotMatch(capture, /CollectorView|WaitForWsCollector|__zhikeWsDiscoverAll|__zhikeWsCollectAllRead/,
  'manual import cannot activate a hidden collector or foreground automatic fallback');

// Popup policy is deny-by-default: mark every request handled before any early
// return, and navigate only a valid HTTPS web.whatsapp.com URI in the existing
// embedded CoreWebView2. No shell/browser fallback is allowed.
const popup = between(host, 'private static void OnWsNewWindowRequested', 'private static bool IsAllowedWsPopupNavigation');
assert.ok(popup.indexOf('args.Handled = true;') < popup.indexOf('return;'),
  'NewWindowRequested must be handled before every possible return');
assert.match(popup, /sender is not CoreWebView2 core \|\| !IsAllowedWsPopupNavigation\(args\.Uri\)/);
assert.match(popup, /core\.Navigate\(args\.Uri\)/);
assert.doesNotMatch(popup, /Process\.Start|Launcher|LaunchUri|args\.NewWindow\s*=|\.NewWindow\s*=/);

const popupPolicy = between(host, 'private static bool IsAllowedWsPopupNavigation', 'private async Task HeartbeatPooledWsSessionAsync');
assert.match(popupPolicy, /Uri\.TryCreate\(uriText, UriKind\.Absolute/);
assert.match(popupPolicy, /uri\.Scheme, Uri\.UriSchemeHttps/);
assert.match(popupPolicy, /uri\.Host, "web\.whatsapp\.com"/);
assert.doesNotMatch(popupPolicy, /about:blank|UriSchemeHttp\b/,
  'popup policy must not inherit about:blank or plain HTTP navigation allowances');

console.log('WS process pool contract: manual multi-account LRU/Core/generation/shutdown/popup safety retained; RD02 copy/hidden/automatic leases forbidden');
