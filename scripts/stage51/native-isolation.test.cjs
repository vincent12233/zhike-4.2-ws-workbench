'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..');
for (const file of ['App.xaml.cs','Services/AiBridgeService.cs','Services/DesktopToolsService.cs','Services/LocalQueue.cs','Services/WebViewProfileService.cs','Services/WindowLayoutService.cs','Services/WsAccountStore.cs','Services/WsCollectorDiagnosticLog.cs']) {
  const source = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop', file), 'utf8');
  assert.match(source, /#if STAGE51_ISOLATED_UI[\s\S]*?Stage51Isolation\.MapDataPath/);
}
const project = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Zhike.Desktop.csproj'), 'utf8');
assert.match(project, /Condition="'\$\(Stage51IsolatedUi\)' == 'true'"/);
const host = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs'), 'utf8');
assert.match(host, /CreateWebResourceResponse\(null!, 451/);
assert.match(host, /ws-navigation-blocked/);
assert.match(host, /ConfigureIsolatedCore\(core, "shell"/);
const run = spawnSync(path.join(repo, '.tools/dotnet10/dotnet.exe'), ['run', '--project', path.join(__dirname, 'NativeIsolationProbe/NativeIsolationProbe.csproj'), '-c', 'Release'], { cwd: repo, encoding: 'utf8', timeout: 60000, windowsHide: true });
assert.equal(run.status, 0, run.stdout + run.stderr);
const result = JSON.parse(run.stdout.trim().split(/\r?\n/).at(-1));
assert.equal(result.ok, true); assert.equal(result.productionOpened, false); assert.equal(result.acl, 'current-user-only');
assert.equal(result.unsafeConstructorRejected, true);
console.log('stage5.1 native isolation: compile opt-in, all data roots mapped, unsafe paths rejected, private ACL and external WS/AI blocks PASS');
