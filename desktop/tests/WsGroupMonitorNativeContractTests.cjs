'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const api = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Services', 'ApiClient.cs'), 'utf8');
const host = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Views', 'LegacyUiHostPage.xaml.cs'), 'utf8');
const capability = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Services/WsCollectionCapability.cs'), 'utf8');
const script = host.match(/internal static string BuildWsCollectorScript\(string accountId\)\s*\{[\s\S]*?return \$\$"""([\s\S]*?)""";/)?.[1] || '';

assert.match(api, /record WsGroupMembershipEventDto\(/, 'native API must model WS group membership events');
assert.match(api, /GroupEvents\s*=\s*null/, 'ingest batches must carry optional group events without breaking old message packets');
assert.match(api, /request\.GroupEvents[\s\S]*Count\s*==\s*0/, 'validation must allow a group-events-only ingest batch');
assert.match(host, /groupEvents/, 'native WS bridge must parse groupEvents from collector packets');
assert.match(host, /new WsGroupMembershipEventDto\(/, 'native bridge must normalize group event DTOs before queueing');
assert.match(host, /new WsIngestBatchRequestDto\([\s\S]*groupEvents/, 'group events must be sent with the normal durable WS ingest batch');
assert.match(host, /sharedState\s*=\s*request\.GroupEvents is \{ Count: > 0 \}/, 'group event sync must refresh the shared CRM state');
assert.match(host, /WsCollectorIngress\.TryAuthorize\([\s\S]*out fromBackgroundCollector/,
  'group-event authority must derive from host-owned source control, not the page role claim');
assert.match(host, /if \(fromBackgroundCollector && root\.TryGetProperty\("groupEvents"/,
  'historical group parsing remains origin-scoped; disabling runtime must not rewrite the group DTO rules');
assert.match(host, /ws-native-group-monitor/, 'native bridge must reject untrusted group-event sources');
assert.match(host, /configure-group-monitor/, 'desktop bridge must expose group monitor configuration');
assert.match(host, /start-group-monitor/, 'desktop bridge must expose group monitor start');
assert.match(host, /pause-group-monitor/, 'desktop bridge must expose group monitor pause');
assert.match(host, /stop-group-monitor/, 'desktop bridge must expose group monitor stop');
assert.match(host, /__zhikeWsConfigureGroupMonitor/, 'group monitor configuration must target the collector page API');
assert.match(host, /__zhikeWsGroupMonitor(Start|Tick)/, 'group monitor must have a collector-only heartbeat/start API');
assert.match(host, /__zhikeWsGroupMonitorPause/, 'group monitor must expose a collector-only pause API');
assert.match(host, /__zhikeWsGroupMonitorStop/, 'group monitor must expose a collector-only stop API');
assert.match(script, /groupEvents/, 'collector packets must include the group event envelope');
assert.match(script, /collectGroupMonitorPreviewEvents/, 'group monitor must inspect rendered VIP-group list previews without opening chats');
assert.doesNotMatch(script, /row\.conversationType !== 'vip_group'/, 'fixed group monitor must accept an explicitly monitored ordinary group');
assert.doesNotMatch(script, /typeEvidence\.conversationType !== 'vip_group'/, 'fixed group monitor must accept an explicitly monitored ordinary group header');
assert.match(script, /conversationIdentityFromRow/, 'group discovery must use a stable row identity');
assert.match(script, /data-group-id.*data-jid.*data-chat-id/, 'group discovery must inspect WhatsApp group/JID attributes');
assert.match(script, /const nativeKey = conversationIdentityFromRow\(row\);[\s\S]*?const identity = conflict \? '' : previewOwner\.key \|\| nativeKey;/, 'row discovery must use the robust group identity extractor');
assert.match(script, /lastMessagePreview|previewText/, 'group monitor preview observer must use existing list metadata');
assert.match(script, /申请加入|等待审核|join request|approval pending/, 'join-request system rows must be excluded before emitting joined events');
assert.match(script, /const rows = readRows\(\);\s*mergeRows\(run\.seen, rows,[\s\S]*collectGroupMonitorPreviewEvents\(rows\)/, 'the full hidden list sweep feeds the same rendered window to directory and monitor');
assert.match(script, /const groupMonitor = backgroundCollectorRole \? groupMonitorTick\(\)/, 'background heartbeat must drive the passive group monitor');
assert.match(script, /advanced, queuedTasks:collectorTasks\.size, groupMonitor/, 'background heartbeat must expose monitor health counters');
const begin = host.indexOf('private Task<BridgeResponse> ConfigureVipGroupsAsync(');
const end = host.indexOf('private async Task<List<StoredWsAccount>> LoadWsAccountsAsync(', begin);
assert.ok(begin > 0 && end > begin, 'independent group configuration boundaries must exist');
const groupMonitorMethod = host.slice(begin, end);
assert.match(groupMonitorMethod, /ConfigureGroupMonitorAsync[\s\S]*ExecuteCollectorCommandAsync/,
  'configuration executes through the running independent collector gateway');
assert.match(groupMonitorMethod, /GetWsCollectorPurposeAsync[\s\S]*GetWsCollectorMonitorAsync/,
  'purpose and exact monitor targets are confirmed by the sidecar before execution');
assert.doesNotMatch(groupMonitorMethod, /payload\.GetRawText\(\)/,
  'untrusted renderer monitor targets are never injected into the collector');
assert.match(groupMonitorMethod, /"pause" => "Pause"[\s\S]*"Stop"/,
  'safe monitor stop and pause remain available');
assert.doesNotMatch(groupMonitorMethod, /session\.View\.CoreWebView2\.ExecuteScriptAsync/,
  'group monitor never falls back to foreground chat');
assert.match(capability, /GroupMonitoring => true/);
assert.match(host, /case "configure-group-monitor":[\s\S]*ConfigureGroupMonitorAsync/);
assert.match(host, /case "start-group-monitor":[\s\S]*SetGroupMonitorStateAsync/);

console.log('WS native group contract: independently authenticated collector DTO/queue/provenance/configuration and safe monitor controls pass');
