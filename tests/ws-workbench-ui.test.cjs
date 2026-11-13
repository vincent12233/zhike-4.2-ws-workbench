'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const ui = read('resources/app/modules/ws-workbench.js');
const css = read('resources/app/modules/ws-workbench.css');
const host = read('desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs');
for (const marker of ['accounts:', 'activeAccountId', 'create-account', 'switch-account', 'leftCollapsed', 'rightCollapsed', 'ResizeObserver', 'refreshCollectionSummary', 'analyzeStoredConversation', 'syncAnalysisToCrm']) assert.match(ui, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.doesNotMatch(ui, /\bprompt\s*\(/);
assert.match(ui, /window\.__zhikeWsFollowups/);
assert.match(ui, /conversations\?limit=5000/);
assert.match(ui, /\/api\/ws\/crm-sync/);
assert.match(ui, /自动采集已读会话/);
assert.match(ui, /class="ws-login-summary"/);
assert.match(ui, /id="wsStatusDetail" class="ws-login-status" title=/);
assert.match(ui, /detail\.title = statusDetail/);
assert.match(ui, /ws-toolbar-open[^"\n]*" data-ws-action="open"/);
assert.match(ui, /ws-toolbar-collect[^"\n]*" data-ws-action="collect-all-read"/);
assert.match(ui, /未读会话永不自动打开/);
assert.match(ui, /置信度较低.*只补空字段策略自动处理/);
assert.match(ui, /冲突保留原值并记录证据/);
assert.match(ui, /core\.messageSentAt\?\.\(message\)/, 'message cards must use the authoritative WhatsApp sent time helper');
assert.match(ui, /发送时间未识别/, 'unknown collected timestamps must not be shown as today');
assert.match(ui, /采集于/, 'unknown sent time may expose observation time only as explanatory title text');
assert.match(ui, /未匹配现有客户，已保留分析且未新增客户/);
assert.doesNotMatch(ui, /低置信度或缺少分析编号，等待人工确认/);
assert.match(css, /left-collapsed/);
assert.match(css, /ws-sidebar-collapse/);
assert.match(css, /\.ws-login-toolbar\{[^}]*display:grid[^}]*grid-template-columns:minmax\(0,1fr\)/);
assert.match(css, /\.ws-login-summary\{[^}]*grid-template-columns:auto minmax\(0,1fr\)[^}]*min-width:0/);
assert.match(css, /\.ws-login-summary \.ws-login-status\{[^}]*text-overflow:ellipsis[^}]*white-space:nowrap/);
assert.match(css, /\.ws-toolbar-actions\{[^}]*width:100%[^}]*flex-wrap:wrap[^}]*justify-content:flex-start/);
assert.match(css, /\.ws-toolbar-open\{min-width:\d+px\}/);
assert.match(css, /\.ws-toolbar-collect\{min-width:\d+px\}/);
assert.match(css, /\.ws-login-toolbar \.ws-toolbar-actions \.btn\{[^}]*min-height:28px[^}]*height:28px/,
  'WS toolbar actions must override global button minimums with a stable compact height');
assert.match(css, /\.ws-capture-panel\.is-collapsed \.ws-capture-heading>div:first-child>span,[^}]*\{display:none\}/,
  'collapsed manual import must hide its descriptive line and keep only title/action chrome');
assert.match(css, /\.ws-capture-panel\.is-collapsed \.ws-capture-heading-actions \.btn\{[^}]*min-height:28px[^}]*height:28px/,
  'collapsed import action must fit without inheriting the global 34/38px button minimum');
assert.match(css, /\.ws-message-list\{[^}]*max-height:clamp\(88px,12vh,120px\)[^}]*overflow:auto/,
  'desktop local messages must remain independently scrollable without shrinking the WS browser');
assert.match(css, /@media \(max-width:900px\)[\s\S]*?\.ws-message-list\{max-height:min\(120px,22vh\);min-height:72px;overflow:auto/,
  '820px/mobile layout must keep the local message pane reachable through its own scroll area');
assert.match(host, /discover-conversations/);
assert.match(host, /__zhikeWsDiscoverAll/);
assert.match(host, /capture-visible-messages/);
assert.match(host, /ValueKind\.String/);
assert.match(host, /JsonSerializer\.Deserialize<string>\(json\)/,
  'WebView2 JSON-string results must be unwrapped before WS capture payload parsing');
console.log('ws-workbench-ui: accounts, collapsible panels, list capture and AI sync contracts pass');
