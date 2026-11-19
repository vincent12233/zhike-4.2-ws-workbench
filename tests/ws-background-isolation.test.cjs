'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const host = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs'), 'utf8');
const runtime = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Services/WsRuntimeService.cs'), 'utf8');

assert.match(host, /ConcurrentDictionary<string, DateTimeOffset>\s+_lastForegroundWsHeartbeatAtByAccount/,
  'foreground WS heartbeat timestamps must be tracked per account');
assert.doesNotMatch(host, /DateTimeOffset _lastForegroundWsHeartbeatAt\s*=/,
  'foreground heartbeat must not use a single global timestamp');
assert.match(host, /ExecuteScriptAsync\([\s\S]*?ConfigureAwait\(false\)/,
  'WebView script results must leave the UI context before parsing');
const tick = runtime.slice(runtime.indexOf('    public async Task TickAsync('), runtime.indexOf('    public async Task ShutdownAsync('));
assert.ok(tick.includes('RunHeartbeatAsync(foreground, false'), 'existing foreground sessions retain their read-only heartbeat');
assert.doesNotMatch(tick, /LeaseNextBackgroundAccount\(|GetOrCreateAsync\(/,
  'the timer cannot create accounts or authenticate a collector without an explicit action');
assert.match(runtime, /RecordHeartbeat\(session\.AccountId\)/,
  'runtime must record heartbeat by account');
console.log('ws-background-isolation: per-account heartbeat and non-UI parsing contract');

assert.doesNotMatch(tick, /ConfigureAwait\(false\)/, 'native WebView operations following a heartbeat must retain the UI dispatcher');
assert.match(tick, /foreach \(var session in _pool\.Sessions\(\)\)/, 'collection is limited to already owned sessions');
assert.match(tick, /session\.IsCollectorReady/, 'a foreground connection alone cannot qualify a background heartbeat');
assert.match(tick, /session\.CollectorState is not/, 'paused and unopened collectors do not run');
assert.match(tick, /RunHeartbeatAsync\(session, true/, 'independently initialized collectors receive their own heartbeat');
assert.doesNotMatch(tick, /RunHeartbeatAsync\(acquired\.Session/,
  'background heartbeat cannot implicitly create an account');
assert.match(runtime, /public async Task<WsWebViewSessionAcquireResult> ShowAccountAsync[\s\S]*?_pool\.GetOrCreateAsync/,
  'explicit manual account selection retains the existing bounded session pool');
assert.match(runtime, /_pool\.ReleaseAllAsync\(cancellationToken\)/, 'normal shutdown still releases all owned sessions');
