'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const main = read('desktop/src/Zhike.Desktop/MainWindow.xaml.cs');
const host = read('desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs');
const hostXaml = read('desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml');
const api = read('desktop/src/Zhike.Desktop/Services/ApiClient.cs');

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

assert.match(host, /window\.__zhikeWsBackgroundTick\?\.\(\)/, 'a native heartbeat must wake throttled background collector timers');
assert.match(host, /window\.__zhikeWsBackgroundTick\s*=\s*\(\)\s*=>[\s\S]*scheduleIncrementalReadHistory\(80\)/, 'the background heartbeat must schedule full-history incremental work');
assert.match(host, /drainDueCollectorTasks\(\)/, 'the native heartbeat must advance collector tasks whose hidden-page rAF/timer never fired');
assert.match(host, /scheduleCollectorPaint\(processNext\)/, 'full-history pagination must use the heartbeat-aware paint scheduler');
assert.match(host, /Publish\("ws\.background-tick"[\s\S]*accountId[\s\S]*observedAt/, 'the parent AI pump receives a metadata-only background wake event');
assert.match(host, /WriteBackgroundHeartbeatAsync\([\s\S]*"allRounds"[\s\S]*"allNoProgressMs"/, 'bounded diagnostics expose list readiness and fixed numeric scan progress without customer identifiers or message content');
assert.match(host, /scheduleIncrementalReadHistory\(3500, true\)[\s\S]*highPriorityHistoryRetryPending/, 'an explicit retry remains higher priority than an optional full-list preview scan');
assert.match(host, /LIST_SCAN_STALL_MS\s*=\s*30 \* 1000[\s\S]*page-list-interrupted/, 'a non-progressing full-list scan yields with recoverable partial checkpoints');

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

assert.match(api, /string\s+ConversationType\s*=\s*""[\s\S]*bool\?\s+IsGroup\s*=\s*null[\s\S]*bool\s+VipGroup\s*=\s*false/, 'checkpoint DTO preserves direct/group/VIP metadata compatibly');
assert.match(host, /allowedConversationKeys[\s\S]*item\.ConversationType, "direct"[\s\S]*item\.VipGroup[\s\S]*"vip_group"[\s\S]*messages\.RemoveAll/, 'native ingress accepts direct and explicit VIP-group bodies while discarding ordinary groups');
assert.doesNotMatch(main, /WsWorkbenchPage/, 'the retired native fallback must not be production-routable');

console.log('WS background lifecycle contract: retained pooled WebViews, metadata heartbeat, stable DPI bounds and direct/VIP ingress are wired');
