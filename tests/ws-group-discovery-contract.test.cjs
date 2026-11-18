'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'resources/app/server.mjs'), 'utf8');
const workbench = fs.readFileSync(path.join(root, 'resources/app/modules/ws-workbench.js'), 'utf8');

// Ordinary groups are intentionally excluded from the customer/AI inventory,
// but they must still be returned as monitor candidates after WS discovery.
assert.match(server, /groupConversations:\s*excludedRows\.filter\(wsIsExcludedGroup\)\.map\(wsConversationPayload\)/,
  'conversation listing must return group rows separately for the WS monitor picker');

// Every discovery refresh path must merge the separate group payload without
// promoting ordinary groups into the personal collection queue.
assert.match(workbench, /groupConversations/,
  'WS workbench must consume the separate group discovery payload');
assert.match(workbench, /function discoveryGroupRows[\s\S]*groupConversations/,
  'WS workbench must read groupConversations as a separate discovery stream');
assert.match(workbench, /mergeDiscoveredGroupRows\(discoveryGroupRows\(/,
  'WS workbench must populate the group picker from the separate discovery stream');
assert.match(workbench, /state\.wsStatus === '已连接' \|\| result\.status === '已连接'\) await loadConversations\(\)/,
  'login/reload must refresh conversations even when direct-chat rows already exist');
assert.match(workbench, /const wasConnected = state\.wsStatus === '已连接'[\s\S]*?if \(!wasConnected && payloadAccountId === String\(state\.activeAccountId \|\| 'default'\)\) void loadConversations\(\)/,
  'the asynchronous QR-login connected event must trigger one account-scoped discovery refresh');

// The bulk "扫描已配置群组" action uses the same discovered rows as the
// picker.  Ordinary fixed-monitor targets are not VIP customer records, so
// this candidate path must not require a VIP allowlist or silently drop the
// separate group discovery state.
const candidates = workbench.match(/function groupMonitorCandidates\(\) \{([\s\S]*?)\n  \}/)?.[1] || '';
assert.match(candidates, /discoveredGroupConversations/,
  'bulk group scan must include separately discovered ordinary groups');
assert.doesNotMatch(candidates, /isAutomaticVipGroupConversation\(row\)|isConfiguredVipGroupIdentifier\(groupJid, groupName\)/,
  'bulk group scan must not require VIP customer configuration');

console.log('ws-group-discovery-contract: pass');
