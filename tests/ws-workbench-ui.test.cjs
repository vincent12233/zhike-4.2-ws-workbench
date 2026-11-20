'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const ui = read('resources/app/modules/ws-workbench.js');
const css = read('resources/app/modules/ws-workbench.css');
const host = read('desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs');
for (const marker of ['accounts:', 'activeAccountId', 'create-account', 'switch-account', 'leftCollapsed', 'rightCollapsed', 'ResizeObserver', 'refreshCollectionSummary', 'analyzeStoredConversation', 'syncAnalysisToCrm']) assert.match(ui, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.match(ui, /async function createWsAccountRecord\(account\)/,
  'adding a WS account must have a dedicated resilient creation path');
assert.match(ui, /wsAccounts\(\{ action: 'create'/,
  'desktop bridge remains the preferred WS account creation path');
assert.match(ui, /api\('\/api\/ws\/accounts'/,
  'adding a WS account must fall back to the local account API when the bridge is unavailable');
assert.match(ui, /WS 账号创建超时/,
  'a hung desktop bridge must become an actionable account creation error');
assert.match(ui, /messageCollapsed: readPanelCollapsed\('messages'\)/,
  'local messages must keep a persisted collapsed state');
assert.match(ui, /localPanelsCollapsed: readPanelCollapsed\('local-panels'\)/,
  'the whole local import/transcript band must keep a persisted collapsed state');
assert.match(ui, /data-ws-action="toggle-messages"/,
  'local messages must expose a collapse control');
assert.match(ui, /data-ws-action="toggle-local-panels"/,
  'the WS toolbar must expose a master local-panel collapse control');
assert.match(ui, /id="wsMessagePanel" class="ws-message-panel/,
  'local messages must have an isolated collapsible panel');
assert.match(ui, /if \(action === 'toggle-messages'\)/,
  'local message collapse must use the existing WS action dispatcher');
assert.doesNotMatch(ui, /\bprompt\s*\(/);
assert.match(ui, /window\.__zhikeWsFollowups/);
assert.match(ui, /function requestAccountPipelineRefresh\(accountId/,
  'native events must route background collection and AI refresh by account');
assert.match(ui, /payloadAccountId !== String\(state\.activeAccountId/,
  'a background account status must not overwrite the visible account status');
assert.match(ui, /function loadAllConversationPages\(context/);
assert.match(ui, /conversations\?limit=1000/);
assert.match(ui, /nextCursor/);
assert.match(ui, /\/api\/ws\/crm-sync/);
assert.match(ui, /独立采集会话需单独扫码/,
  'background collection must disclose its independent login requirement');
assert.match(ui, /COLLECTION_CAPABILITY_BLOCKED/);
assert.match(ui, /class="ws-login-summary"/);
assert.match(ui, /id="wsStatusDetail" class="ws-login-status" title=/);
assert.match(ui, /detail\.title = statusDetail/);
assert.match(ui, /ws-toolbar-open[^"\n]*" data-ws-action="open"/);
assert.match(ui, /ws-toolbar-collect[^"\n]*" data-ws-action="collect-all-read"/);
assert.match(ui, /conversation\.unread === true \|\| Number\(conversation\.unreadCount \|\| 0\) > 0 \|\| text\(conversation\.collectionStatus\) === 'skipped_unread'/,
  'the retained manual AI/history guards must continue to identify unread conversations');
assert.match(ui, /当前桌面未提供独立采集会话；前台聊天和手动导入可用/,
  'missing native capability must preserve the explicit unavailable state');
const manualCreate = ui.slice(ui.indexOf('  async function createConversation()'), ui.indexOf('      assertContext(context);', ui.indexOf('  async function createConversation()')));
assert.match(manualCreate, /群组目录[\s\S]*?return;[\s\S]*?api\('/, 'manual group entry ends before an API write');
assert.doesNotMatch(manualCreate, /vip_group|vipGroup/, 'manual input cannot create group metadata');
assert.match(ui, /const conversationType = isAutomaticVipGroupConversation\(normalized\) \? 'vip_group' : 'direct'/,
  'native list discovery must retain configured VIP-group identity');
assert.match(ui, /customerId: vipGroup \? '' : matchedCustomerId/,
  'a VIP group may never bind the entire conversation to one customer');
assert.match(ui, /importType\.type === 'group' && !vipGroup/,
  'manual transcript import excludes ordinary groups but permits a configured VIP group');
assert.match(ui, /senderIdentityTrusted:false/,
  'a pasted VIP-group sender label must never become trusted customer identity evidence');
assert.doesNotMatch(ui, /'群聊不纳入(?:采集| WS 客户采集| AI 分析)/,
  'group policy messages must distinguish excluded ordinary groups from configured VIP groups');
assert.match(ui, /class="ws-runtime-strip"/,
  'the workbench must expose the live background collection and AI pipeline state without opening a conversation');
for (const marker of ['后台采集不可用', '完整历史', '待分析', '跳过未读']) assert.match(ui, new RegExp(marker));
for (const action of ['open-home', 'open-tasks']) assert.match(ui, new RegExp(`data-ws-action="${action}"`),
  `WS runtime overview must provide the ${action} cross-workspace entry`);
assert.match(ui, /置信度较低.*只补空字段策略自动处理/);
assert.match(ui, /冲突保留原值并记录证据/);
assert.match(ui, /core\.messageSentAt\?\.\(message\)/, 'message cards must use the authoritative WhatsApp sent time helper');
assert.match(ui, /发送时间未识别/, 'unknown collected timestamps must not be shown as today');
assert.match(ui, /采集于/, 'unknown sent time may expose observation time only as explanatory title text');
assert.match(ui, /未匹配现有客户，已保留分析且未新增客户/);
assert.doesNotMatch(ui, /低置信度或缺少分析编号，等待人工确认/);
assert.match(css, /left-collapsed/);
assert.match(css, /ws-sidebar-collapse/);
assert.match(css, /\.workspace-chat \.ws-login-toolbar\{[^}]*display:flex[^}]*min-height:54px[^}]*padding:4px 12px/,
  'foreground chat reserves the S1 54px command band around the unchanged 44px controls');
assert.match(css, /\.workspace-chat \.ws-login-summary\{display:none\}/,
  'foreground chat avoids duplicate account headings');
assert.match(css, /\.workspace-chat \.ws-toolbar-actions\{[^}]*flex-wrap:nowrap[^}]*overflow-x:auto/,
  'chat actions remain reachable through horizontal scrolling without adding rows');
assert.match(css, /\.ws-toolbar-open\{min-width:\d+px\}/);
assert.match(css, /\.ws-toolbar-collect\{min-width:\d+px\}/);
assert.match(css, /\.workspace-chat \.ws-toolbar-actions>\.btn\{[^}]*min-height:44px[^}]*height:44px[^}]*font-size:var\(--ds-font-body,14px\)/,
  'WS toolbar actions retain a stable readable height');
assert.match(css, /\.ws-capture-panel\.is-collapsed \.ws-capture-heading>div:first-child>span,[^}]*\{display:none\}/,
  'collapsed manual import must hide its descriptive line and keep only title/action chrome');
assert.match(css, /\.workspace-chat\.ws-local-tools-open \.ws-local-workspace \.btn\{[^}]*min-height:44px[^}]*font-size:var\(--ds-font-body,14px\)/,
  'explicit local tools override the old compact import control size');
assert.match(css, /\.ws-message-list\{[^}]*max-height:clamp\(88px,12vh,120px\)[^}]*overflow:auto/,
  'desktop local messages must remain independently scrollable without shrinking the WS browser');
assert.match(css, /\.ws-message-panel\.is-collapsed\{[^}]*max-height:30px[^}]*overflow:hidden/,
  'collapsed local messages must release vertical space for the WS browser');
assert.match(css, /\.workspace-chat \.ws-local-workspace\{display:none\}/,
  'foreground chat must give the official login/chat surface the local tools space by default');
assert.match(css, /\.workspace-chat\.ws-local-tools-open \.ws-local-workspace\{[^}]*display:flex[^}]*max-height:32%[^}]*overflow:auto!important/,
  'explicit local tools must remain reachable in a bounded scroll area');
assert.match(css, /@media \(max-width:900px\)[\s\S]*?\.ws-message-list\{max-height:min\(120px,22vh\);min-height:72px;overflow:auto/,
  '820px/mobile layout must keep the local message pane reachable through its own scroll area');
assert.match(css, /body\.ws-mode \.ws-runtime-strip\{[^}]*display:grid/,
  'the 6.0 WS cockpit must give its runtime overview a stable responsive layout');
assert.match(ui, /class="ws-cockpit-bar"/, 'WS reference layout needs a dedicated account and collector cockpit');
assert.match(ui, /内嵌 WhatsApp Web/, 'WS heading preserves the official foreground chat surface');
assert.match(ui, /独立采集会话需单独扫码/, 'WS controls disclose separate collector authentication');
assert.match(ui, /title="登录资料由各自的 WebView2 会话保存，不复制账号认证数据"/, 'WS privacy disclosure describes actual profile persistence');
assert.match(ui, /class="ws-assist-tabs"/, 'WS reference layout needs the right-side assistant tab strip');
for (const label of ['AI 分析', '客户档案', '回复建议', '采集诊断']) assert.match(ui, new RegExp(`title="${label}"`), `WS assistant tab ${label} needs an accessible title`);
assert.match(ui, /class="ws-assist-drawer(?:\s|\")/, 'WS assistant content must be hosted in a floating drawer');
assert.match(ui, /class="ws-assist-drawer-body(?:\s|\")/, 'WS assistant drawer needs an isolated scroll body');
assert.match(ui, /class="ws-assist-launcher(?:\s|\")/, 'closed assistant drawer must leave a reachable launcher');
assert.match(ui, /data-ws-action="close-assist-drawer"/, 'assistant drawer needs an explicit close action');
assert.match(ui, /data-ws-action="assist-backdrop"/, 'assistant drawer needs a click-outside close target');
assert.match(ui, /data-assist-drawer-drag="true"/, 'assistant drawer header needs a stable drag surface');
assert.match(ui, /state\.mobilePanel = 'right'/, 'narrow windows must reveal the assistant drawer from the mobile tab');
assert.match(ui, /const targetTop = relativeTop - 8/, 'assistant tab jumps must account for the drawer body viewport');
assert.match(ui, /assistDrawerOpen:\s*readAssistDrawerState\('open'\)/, 'assistant drawer open state must persist locally');
assert.match(ui, /assistDrawerTab:\s*readAssistDrawerState\('tab'\)/, 'assistant drawer tab must persist locally');
assert.match(ui, /assistDrawerWidth:\s*readAssistDrawerState\('width'\)/, 'assistant drawer width must persist locally');
assert.match(ui, /data-assist-drawer-tab=/, 'assistant tabs must expose the active drawer tab');
assert.match(ui, /function clampAssistDrawerWidth\(value\)[\s\S]{0,200}Math\.min\(620/, 'assistant drawer width must have a 620px upper bound');
assert.match(ui, /focus-assist[\s\S]{0,500}assistDrawerOpen = true/, 'focus-assist must open the drawer without changing business context');
assert.doesNotMatch(ui, /focus-assist[\s\S]{0,700}ws\(\{ action: 'resize'/, 'assistant tab changes must not resize the native WS WebView');
assert.match(ui, /class="ws-flow-strip"/, 'WS reference layout needs a bottom collection flow strip');
assert.match(ui, /const preservedBrowserHost = \$\('#wsBrowserHost'\)/,
  'WS redraws must preserve the native browser host node to prevent visible WebView jitter');
assert.match(ui, /function mountWsWorkbenchShell\(target, markup\)/,
  'WS redraws must patch the shell in place instead of replacing the native host');
assert.doesNotMatch(ui, /preservedBrowserHost\?\.remove\?\.\(\)/,
  'WS redraws must not detach the native browser host');
assert.match(ui, /const preservedAssistPanel = \$\('#wsAssistPanel'\)/,
  'WS redraws must keep the right assist scroll container node alive');
assert.match(ui, /patchWorkbenchAssist\(currentAssist, nextAssist\)/,
  'WS redraws must update assistant cards without replacing the scrolling element');
assert.match(ui, /function restoreWorkbenchScroll\(positions\)/,
  'WS redraws must have a synchronous scroll restoration helper');
assert.match(ui, /render\(\);\s*restoreWorkbenchScroll\(positions\);/,
  'WS scroll positions must be restored in the same task as the redraw');
assert.match(ui, /id="wsAiBackgroundError"/,
  'background AI errors must have a stable DOM anchor');
assert.match(ui, /function updateAiBackgroundErrorDom\(\)/,
  'background AI status must update in place without redrawing the WS shell');
assert.match(ui, /state\.aiBackgroundError = `后台 AI 分析待重试：[\s\S]{0,700}updateAiBackgroundErrorDom\(\);/,
  'AI retry errors must update the stable status node instead of rebuilding the WS shell');
assert.doesNotMatch(ui, /requestAnimationFrame\(\(\) => \{\s*for \(const position of positions\)/,
  'WS scroll restoration must not wait a frame after replacing the shell');
assert.match(ui, /Math\.abs\(bounds\.width - lastResizeGeometry\.width\) < 2/,
  'native resize must ignore sub-pixel scrollbar jitter');
assert.match(ui, /const isBackgroundTick = payload\?\.eventName === 'background-tick' \|\| payload\?\.background === true/,
  'background WS heartbeats must be identified as telemetry');
assert.match(ui, /const isTelemetryTick = payload\.eventName === 'background-tick' && !text\(payload\.detail\);[\s\S]{0,260}if \(isTelemetryTick && payload\.status === state\.wsStatus\) updateStatusDom\(\);/,
  'heartbeat telemetry must not replace the stable foreground status text');
assert.match(ui, /const isTelemetryTick = payload\?\.eventName === 'background-tick' && !text\(payload\?\.detail\);/,
  'account status handling must classify empty-detail background telemetry');
assert.match(ui, /!\(isTelemetryTick && payload\.status === state\.wsStatus\)\) setStatus\(/,
  'unchanged telemetry must not clear or rewrite the foreground status state');
assert.match(ui, /if \(badge\.textContent !== state\.wsStatus\)/,
  'status DOM updates must be value guarded to avoid needless layout measurement');
assert.match(ui, /if \(\(capabilityChanged \|\| \(!isBackgroundTick && statusChanged\)\) && id === String\(state\.activeAccountId\) && state\.active && host\?\.state\?\.view === 'ws-workbench'\) render\(\{ skipNativeResize: true \}\)/,
  'unchanged background heartbeats must not rebuild the shell; collector state changes update controls without resizing native chat');
assert.match(ui, /async function refreshCollectionSummary\(options = \{\}\)/,
  'collection refreshes must distinguish background telemetry from explicit foreground refreshes');
assert.match(ui, /if \(\(!backgroundRefresh \|\| !state\.active\) && collectionRenderSignature\(\) !== beforeRenderSignature\) renderPreservingScroll\(\)/,
  'background collection refreshes must not rebuild the visible WS shell while the operator is chatting');
assert.match(ui, /if \(!backgroundRefresh \|\| !state\.active\) renderPreservingScroll\(\);\s*else updateStatusDom\(\);/,
  'background collection errors must not rebuild the visible WS shell while the operator is chatting');
assert.match(ui, /ws-center-panel \$\{state\.messageCollapsed \? 'messages-collapsed' : ''\}/,
  'center layout must expose the message collapsed state for responsive geometry');
assert.match(ui, /state\.localPanelsCollapsed \? 'local-panels-collapsed' : ''/,
  'center layout must expose the master local-panel collapsed state');
assert.match(css, /body\.ws-workspace-active \.ws-workbench-shell \.workspace-chat \.ws-browser-host\{[^}]*flex:1 1 0[^}]*min-height:0/,
  'the embedded WhatsApp surface must fill the remaining chat region without a competing fixed minimum');
assert.match(css, /\.ws-assist-panel\{[^}]*overflow-anchor:none/,
  'right assistant scrolling must disable browser scroll anchoring during AI card updates');
assert.match(css, /\.workspace-chat \.ws-center-panel\{[^}]*display:flex[^}]*flex-direction:column[^}]*min-height:0/,
  'the chat region must reserve its stable toolbar and release every remaining pixel to the native surface');
assert.match(css, /\.workspace-chat \.ws-layout\{[^}]*grid-template-columns:minmax\(0,1fr\) clamp\(340px,27vw,380px\)/,
  'foreground chat must have two regions: native WhatsApp and a readable CRM pane');
assert.match(css, /--ws-control-height:var\(--ds-control-height,44px\)/,
  'chat controls consume the shared accessible scale with an explicit 44px fallback');
assert.match(read('resources/app/modules/design-system.css'), /--ds-control-height:44px/,
  'the shared design-system control target must remain 44px across Windows display scales');
assert.match(css, /\.workspace-chat \.ws-runtime-strip\{display:none\}/,
  'periodic background status must not add competing rows to the foreground chat');
assert.match(css, /body\.ws-workspace-active #sidebar\{display:none!important\}/,
  'the original Zhike sidebar must be hidden only while the independent WS route is active');
assert.match(host, /discover-conversations/);
assert.match(host, /__zhikeWsDiscoverAll/);
assert.match(host, /capture-visible-messages/);
assert.match(host, /ValueKind\.String/);
assert.match(host, /JsonSerializer\.Deserialize<string>\(json\)/,
  'WebView2 JSON-string results must be unwrapped before WS capture payload parsing');
const { renderWsWorkbenchFixture } = require('./helpers/ws-workbench-render-fixture.cjs');
const liveBackgroundPill = { textContent: '', dataset: {} };
const liveState = { backgroundActive: true, wsStatus: '已连接', wsDetail: '', activeAccountId: 'default', accounts: [{ id: 'default' }] };
const liveStatusStart = ui.indexOf('  function wsBackgroundStatus('), liveStatusEnd = ui.indexOf('  function updateAiBackgroundErrorDom(', liveStatusStart);
assert.ok(liveStatusStart > 0 && liveStatusEnd > liveStatusStart);
const capabilityStart = ui.indexOf('  const COLLECTION_CAPABILITY_BLOCKED ='), capabilityEnd = ui.indexOf('  function createGroupMonitorState(', capabilityStart);
assert.ok(capabilityStart > 0 && capabilityEnd > capabilityStart, 'status fixture uses the actual fail-closed capability implementation');
const liveStatus = { state: liveState, text: value => String(value ?? '').trim(), $: selector => selector === '.ws-chat-background-status' ? liveBackgroundPill : null };
vm.runInNewContext(ui.slice(capabilityStart, capabilityEnd) + ui.slice(liveStatusStart, liveStatusEnd) + '\nglobalThis.update=updateStatusDom;', liveStatus);
liveStatus.update(); assert.equal(liveBackgroundPill.textContent, '后台采集不可用');
assert.equal(liveBackgroundPill.dataset.tone, 'blocked');
assert.equal(liveState.wsStatus, '已连接', 'blocked collection does not rewrite a usable foreground connection');
liveState.wsStatus = '连接失败'; liveStatus.update();
assert.equal(liveBackgroundPill.textContent, '后台采集不可用'); assert.equal(liveBackgroundPill.dataset.tone, 'blocked');
liveState.backgroundActive = false; liveStatus.update();
assert.equal(liveBackgroundPill.textContent, '后台采集不可用'); assert.equal(liveBackgroundPill.dataset.tone, 'blocked');
for (const [options, expected] of [
  [{ backgroundActive: false, wsStatus: '未连接' }, '后台采集不可用'],
  [{ backgroundActive: true, wsStatus: '等待登录' }, '后台采集不可用'],
  [{ backgroundActive: true, wsStatus: '已连接' }, '后台采集不可用'],
]) {
  const fullChat = renderWsWorkbenchFixture({ ...options, view: 'chat' });
  assert.equal(fullChat.match(/<span class="ws-chat-background-status"[^>]*>([^<]*)<\/span>/)?.[1], expected,
    'collection capability remains blocked independently of the manual foreground lifecycle and connection');
  assert.match(fullChat, /class="ws-command-rail" aria-label="WS 账号与采集控制舱"/,
    'layout fixtures must include the real legacy cockpit wrapper, even when CSS hides it');
  assert.match(fullChat, /class="ws-process-rail"/,
    'layout fixtures must include the real flow wrapper so it cannot silently consume chat height');
  assert.equal((fullChat.match(/id="wsBrowserHost"/g) || []).length, 1);
}
console.log('ws-workbench-ui: accounts, collapsible panels, list capture and AI sync contracts pass');
