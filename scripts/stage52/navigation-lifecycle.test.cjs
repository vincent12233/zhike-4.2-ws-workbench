'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..');
// Cross-layer wire contract: the actual visible refresh button dispatches
// "reload"; it must reach the same explicit-boundary path as reconnect.
const frontend = fs.readFileSync(path.join(repo, 'resources/app/modules/ws-workbench.js'), 'utf8');
const native = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs'), 'utf8');
const refreshButton = frontend.match(/data-ws-action="([^"]+)"[^>]*>刷新页面<\/button>/);
assert.ok(refreshButton, 'Visible refresh command missing');
const branch = native.match(/case "reload":\s*case "reconnect":\s*await OpenWsOverlayAsync\(id, payload, reload: true, cancellationToken: cancellationToken\);/);
assert.ok(branch && refreshButton[1] === 'reload', 'Visible refresh command cannot reach the bounded explicit reload path');
const result = spawnSync(path.join(repo, '.tools/dotnet10/dotnet.exe'), ['run', '--project', path.join(__dirname, 'NavigationLifecycleProbe/NavigationLifecycleProbe.csproj'), '-c', 'Release'], { cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 120000 });
assert.ifError(result.error); assert.equal(result.status, 0, result.stdout + result.stderr);
const value = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
assert.equal(value.ok, true); assert.equal(value.legacyWrapperRetries, 1000); assert.equal(value.stableSurfaceRetries, 1);
for (const key of ['policyCancellationNeverRetries', 'explicitRefreshAndReconnect', 'cancelledAndDuplicateCompletions', 'staleRecoveryRejected', 'accountAndSurfaceIsolation']) assert.equal(value[key], true, key);
console.log(JSON.stringify(value));
