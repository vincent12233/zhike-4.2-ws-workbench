'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const main = read('desktop/src/Zhike.Desktop/MainWindow.xaml.cs');
const host = read('desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs');
const hostXaml = read('desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml');
const api = read('desktop/src/Zhike.Desktop/Services/ApiClient.cs');
const workbench = read('resources/app/modules/ws-workbench.js');
const runtime = read('desktop/src/Zhike.Desktop/Services/WsRuntimeService.cs');
const capability = read('desktop/src/Zhike.Desktop/Services/WsCollectionCapability.cs');

const between = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const route = between(host, 'public async Task NavigateRouteAsync', 'public async Task<bool> TryReloadAsync');

assert.match(route, /!string\.Equals\(requestedRoute, "ws-workbench"[\s\S]*HideWsOverlay\(\)/, 'leaving WS must hide its surface');
assert.doesNotMatch(route, /CloseWsOverlayAsync\s*\(|ForceDetachWsOverlay\s*\(|Navigate\("about:blank"\)/, 'ordinary route changes must not destroy or blank the WS account instance');
assert.match(host, /case "hide":[\s\S]*HideWsOverlay\(\)/, 'the renderer hide action must be visual-only');
assert.match(host, /case "close":[\s\S]*CloseWsOverlayAsync/, 'explicit Close WS remains a hard stop');
assert.match(host, /case "clear-session":[\s\S]*CloseWsOverlayAsync\(true/, 'explicit session clearing still closes and deletes only the selected profile');
assert.match(host, /FlushBeforeCloseAsync[\s\S]*App\.WsService\.ShutdownAsync/, 'desktop shutdown remains a hard stop for every pooled account');

assert.match(main, /_appWindow\.Changed \+= OnAppWindowChanged/, 'window state changes must notify the WS host');
assert.match(main, /OverlappedPresenterState\.Minimized/, 'minimize must be distinguished from a renderable restored window');
assert.match(main, /NotifyHostWindowState\(renderable, refreshBounds: renderable\)/, 'restore, move, resize and presenter changes must refresh overlay bounds');
assert.match(host, /NotifyHostWindowState[\s\S]*HideWsOverlay\(\)[\s\S]*ResizeWsOverlayFromDomAsync/, 'minimize hides drawing while restore refreshes the retained WebView');
assert.match(hostXaml, /x:Name="WsOverlayLayer"[^>]*Visibility="Collapsed"[^>]*IsHitTestVisible="False"/, 'the background WS surface must not intercept clicks while hidden');
assert.match(host, /private void HideWsOverlay\(\)[\s\S]*_wsView\?\.CoreWebView2 is null[\s\S]*Canvas\.SetZIndex\(WsOverlayLayer, -1\)[\s\S]*Visibility\.Visible/, 'an active hidden WS view must retain nonzero layout behind the parent instead of being collapsed');
assert.match(host, /Canvas\.SetZIndex\(WsOverlayLayer, 20\)[\s\S]*IsHitTestVisible = true/, 'returning to WS restores foreground z-order and input only after trusted bounds');

const heartbeat = between(host, 'private async Task HeartbeatPooledWsSessionAsync', 'private JsonElement CollectionCapabilityFor');
assert.match(heartbeat, /if \(driveCollection\)[\s\S]*var collector = session\.CollectorView/, 'collection heartbeat uses the independent control');
assert.match(heartbeat, /ProbeWsLoginStateAsync\(session\.AccountId, collector, session\.Generation, cancellationToken, publishStatus: false\)/, 'collector authentication must not set foreground connection status');
assert.match(heartbeat, /session\.CollectorState == "login-visible"[\s\S]*?!session\.ShouldResumeAfterLogin\(status\.status == "已连接", showingLogin\)[\s\S]*?_wsCollectorVisibleAccountId = string\.Empty;[\s\S]*?SyncPooledWsPresentation\(\);[\s\S]*?await StartWsCollectorAsync/, 'the collector leaves the login surface before background collection begins');
assert.match(host, /action == "resume-collector" && collector\.CoreWebView2 is null[\s\S]*?PublishCollectorState\(session, "awaiting-login"\);[\s\S]*?EnsureWsCollectorInitializedAsync[\s\S]*?return BridgeResponse\.Success/, 'resume opens the independent persisted profile and waits for its real login observation');
const foregroundHeartbeat = heartbeat.slice(heartbeat.indexOf('        var view = session.View;'));
assert.match(foregroundHeartbeat, /App\.WsSessions\.IsCurrent\(session\.AccountId, session\.Generation, view\)/, 'foreground probes remain fenced by account, generation and view');
assert.match(foregroundHeartbeat, /ProbeWsLoginStateAsync\(session\.AccountId, view, session\.Generation, cancellationToken\)/);
assert.doesNotMatch(foregroundHeartbeat, /CollectorView|__zhikeWsBackgroundTick|__zhikeWsDiscoverAll|__zhikeWsCollectAllRead/, 'foreground probes never fall back to collection');
assert.doesNotMatch(workbench, /autoCaptureTimer|setInterval\(\(\) => \{ if \(state\.active && !document\.hidden\) void autoCaptureCurrentConversation\(\)/,
  'automatic message capture must stay in the hidden collector; the visible WS surface must not poll or read its chat DOM');
assert.match(heartbeat, /_lastForegroundWsHeartbeatAtByAccount[\s\S]*now - lastHeartbeat < TimeSpan\.FromSeconds\(15\)/, 'visible WS heartbeat probes retain their actual per-account throttle while the operator chats');
assert.doesNotMatch(host, /var foregroundScript = "\(\(\) => window\.__zhikeWsBackgroundTick/, 'foreground heartbeat must not execute the collector DOM tick');
assert.doesNotMatch(runtime, /LeaseNextBackgroundAccount|GetOrCreateAsync\(backgroundId|RunHeartbeatAsync\(acquired\.Session, true/, 'RD02 scheduler must not keep attempting background account creation');
const loginProbe = between(host, 'private async Task<(string status, string detail)> ProbeWsLoginStateAsync(', 'private sealed record WsLoginProbeWork(');
assert.match(loginProbe, /bool OwnsProbe\(\) => App\.WsSessions\.IsCurrent\(accountId, generation, view\) && _wsAccountMetrics\.IsCurrent\(lease\)/,
  'status ownership binds the actual account, generation, view and navigation/probe lease');
assert.match(loginProbe, /bool CurrentDocument\(\) => OwnsProbe\(\)[\s\S]*?IsAllowedWsPopupNavigation\(core\.Source\)/,
  'published status also validates the current trusted document on the dispatcher');
assert.match(loginProbe, /await SaveWsLoginObservationAsync\([\s\S]*?var isCurrent = CurrentDocument\(\);[\s\S]*?if \(publishStatus && isCurrent\)[\s\S]*?await SetWsStatusAsync\(accountId, status, cancellationToken, OwnsProbe\);[\s\S]*?if \(CurrentDocument\(\)\) PublishWsStatus/,
  'saving metrics and status cannot bypass the ownership rechecks after each await');
const statusWrite = between(host, 'private async Task SetWsStatusAsync(', 'private async Task<BridgeResponse> ExecuteWsCaptureAsync(');
assert.match(statusWrite, /await _wsStatusGate\.WaitAsync[\s\S]*?ownsObservation\?\.Invoke\(\) == false[\s\S]*?await _wsAccountStore\.LoadAsync[\s\S]*?ownsObservation\?\.Invoke\(\) == false/,
  'a superseded probe waiting for either status lock or account I/O cannot persist an obsolete status');
assert.match(statusWrite, /UpdateAsync\(current => ownsObservation\?\.Invoke\(\) == false[\s\S]*?savedSequence != sequence \? current : current\.Select/,
  'account index mutation rechecks both the probe lease and status sequence');
assert.match(capability, /State => "available"[\s\S]*BackgroundCollection => true[\s\S]*AutomaticAi => false[\s\S]*ForegroundFallback => false/, 'independent collection support never enables foreground fallback or automatic AI');
assert.match(host, /fields\["collectionCapability"\] = CollectionCapabilityFor\(accountId\)/, 'status events carry account-scoped collector state separately from foreground login');
assert.doesNotMatch(host, /Publish\("ws\.background-tick"/, 'internal ticks do not cause unsolicited shell redraws');
// The parsing/scheduling algorithms retain their bounded pagination, unread
// handling and durable checkpoint rules when used by the independent collector.
const legacyScript = host.match(/internal static string BuildWsCollectorScript\(string accountId\)\s*\{[\s\S]*?return \$\$"""([\s\S]*?)""";/)?.[1] || '';
assert.match(legacyScript, /window\.__zhikeWsBackgroundTick\s*=\s*\(\)\s*=>[\s\S]*scheduleIncrementalReadHistory\(80\)/, 'retained legacy incremental scheduling semantics must not silently change');
assert.match(legacyScript, /drainDueCollectorTasks\(\)/, 'retained legacy scheduler must preserve its bounded drain semantics');
assert.match(legacyScript, /scheduleCollectorPaint\(processNext\)/, 'retained legacy pagination must retain its scheduling boundary');
assert.match(host, /PublishWsStatus\([\s\S]*background = fromBackgroundCollector/, 'durable/manual packet status retains its origin metadata through the capability decorator');
assert.match(host, /Publish\("ws\.message"[\s\S]*background = fromBackgroundCollector/, 'isolated collector ingest events are marked so the foreground shell can avoid shared refreshes');
assert.match(host, /ingestScope = fromBackgroundCollector \? "background-collector" : "visible-authorized-content"/, 'queued ingest packets preserve foreground/background origin for sync isolation');
assert.match(host, /Publish\("sync\.updated"[\s\S]*request\.Scope, "background-collector"/, 'background queue flushes do not request a shared CRM redraw');
assert.match(host, /COLLECTOR_NOT_READY[\s\S]*独立采集/, 'unready collector commands fail explicitly rather than report empty success');
assert.match(legacyScript, /scheduleIncrementalReadHistory\(3500, true\)[\s\S]*highPriorityHistoryRetryPending/, 'retained explicit retry ordering stays covered without enabling runtime collection');
assert.match(legacyScript, /LIST_SCAN_STALL_MS\s*=\s*30 \* 1000[\s\S]*page-list-interrupted/, 'retained non-progress handling still preserves partial checkpoints');


const statusResponse = between(host, 'private async Task<BridgeResponse> WsStatusResponseAsync(', 'private async Task<(string status, string detail)> ProbeWsLoginStateAsync(');
const isolatedStatus = between(statusResponse, '#if STAGE51_ISOLATED_UI', '#else');
assert.ok(isolatedStatus, 'isolated status responses must not use the WhatsApp login probe');
assert.match(isolatedStatus, /App\.WsSessions\.IsCurrent\(accountId, session\.Generation, session\.View\)/, 'only the current account and generation can confirm an isolated preview');
assert.match(isolatedStatus, /status\s*=\s*"未连接"[\s\S]*隔离验收[\s\S]*未连接 WhatsApp[\s\S]*isolatedPreview/, 'a ready preview still reports no authenticated connection');
assert.doesNotMatch(isolatedStatus, /"已连接"|ProbeWsLoginStateAsync|SetWsStatusAsync|PublishWsStatus/, 'a blank preview cannot probe, persist or publish a WhatsApp connection');
assert.match(statusResponse, /#else[\s\S]*ProbeWsLoginStateAsync\(accountId, session\?\.View, session\?\.Generation \?\? 0, cancellationToken\)/, 'normal builds still use the existing login probe');


for (const [action, next] of [['resize', 'hide'], ['hide', 'close']]) {
  const ack = between(host, 'case "' + action + '":', 'case "' + next + '":');
  assert.doesNotMatch(ack, /\bstatus\s*=|WsStatusResponseAsync|ProbeWsLoginStateAsync/, action + ' is a layout acknowledgement and cannot establish a login state');
}

const openOverlay = between(host, 'private async Task OpenWsOverlayAsync(', 'private async Task<bool> CloseWsOverlayAsync(');
assert.match(openOverlay, /if \(visibleNavigation\.FailureDetail is not null\)[\s\S]*?explicitBoundary: true\);\s*core\.Navigate\(WsRuntimeService\.ForegroundStartUrl\)/, 'reopening a failed foreground page must navigate to the login URL with a fresh recovery budget');
assert.match(loginProbe, /navigation\.FailureDetail is \{ \} failureDetail\)[\s\S]*?new WsLoginProbeWork\(null, null, failureDetail, "连接失败"\)/, 'heartbeat and explicit probes retain terminal navigation errors');
assert.match(openOverlay, /#if !STAGE51_ISOLATED_UI[\s\S]*if \(acquired\.Created\) await SetWsStatusAsync\(accountId, "连接中", cancellationToken\);[\s\S]*#endif/, 'opening an isolated preview must not persist a connection attempt');
const bridgeEvent = between(host, 'private void OnBridgeEventPublished(', 'private async Task<BridgeResponse?> HandleNativeBridgeAsync(');
const dispatcher = bridgeEvent.indexOf('DispatcherQueue.TryEnqueue');
assert.ok(dispatcher >= 0);
assert.doesNotMatch(bridgeEvent.slice(0, dispatcher), /_webView|CoreWebView2/, 'bridge events may be published from a worker thread');
assert.match(bridgeEvent.slice(dispatcher), /_webView\?\.CoreWebView2\?\.PostWebMessageAsJson/, 'access the shell WebView only in the dispatcher callback');
const probe = between(host, 'private async Task<(string status, string detail)> ProbeWsLoginStateAsync(', 'private async Task SetWsStatusAsync(');
assert.match(probe, /catch \(OperationCanceledException\) when \(cancellationToken\.IsCancellationRequested\)\s*\{\s*throw;\s*\}/, 'cancelled probes keep their bridge timeout semantics');


const boundsObserver = host.match(/BuildWsBoundsObserverScript\(\) => """([\s\S]*?)""";/)?.[1] || '';
assert.match(boundsObserver, /ResizeObserver\(schedule\)[\s\S]*resizeObserver\.observe\(observed\)/, 'the actual WS host size must refresh native overlay bounds');
assert.match(boundsObserver, /document\.querySelector\('#viewContainer'\)[\s\S]*mutationObserver\.observe\(mutationRoot, \{ childList:true \}\)/, 'route replacement is observed only at the owned view root');
assert.match(boundsObserver, /signature === lastSignature[\s\S]*return/, 'unchanged bounds must not cross the WebView2 bridge every frame');
assert.doesNotMatch(boundsObserver, /window\.addEventListener\('scroll'[\s\S]*capture:true/, 'nested business/WS scrolling must not publish redundant native bounds');
assert.doesNotMatch(boundsObserver, /mutationObserver\.observe\(document\.documentElement[\s\S]*subtree:true/, 'bounds observation must not scan the whole application subtree');
assert.match(host, /viewportWidth[\s\S]*viewportHeight/, 'DOM bounds include viewport dimensions for CSS-pixel to XAML-DIP scaling');
assert.match(host, /routeGeneration[\s\S]*wsGeneration[\s\S]*Volatile\.Read/, 'stale async bounds results must be rejected across route/account changes');
assert.match(host, /RasterizationScale[\s\S]*SnapToRaster/, 'overlay edges must remain aligned after DPI changes');
assert.doesNotMatch(boundsObserver, /innerText|textContent|cookie|localStorage/, 'bounds telemetry must never read chat text, cookies or storage');

assert.doesNotMatch(api, /VipGroup/, 'there is no VIP group: DTOs carry no VIP flag');
assert.match(api, /string\s+ConversationType\s*=\s*""[\s\S]*bool\?\s+IsGroup\s*=\s*null/, 'checkpoint DTO preserves direct/group/VIP metadata compatibly');
assert.doesNotMatch(host, /VipGroup|vip_group|vipGroup/, 'the native host has no VIP-group path');
assert.match(host, /allowedConversationKeys[\s\S]*item\.ConversationType, "direct"[\s\S]*messages\.RemoveAll/, 'native ingress accepts direct and explicit VIP-group bodies while discarding ordinary groups');
assert.doesNotMatch(main, /WsWorkbenchPage/, 'the retired native fallback must not be production-routable');

console.log('WS lifecycle contract: retained foreground Core/route/DPI/queue boundaries; explicit independent collection without foreground fallback');


const connectionActionSource = between(workbench, '  async function connectionAction(action)', '  async function loadConversations()');
const activateSource = between(workbench, '  function activate()', '  function deactivate()');
const workspaceModeHelpers = between(workbench, '  function normalizeWorkspaceMode(', '  const WS_MODE_VIEW_IDS')
  + between(workbench, '  function modeAccount(', '  const WS_WORKSPACE_VIEW_META');
const isolatedResult = { status: '未连接', isolatedPreview: true, detail: '隔离验收会话容器已打开，未连接 WhatsApp。' };

async function invokeOpen(result) {
  const state = { busy: {}, accounts: [{ id: 'default', workspaceMode: 'ordinary' }], backgroundActive: true,
    workspaceMode: 'ordinary', workspaceGeneration: 0, activeAccountId: 'default',
    accountPresentationGeneration: 0, connectionAttemptGeneration: 0 };
  const toasts = [];
  const action = runInNewContext('(' + connectionActionSource + ')', {
    state,
    startBackgroundRuntime: () => false,
    captureContext: () => ({}),
    contextCurrent: () => true,
    assertContext() {},
    wsBridge: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
    syncWsGroupAllowlist: async () => {},
    setStatus: (status, detail) => Object.assign(state, { status, detail }),
    toast: (message, tone) => toasts.push([message, tone]),
    wsErrorDetail: (error) => error.message,
    classifyWsError: () => 'service',
    refreshCollectionSummary: async () => {},
    render() {},
  });
  await action('open');
  return { status: state.status, toasts };
}

test('opening an isolated Core reports the unauthenticated preview without a login prompt', async () => {
  const result = await invokeOpen(isolatedResult);
  assert.equal(result.status, '未连接');
  assert.deepEqual(result.toasts, [[isolatedResult.detail, undefined]]);
});

test('normal Open still prompts to log in and actual bridge failures still report an error', async () => {
  const normal = await invokeOpen({ status: '等待登录' });
  assert.equal(normal.status, '等待登录');
  assert.deepEqual(normal.toasts, [['WS 页面已打开，请自行扫码或登录', undefined]]);
  const failed = await invokeOpen(new Error('desktop bridge request timed out'));
  assert.equal(failed.status, '连接失败');
  assert.deepEqual(failed.toasts, [['desktop bridge request timed out', 'x']]);
});

test('an isolated factory failure survives the initial account and conversation refresh', async () => {
  const host = { state: {} };
  const state = { backgroundActive: true, workspaceMode: 'ordinary', activeAccountId: 'default',
    accounts: [{ id: 'default', workspaceMode: 'ordinary' }], accountPresentationGeneration: 0, connectionAttemptGeneration: 0 };
  const factoryFailure = new Error('isolated WS factory failed');
  const callbacks = [];
  await runInNewContext(workspaceModeHelpers + activateSource + '\nactivate(); backgroundStartPromise;', {
    state,
    getHost: () => host,
    startBackgroundRuntime: () => true,
    backgroundGeneration: 1,
    backgroundStartGeneration: 0,
    backgroundStartPromise: null,
    document: { documentElement: { dataset: {} }, body: { classList: { add() {} } } },
    $: () => ({}),
    $$: () => [],
    render() {},
    loadAccounts: async () => {},
    wsBridge: async (action) => {
      if (action === 'open') throw factoryFailure;
      return { status: '未连接', isolatedPreview: false };
    },
    syncWsGroupAllowlist: async () => {},
    captureContext: () => ({}),
    loadConversations: async () => { state.error = ''; },
    loadGroupMonitor: async () => {},
    updateAccountStatus() {},
    setStatus: (status, detail) => callbacks.push([status, detail]),
    wsErrorDetail: (error) => error.message,
    refreshCollectionSummary: async () => {},
  });
  assert.equal(state.error, factoryFailure.message);
  assert.deepEqual(callbacks, [['连接失败', factoryFailure.message]]);
});
