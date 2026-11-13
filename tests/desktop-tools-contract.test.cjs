'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const service = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Services/DesktopToolsService.cs'), 'utf8');
const host = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs'), 'utf8');
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
assert.match(productivity, /if\(desktop\)return;reminderTimer=setInterval/);

// Backup safety: state and every WS account are included, the file is first
// written to a temporary sibling, and retention only touches the exact prefix
// in the selected top-level directory.
assert.match(service, /SendJsonAsync\("api\/state"/);
assert.match(service, /api\/ws\/export\?accountId=/);
assert.match(service, /state\["wsAccounts"\] = wsAccounts/);
assert.match(service, /state\["wsAccountMetadata"\] = wsAccountMetadata/);
assert.match(app, /Object\.entries\(backup\.wsAccounts\)/);
assert.match(app, /wsAccountMetadata/);
assert.match(app, /window\.zhikeDesktop\.wsAccounts\(\{action:'create'/);
assert.match(ws, /exportWsData\(accountId = ''\)/);
assert.match(ws, /importWsData\(value, accountId = ''\)/);
assert.match(service, /File\.WriteAllBytesAsync\(temporaryPath/);
assert.match(service, /File\.Move\(temporaryPath, finalPath, overwrite: false\)/);
assert.match(service, /SearchOption\.TopDirectoryOnly/);
assert.match(service, /Path\.GetFileName\(path\)\.StartsWith\(BackupPrefix/);
assert.match(service, /Math\.Clamp\(keep, 3, 100\)/);
assert.match(service, /Math\.Clamp\(minutes, 15, 1440\)/);
assert.doesNotMatch(service, /Directory\.Delete\([^\n]*recursive\s*:\s*true/);

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
assert.doesNotMatch(setup, /\[InstallDelete\][\s\S]*\{localappdata\}\\Zhike/);

console.log('desktop productivity tools contract: native reminders, atomic backups, retention safety and obsolete-file cleanup passed');
