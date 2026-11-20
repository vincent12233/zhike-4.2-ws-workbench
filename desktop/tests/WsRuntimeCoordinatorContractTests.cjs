'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const runtime = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Services/WsRuntimeCoordinator.cs'), 'utf8');
const app = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/App.xaml.cs'), 'utf8');
const mainWindow = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/MainWindow.xaml.cs'), 'utf8');

assert.match(runtime, /sealed class WsRuntimeCoordinator/);
assert.match(runtime, /WsCollectionPolicy\.PersonalWhatsAppDefault/);
assert.match(runtime, /SkipUnread:\s*true/);
assert.match(runtime, /SkipUncertainUnread:\s*true/);
assert.doesNotMatch(runtime, /CaptureVipGroups/, 'there is no VIP-group capture switch');
assert.match(runtime, /ExcludeUnlistedGroups:\s*true/);
assert.match(runtime, /RequireTrustedGroupSenderIdentity:\s*true/);
assert.match(runtime, /ExcludeUnknownConversationTypes:\s*true/);
assert.match(runtime, /CaptureIncoming:\s*true/);
assert.match(runtime, /CaptureOutgoing:\s*true/);
assert.match(runtime, /RequireVerifiedDirection:\s*true/);
assert.match(runtime, /RequireHistoryTopEvidence:\s*true/);

assert.match(runtime, /SetForegroundAccount/);
assert.match(runtime, /LeaseNextBackgroundAccount/);
assert.match(runtime, /!string\.Equals\(item\.AccountId, _foregroundAccountId/,
  'background rotation must exclude the visible account');
assert.match(runtime, /LastBackgroundLeaseAt/);
assert.match(runtime, /account\.State is [^\n]*WsAccountRuntimeState\.Registered[^\n]*WsAccountRuntimeState\.WaitingLogin/,
  'a restored account, including one with a stale WaitingLogin marker, must be probed so a valid persisted login resumes after restart');
assert.match(runtime, /NextRetryAt/);
assert.match(runtime, /ConsecutiveFailures/);
assert.match(runtime, /Math\.Pow\(2d/);
assert.match(runtime, /_maximumRetryDelay/);
assert.match(runtime, /WsAccountRuntimeSnapshot/);
assert.doesNotMatch(runtime, /WebView2|FrameworkElement|Page\b/,
  'process coordinator must not be owned by a page or XAML control');

assert.match(app, /public static WsRuntimeCoordinator WsRuntime \{ get; \}/);
assert.match(app, /public static WsWebViewSessionPool WsSessions \{ get; \}/);
assert.match(app, /public static WsRuntimeService WsService \{ get; \}/);
assert.match(app, /HydrateWsRuntimeAsync/);
assert.match(app, /new WsAccountStore\(\)\.LoadAsync/);
const host = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs'), 'utf8');
assert.match(host, /App\.WsRuntime\.RegisterAccounts\(local\)/);
assert.match(host, /App\.WsService\.HideForeground\(\)/);
assert.match(host, /WsRuntimeCoordinator\.FromDisplayStatus\(status\)/);
assert.match(mainWindow, /OpenWorkspaceRoute\(string route\)[\s\S]{0,600}ContentFrame\.Navigate\(typeof\(LegacyUiHostPage\)\)/,
  'every route, including WS, must enter the single HTML/WebView2 production host');
assert.doesNotMatch(mainWindow, /"ws-workbench"\s*=>\s*typeof\(WsWorkbenchPage\)/,
  'native duplicate WS page must not be production-routable');
const fallbackSet = mainWindow.match(/NativeFallbackRoutes[\s\S]*?\{([\s\S]*?)\};/)?.[1] || '';
assert.doesNotMatch(fallbackSet, /ws-workbench/,
  'WS must not silently fall back to the second implementation');

console.log('WS runtime coordinator contract: process-owned multi-account policy, foreground isolation, fair leases and retry backoff pass');
