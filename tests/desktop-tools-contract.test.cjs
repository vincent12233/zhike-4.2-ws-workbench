'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const service = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Services/DesktopToolsService.cs'), 'utf8');
const retention = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Services/BackupRetention.cs'), 'utf8');
const envelope = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Services/NativeBackupEnvelope.cs'), 'utf8');
const host = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs'), 'utf8');
const accountStore = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Services/WsAccountStore.cs'), 'utf8');
const productivity = fs.readFileSync(path.join(repo, 'resources/app/modules/productivity.js'), 'utf8');
const app = fs.readFileSync(path.join(repo, 'resources/app/app.js'), 'utf8');
const ws = fs.readFileSync(path.join(repo, 'resources/app/modules/ws-workbench.js'), 'utf8');
const setup = fs.readFileSync(path.join(repo, 'zhike-desktop-setup.iss'), 'utf8');

// Native reminder and backup bridge actions must be real implementations,
// not UI-only switches that report success or UNSUPPORTED.
assert.match(host, /HandleToolsAsync[\s\S]*GetStatusAsync/);
assert.match(host, /HandleToolsAsync[\s\S]*SelectDirectoryAsync/);
assert.match(host, /HandleToolsAsync[\s\S]*ConfigureAsync/);
assert.match(host, /HandleToolsAsync[\s\S]*CreateBackupAsync/);
assert.match(host, /HandleToolsAsync[\s\S]*_desktopTools\.Notify/);
assert.doesNotMatch(host, /action, "notify"[\s\S]{0,260}supported = false/);
assert.doesNotMatch(host, /action, "directory"[\s\S]{0,420}"UNSUPPORTED"/);

// The native timer owns reminders and automatic backups so route changes and
// a minimized WebView do not pause either function.
assert.match(host, /DispatcherQueueTimer\? _desktopBackupTimer/);
assert.match(host, /TryRunScheduledBackupAsync/);
assert.match(host, /PollDueRemindersAsync/);
// The browser fallback is only allowed when there is no native desktop host
// and the page is visible. Hidden pages must not keep a second reminder poller
// alive while the native host owns the durable timer.
assert.match(productivity, /if\(desktop\|\|document\.hidden\)return;reminderTimer=setInterval/);

// Backup safety: state and every WS account are included, the file is first
// written to a temporary sibling, and retention only touches the exact prefix
// in the selected top-level directory.
assert.match(service, /SendJsonAsync\("api\/state"/);
assert.match(service, /api\/ws\/export\?accountId=/);
assert.match(service, /state\["wsAccounts"\] = wsAccounts/);
assert.match(service, /state\["wsAccountMetadata"\] = wsAccountMetadata/);
assert.match(service, /\["workspaceMode"\] = account\.WorkspaceMode/, "Automatic backups include account purpose metadata");
assert.match(service, /WS 会话导出失败，未生成不完整备份/);
assert.doesNotMatch(service, /if \(!response\.Ok \|\| response\.Data is null\) continue/, 'account export failures must not write a partial backup');
assert.match(service, /NativeBackupEnvelope\.ValidateWorkspace\(state\)/);
assert.match(service, /NativeBackupEnvelope\.ValidateWsAccount\(node\)/);
assert.match(service, /NativeBackupEnvelope\.ValidateAccountIds\(accounts\.Select/);
assert.doesNotMatch(service, /GetWsAccountsAsync\(cancellationToken\) \?\? \[\]/);
assert.match(service, /NativeBackupEnvelope\.Create\(state, _json\)/);
assert.match(service, /state\["backupFormat"\] = "zhike-6-workspace"/);
assert.match(envelope, /MaxWorkspaceBytes = 95 \* 1024 \* 1024/);
assert.match(envelope, /MaxWsAccountBytes = 48 \* 1024 \* 1024/);
assert.match(envelope, /"zhike-6-native-workspace"/);
assert.match(app, /decodeWorkspaceBackupFile\(await file\.text\(\)\)/);
assert.match(app, /Object\.entries\(backup\.wsAccounts\)/);
assert.match(app, /wsAccountMetadata/);
assert.match(app, /fetch\('\/api\/workspace\/restore'/);
assert.match(app, /await window\.zhikeDesktop\.wsAccounts\(\{action:'list'\}\)/);
assert.doesNotMatch(app, /rollbackCreatedWsAccounts/, 'database rollback owns account creation, so restore never forgets native accounts');
assert.doesNotMatch(app.slice(app.indexOf('  async function restoreBackupFile(file){'), app.indexOf('  function saveIntake(){')), /activity\(`从备份恢复/, 'restore must not enqueue a competing state write before its versioned PUT');
const forgetStart = host.indexOf('if (action == "forget")');
const forgetEnd = host.indexOf('if (action != "create")', forgetStart);
assert.ok(forgetStart >= 0 && forgetEnd > forgetStart);
const forget = host.slice(forgetStart, forgetEnd);
assert.match(forget, /await ReleaseForgottenWsAccountAsync\(forgottenId, cancellationToken\);[\s\S]*await _wsAccountStore\.UpdateAsync\(rows => rows\.Where\(item => !item\.Id\.Equals\(forgottenId, StringComparison\.OrdinalIgnoreCase\)\), cancellationToken\);[\s\S]*App\.WsRuntime\.RemoveAccount\(forgottenId\);/,
  'Restore rollback closes only the requested account, then removes its index entry and runtime registration');
assert.doesNotMatch(forget, /File\.Delete|Directory\.Delete|ClearProfile|DeleteProfile/,
  'Restore rollback must retain the account profile');
const updateStart = accountStore.indexOf('Task<IReadOnlyList<StoredWsAccount>> UpdateAsync(');
const updateEnd = accountStore.indexOf('private async Task<IReadOnlyList<StoredWsAccount>> ReadAsync(', updateStart);
assert.ok(updateStart >= 0 && updateEnd > updateStart);
assert.match(accountStore.slice(updateStart, updateEnd), /await _gate\.WaitAsync\(cancellationToken\);[\s\S]*await ReadAsync\(cancellationToken\)[\s\S]*Normalize\(change\(current\)\)[\s\S]*await WriteAsync\(updated, cancellationToken\)[\s\S]*finally \{ _gate\.Release\(\); \}/,
  'Index rollback changes the latest account set while the store gate is held');
assert.match(ws, /ensureWsBackupAccount\(accountId, displayName, workspaceMode\)/);
assert.match(ws, /deleteWsBackupAccount\(accountId\)/);
assert.match(ws, /exportWsData\(accountId = ''\)/);
assert.match(ws, /importWsData\(value, accountId = ''\)/);
assert.match(service, /File\.WriteAllBytesAsync\(temporaryPath/);
assert.match(service, /File\.Move\(temporaryPath, finalPath, overwrite: false\)/);
assert.match(service, /BackupRetention\.Retain\(directory, config\.Keep\)/);
assert.match(retention, /SearchOption\.TopDirectoryOnly/);
assert.match(retention, /ManagedName\.IsMatch\(Path\.GetFileName\(path\)\)/);
assert.match(retention, /\[0-9\]\{8\}_\[0-9\]\{9\}\\\.json/);
assert.match(retention, /CultureInfo\.InvariantCulture/);
assert.match(service, /Math\.Clamp\(keep, 3, 100\)/);
assert.match(service, /Math\.Clamp\(minutes, 15, 1440\)/);
assert.doesNotMatch(retention, /Directory\.Delete\([^\n]*recursive\s*:\s*true/);

// Notifications use the supported Windows App SDK path for an unpackaged
// WinUI app and redact both compact and visually formatted phone numbers from
// the system notification body (for example +91 94489 50442).
assert.match(service, /AppNotificationManager\.Default/);
assert.match(service, /manager\.Register\(\)/);
assert.match(service, /manager\.Show\(builder\.BuildNotification\(\)\)/);
assert.match(service, /RedactNotificationBody\(body\)/);
assert.match(service, /match\.Value\.Count\(char\.IsDigit\) >= 7/);
assert.match(service, /@"\\d\{7,\}"/);
assert.match(service, /CustomerNotificationInvoked/);

// The original eight productivity functions remain present after moving the
// two OS-dependent actions into the native host.
for (const evidence of [
  /intakeBatches/,
  /duplicateCustomers/,
  /zhike-home-hidden/,
  /拖动调整客户阶段/,
  /customer-context-menu/,
  /desktopReminders/,
  /backupEnabled/,
]) assert.match(productivity, evidence);

// Cover upgrades remove only known obsolete application files. User data is
// outside {app} and must never appear in InstallDelete.
assert.match(setup, /phone-registry-seed\.json/);
assert.match(setup, /operations-core\.test\.cjs/);
const installDelete = setup.match(/^\[InstallDelete\][ \t]*\r?\n([\s\S]*?)(?=^\[|(?![\s\S]))/m)?.[1];
assert.ok(installDelete, 'the installer payload cleanup section must remain present');
assert.doesNotMatch(installDelete, /\{localappdata\}\\Zhike/i);

console.log('desktop productivity tools contract: native reminders, atomic backups, retention safety and obsolete-file cleanup passed');
