'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const pool = read('desktop/src/Zhike.Desktop/Services/WsWebViewSessionPool.cs');
const runtime = read('desktop/src/Zhike.Desktop/Services/WsRuntimeService.cs');
const host = read('desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs');
const app = read('desktop/src/Zhike.Desktop/App.xaml.cs');

const between = (source, start, end) => {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `contract anchor is missing: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `contract anchor is missing: ${end}`);
  return source.slice(from, to);
};

// The process pool must have room for the visible chat plus at least one
// background collector. A page-owned, single-WebView implementation cannot
// satisfy multi-account continuity.
assert.match(pool, /WsWebViewSessionPool\(WsRuntimeCoordinator runtime, int capacity = 3\)/);
assert.match(pool, /if \(capacity < 2\) throw new ArgumentOutOfRangeException/);
assert.match(pool, /public int Capacity => _capacity/);
assert.match(app, /new\(WsRuntime, capacity: 3\)/,
  'the production process must provision at least a foreground and background session');

const acquire = between(pool, 'public async Task<WsWebViewSessionAcquireResult> GetOrCreateAsync', 'public bool TryGet');
assert.match(acquire, /runtime\.ForegroundAccountId[\s\S]*protectedIds\.Add\(runtime\.ForegroundAccountId\)/,
  'foreground account must be protected from LRU retirement');
assert.match(acquire, /runtime\.BackgroundAccountId[\s\S]*protectedIds\.Add\(runtime\.BackgroundAccountId\)/,
  'the currently leased background account must be protected from retirement');
assert.match(acquire, /SelectLruVictim\([\s\S]*protectedIds,[\s\S]*normalizedId\)/);
assert.match(acquire, /session pool is busy with protected foreground\/background accounts/,
  'capacity pressure must defer instead of destroying either protected session');

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
// gives foreground chat a non-driving heartbeat and rotates a driving lease
// through background accounts, then flushes durable capture state.
const bind = between(runtime, 'public void BindHost', 'public async Task<WsWebViewSessionAcquireResult> ShowAccountAsync');
assert.match(bind, /dispatcher\.CreateTimer\(\)/);
assert.match(bind, /_timer\.Interval = TimeSpan\.FromSeconds\(10\)/);
assert.match(bind, /_timer\.Tick \+= async \(_, _\) => await TickAsync\(\)/);
assert.match(bind, /_timer\.Start\(\)/);
assert.match(host, /App\.WsService\.BindHost\(DispatcherQueue, CreatePooledWsSessionAsync, HeartbeatPooledWsSessionAsync, FlushWsQueueAsync\)/);

const tick = between(runtime, 'public async Task TickAsync', 'public async Task ShutdownAsync');
assert.match(tick, /RunHeartbeatAsync\(foreground, false/,
  'foreground WhatsApp must remain usable while still receiving a lightweight heartbeat');
assert.match(tick, /LeaseNextBackgroundAccount\(\)/);
assert.match(tick, /GetOrCreateAsync\(backgroundId, factory, cancellationToken\)/);
assert.match(tick, /RunHeartbeatAsync\(acquired\.Session, true/,
  'the background lease must actively drive list/history collection');
assert.match(tick, /_flush\(cancellationToken\)/);

const route = between(host, 'public async Task NavigateRouteAsync', 'public async Task<bool> TryReloadAsync');
assert.match(route, /!string\.Equals\(requestedRoute, "ws-workbench"[\s\S]*App\.WsService\.HideForeground\(\)[\s\S]*HideWsOverlay\(\)/,
  'leaving the WS page must hide only the visual foreground');
assert.doesNotMatch(route, /CloseWsOverlayAsync\s*\(|ForceDetachWsOverlay\s*\(|WsService\.ShutdownAsync\s*\(|WsService\.Abort\s*\(/,
  'ordinary route changes must leave process-owned sessions and background collection alive');
const hideForeground = between(runtime, 'public void HideForeground', 'public async Task<bool> CloseAccountAsync');
assert.match(hideForeground, /_coordinator\.SetForegroundAccount\(null\)/);
assert.doesNotMatch(hideForeground, /Remove|Release|Close|Navigate/);
const showAccount = between(runtime, 'public async Task<WsWebViewSessionAcquireResult> ShowAccountAsync', 'public void HideForeground');
assert.match(showAccount, /_coordinator\.SetAccountEnabled\(accountId, true\)/,
  'explicitly opening an account must resume a previously closed collector');
const closeAccount = between(runtime, 'public async Task<bool> CloseAccountAsync', 'public async Task TickAsync');
assert.match(closeAccount, /_coordinator\.SetAccountEnabled\(accountId, false\)[\s\S]*_pool\.RemoveAsync/,
  'Close WS must disable the account before releasing its session so the scheduler cannot recreate it');
assert.match(host, /driveCollection[\s\S]*__zhikeWsDiscoverAll[\s\S]*__zhikeWsCollectAllRead/,
  'a background lease must drive both conversation discovery and full read-history collection');
const presentation = between(host, 'private void SyncPooledWsPresentation', 'private void AttachLegacyHandlers');
assert.match(presentation, /var sessions = App\.WsService\.Sessions\(\)/);
assert.match(presentation, /var layoutAnchor = active \?\? sessions\.FirstOrDefault\(\)/,
  'a surviving background account must retain rendered DOM geometry after the foreground account closes');
assert.match(presentation, /_wsView = layoutAnchor\.View[\s\S]*_wsViewAccountId = layoutAnchor\.AccountId/);

// Graceful desktop close and the bounded emergency path must both release all
// WebViews, stop their capture scripts and detach native event handlers.
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
assert.match(factory, /core\.NewWindowRequested \+= NewWindowRequested/);
assert.match(factory, /released\.CoreWebView2\.NewWindowRequested -= NewWindowRequested/,
  'release must detach popup handling from every retired session');
assert.match(factory, /window\.__zhikeStopCapture\?\.\(\)/);
assert.match(factory, /released\.Close\(\)/);

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

console.log('WS process session pool contract: finite multi-account LRU, leases, generation fencing, background lifecycle, shutdown and popup isolation pass');
