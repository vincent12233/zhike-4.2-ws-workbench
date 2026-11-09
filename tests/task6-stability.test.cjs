'use strict';

// Task 6 contract tests are intentionally source-level for the desktop/runtime
// boundary: Electron and WebView2 cannot be booted safely inside the isolated
// Node test runner, but each assertion protects a concrete release invariant.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const main = read('resources/app/main.cjs');
const app = read('resources/app/app.js');
const ws = read('resources/app/modules/ws-workbench.js');
const compose = read('infra/compose.yaml');
const prodCompose = read('infra/compose.prod.yaml');
const installer = read('scripts/build-installer.ps1');
const winuiInstaller = read('scripts/build-winui-installer.ps1');
const setup = read('zhike-setup.iss');
const winuiSetup = read('zhike-desktop-setup.iss');
const migrationRunner = read('server/src/Zhike.Infrastructure/Database/MigrationRunner.cs');

assert.match(main, /flushRendererBeforeQuit/, 'Electron quit must expose a bounded renderer flush helper');
assert.match(main, /Promise\.race\([\s\S]{0,700}(?:flush|executeJavaScript)[\s\S]{0,700}(?:setTimeout|timeout)/, 'renderer close flush must have a grace-period timeout');
assert.match(main, /async function completeQuitSequence[\s\S]{0,1600}flushRendererBeforeQuit[\s\S]{0,1200}resetWsStatusesBeforeQuit[\s\S]{0,600}stopOwnedService/, 'shutdown must flush renderer writes before resetting WS state and stopping the service');
assert.match(main, /before-quit[\s\S]{0,500}completeQuitSequence/, 'before-quit must enter the guarded shutdown sequence');
assert.doesNotMatch(main, /before-quit[\s\S]{0,500}quitting\s*=\s*true[\s\S]{0,500}resetWsStatusesBeforeQuit/, 'quit guard must not bypass the renderer flush');

assert.match(app, /syncPollDelay/, 'shared state polling must track adaptive delay');
assert.match(app, /scheduleDataSync/, 'shared state polling must use one scheduled timer');
assert.match(app, /document\.hidden[\s\S]{0,180}syncPollDelay/, 'hidden windows must pause or back off polling');
assert.match(app, /syncReadFailure/, 'read failures must stay separate from local write failures');
assert.doesNotMatch(app, /dataSyncStarted[\s\S]{0,600}setInterval\(/, 'shared state sync must not create a perpetual duplicate interval');
assert.match(app, /const\s+syncResult\s*=\s*await\s+syncFromBackend\(true\)[\s\S]{0,220}(?:syncResult\s*!==\s*true|syncResult\s*===\s*false)[\s\S]{0,220}本机数据同步已恢复/, 'manual sync retry must not report success when the shared read still fails');

assert.match(app, /capacityWarning|容量告警|数据量较大/, 'large datasets must disclose capacity pressure');
assert.match(app, /yieldToUi[\s\S]{0,2000}(?:500|1000|batch|批)/, 'large imports must yield between bounded batches');
assert.match(app, /filteredRecordCount[\s\S]{0,600}(?:导出可取全部|还有|更多)/, 'bounded tables must disclose records beyond the render window');

assert.match(main, /classifyWsError/, 'WS bridge errors must be classified before they reach the UI');
for (const category of ['unpaired', 'network', 'session-expired', 'structure-changed', 'service']) {
  assert.match(main, new RegExp(category), `WS bridge must expose ${category} error category`);
}
assert.match(main, /wsViews\.get\(accountId\)[\s\S]{0,900}(?:runtime|status)[\s\S]{0,900}wsAccounts\.set/, 'WS account runtime status must overlay persisted state per account');
assert.match(ws, /errorCategory|错误分类|未配对|页面结构/, 'WS renderer must show actionable bridge error categories');

assert.match(compose, /ZHike__SchemaVersion:\s*\$\{ZHike_SCHEMA_VERSION:-13\}/, 'Docker defaults must target the latest migration');
assert.match(compose, /healthcheck:[\s\S]{0,500}(?:pg_isready|migration|schema)/, 'Docker services must expose startup health diagnostics');
assert.match(compose, /mem_limit|deploy:[\s\S]{0,300}memory:/, 'Docker compose must declare memory capacity limits');
assert.match(compose, /disk|Disk|磁盘|storage/, 'Docker compose must expose disk/storage diagnostics or guardrails');
assert.match(prodCompose, /mem_limit|memory:/, 'production compose must retain resource limits');
assert.match(migrationRunner, /pg_advisory_lock/, 'migration runner must retain a cross-instance lock');
assert.match(migrationRunner, /diagnostic|timeout|lock/i, 'migration runner must report lock/startup diagnostics');

for (const source of [installer, winuiInstaller]) {
  assert.match(source, /WebView2|webview2/i, 'installer staging must check WebView2 runtime prerequisites');
  assert.match(source, /rollback|upgrade|backup/i, 'installer must document upgrade/rollback guardrails');
  assert.match(source, /sign|signature|unsigned/i, 'installer must expose a signing gate/placeholder');
}
assert.match(winuiSetup, /WebView2|HasWebView2Runtime/i, 'WinUI installer must keep WebView2 runtime check');

console.log('task6 stability contract: bounded quit flush, adaptive sync, capacity diagnostics, WS error taxonomy, Docker startup checks and installer gates are present');
