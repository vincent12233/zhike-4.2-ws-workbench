'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const desktop = path.join(repo, 'desktop', 'src', 'Zhike.Desktop');
const host = fs.readFileSync(path.join(desktop, 'Views', 'LegacyUiHostPage.xaml.cs'), 'utf8');
const standalone = fs.readFileSync(path.join(desktop, 'Views', 'WsWorkbenchPage.xaml.cs'), 'utf8');
const log = fs.readFileSync(path.join(desktop, 'Services', 'WsCollectorDiagnosticLog.cs'), 'utf8');
const scriptMatch = host.match(/return \$\$"""([\s\S]*?)""";/);
assert.ok(scriptMatch);
const script = scriptMatch[1];

for (const event of ['collection-run-start', 'collection-window', 'collection-attempt', 'collection-run-finish', 'collection-paused', 'history-retryable'])
  assert.match(script, new RegExp(`postCollectorEvent\\('${event}'`), `collector must emit ${event}`);
for (const field of ['rowCount', 'readCount', 'skipCount', 'pendingCount', 'domNodeKnownCount'])
  assert.match(script, new RegExp(`${field}`), `collector window diagnostics must include ${field}`);

assert.match(host, /WsCollectorDiagnosticLog\.WriteAsync/, 'legacy host must persist sanitized lifecycle diagnostics');
assert.match(standalone, /WsCollectorDiagnosticLog\.WriteAsync/, 'standalone WS page must persist sanitized lifecycle diagnostics');
assert.match(host, /WriteDirectionStructureAsync/, 'legacy host must persist privacy-safe unresolved-direction structure diagnostics');
assert.match(standalone, /WriteDirectionStructureAsync/, 'standalone page must persist privacy-safe unresolved-direction structure diagnostics');
assert.match(log, /MaxBytes\s*=\s*256\s*\*\s*1024/, 'diagnostic file must remain bounded to 256 KB');
assert.match(log, /RetainedBytes\s*=\s*128\s*\*\s*1024/, 'bounded log must retain only a tail when cycling');
assert.match(log, /ws-collector\.jsonl/, 'collector diagnostics use one local bounded JSONL file');
assert.match(log, /ClosedValue\(eventName, AllowedEvents, "unknown"\)/, 'event names must use a closed enum whitelist');
assert.match(log, /ClosedValue\(coverage, AllowedCoverage, string\.Empty\)/, 'coverage must use a closed enum whitelist');
assert.match(log, /ClosedValue\(reason, AllowedReasons, string\.Empty\)/, 'reason must use a closed enum whitelist');
const heartbeatRecord = log.match(/public static Task WriteBackgroundHeartbeatAsync\(([\s\S]*?)public static async Task WriteDirectionStructureAsync/);
assert.ok(heartbeatRecord, 'background progress must use a dedicated fixed-field writer');
for (const allowed of ['listReady', 'scanning', 'allScanning', 'retryScheduled', 'highPriorityRetryPending', 'advanced', 'queuedTasks', 'allRounds', 'allSeen', 'allScrollTop', 'allMax', 'allAgeMs', 'allNoProgressMs'])
  assert.match(heartbeatRecord[1], new RegExp(`\\b${allowed}\\b`), `heartbeat diagnostics must include fixed numeric/boolean ${allowed}`);
for (const forbidden of ['accountId', 'conversationKey', 'customer', 'body', 'payload', 'cookie', 'token'])
  assert.doesNotMatch(heartbeatRecord[1], new RegExp(`\\b${forbidden}\\b`, 'i'), `heartbeat diagnostics must not persist ${forbidden}`);
assert.doesNotMatch(log, /char\.IsAsciiLetterOrDigit|SafeToken/, 'arbitrary ASCII tokens must never be accepted into diagnostics');
assert.doesNotMatch(log, /HttpClient|CoreWebView2|CookieManager|GetCookiesAsync/, 'diagnostic persistence must not expose a port, browser state or cookies');

function closedValues(name) {
  const block = log.match(new RegExp(`${name}\\s*=\\s*new\\(StringComparer\\.Ordinal\\)\\s*\\{([\\s\\S]*?)\\};`));
  assert.ok(block, `${name} must remain an explicit closed set`);
  return new Set([...block[1].matchAll(/"([^"]+)"/g)].map(match => match[1]));
}
const allowedReasons = closedValues('AllowedReasons');
const normalizeReason = value => allowedReasons.has(value) ? value : '';
assert.equal(normalizeReason('user-interaction'), 'user-interaction', 'known reason survives closed normalization');
assert.equal(normalizeReason('sk-secret-123'), '', 'injected ASCII secret-like reason is discarded rather than logged');

const record = log.match(/var record = new\s*\{([\s\S]*?)\n\s*\};/);
assert.ok(record, 'fixed diagnostic record schema must remain explicit');
for (const forbidden of ['accountId', 'conversationKey', 'customer', 'body', 'payload', 'cookie', 'token'])
  assert.doesNotMatch(record[1], new RegExp(`\\b${forbidden}\\s*=`, 'i'), `diagnostic record must not persist ${forbidden}`);
for (const allowed of ['time', 'eventName', 'coverage', 'reason', 'discovered', 'processed', 'attempted', 'retryable', 'skippedUnread', 'rowCount', 'readCount', 'skipCount', 'pendingCount', 'domNodeKnownCount'])
  assert.match(record[1], new RegExp(`\\b${allowed}\\b`), `diagnostic record must include ${allowed}`);

const directionRecord = log.match(/public static async Task WriteDirectionStructureAsync\(([\s\S]*?)private static async Task AppendRecordAsync/);
assert.ok(directionRecord, 'unresolved-direction diagnostics must use a dedicated closed-field writer');
for (const forbidden of ['accountId', 'conversationKey', 'customer', 'body', 'payload', 'cookie', 'token', 'className', 'dataId', 'ariaLabel'])
  assert.doesNotMatch(directionRecord[1], new RegExp(`\\b${forbidden}\\b`, 'i'), `direction diagnostics must not persist ${forbidden}`);
for (const allowed of ['depth', 'tag', 'role', 'classDirection', 'dataPrefix', 'align', 'hasMsgCheck', 'hasMsgDblcheck', 'hasTailOut', 'hasTailIn'])
  assert.match(directionRecord[1], new RegExp(`\\b${allowed}\\b`), `direction diagnostics must include sanitized ${allowed}`);

console.log('WS collector diagnostics contract: fixed-field lifecycle telemetry is local, sanitized and bounded to 256 KB');
