const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const coordinator = fs.readFileSync(path.join(root, 'desktop/src/Zhike.Desktop/Services/WsRuntimeCoordinator.cs'), 'utf8');
const host = fs.readFileSync(path.join(root, 'desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs'), 'utf8');
const workbench = fs.readFileSync(path.join(root, 'resources/app/modules/ws-workbench.js'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'desktop/src/Zhike.Desktop/Services/WsRuntimeService.cs'), 'utf8');

if (!/account\.State\s+is\s+[\s\S]{0,180}WsAccountRuntimeState\.WaitingLogin/.test(coordinator)) {
  throw new Error('the coordinator must preserve WaitingLogin account state for explicit account selection');
}
if (!/if \(publishStatus && isCurrent\)[\s\S]{0,180}SetWsStatusAsync\(accountId,\s*status/.test(host)) {
  throw new Error('manual foreground account probes must still persist the detected status');
}
if (!/const payloadAccountId\s*=\s*text\(payload\.accountId\)[\s\S]{0,350}updateAccountStatus\(payload\)[\s\S]{0,700}payloadAccountId\s*&&\s*payload\.status/.test(workbench)) {
  throw new Error('account status events must update the account rail even when the account is not active');
}
const tick = runtime.slice(runtime.indexOf('    public async Task TickAsync('), runtime.indexOf('    public async Task ShutdownAsync('));
if (!tick.includes('RunHeartbeatAsync(foreground, false') || /LeaseNextBackgroundAccount\(|GetOrCreateAsync\(/.test(tick)) {
  throw new Error('RD02 allows foreground status probing but forbids automatic background account creation/rotation');
}
if (!/rememberCollectionCapability\(payload, id\)/.test(workbench) || !/collectionCapability = WsCollectionCapability\.Current/.test(host)) {
  throw new Error('account-scoped native status must disclose collection capability separately from login status');
}
console.log('ws-multi-account-detection: manual account status, per-account rail/capability and blocked automatic rotation pass');
