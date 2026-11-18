using Zhike.Desktop.Services;

static void Check(bool value, string message)
{
    if (!value) throw new InvalidOperationException(message);
}

var start = new DateTimeOffset(2026, 11, 14, 0, 0, 0, TimeSpan.Zero);
var runtime = new WsRuntimeCoordinator(
    WsCollectionPolicy.PersonalWhatsAppDefault,
    leaseDuration: TimeSpan.FromSeconds(30),
    minimumRetryDelay: TimeSpan.FromSeconds(5),
    maximumRetryDelay: TimeSpan.FromSeconds(20));

runtime.RegisterAccount("a", "前台账号", WsAccountRuntimeState.Connected);
runtime.RegisterAccount("b", "后台账号 B", WsAccountRuntimeState.Connected);
runtime.RegisterAccount("c", "后台账号 C", WsAccountRuntimeState.Connected);
runtime.SetForegroundAccount("a");

Check(runtime.LeaseNextBackgroundAccount(start) == "b", "first fair lease should select B and never the foreground account");
var first = runtime.Snapshot();
Check(first.ForegroundAccountId == "a" && first.BackgroundAccountId == "b", "foreground and background ownership must remain separate");
Check(first.Accounts.Single(item => item.AccountId == "a").IsBackgroundLease == false, "foreground account cannot receive a background lease");

runtime.ReleaseBackgroundLease("b", succeeded: true, observedAt: start.AddSeconds(1));
Check(runtime.LeaseNextBackgroundAccount(start.AddSeconds(2)) == "c", "fair rotation should select the account without a prior lease");
runtime.SetForegroundAccount("c");
Check(runtime.Snapshot().BackgroundAccountId is null, "promoting a leased account to foreground must release its hidden lease");

runtime.SetForegroundAccount("a");
runtime.SetAccountEnabled("c", false);
Check(runtime.LeaseNextBackgroundAccount(start.AddSeconds(3)) == "b", "enabled non-foreground account should resume background work");
var firstRetry = runtime.RecordFailure("b", "temporary failure", start.AddSeconds(4));
Check(firstRetry == start.AddSeconds(9), "first retry must use the minimum account-scoped delay");
Check(runtime.LeaseNextBackgroundAccount(start.AddSeconds(8)) is null, "account cannot be leased before its retry deadline");
Check(runtime.LeaseNextBackgroundAccount(start.AddSeconds(9)) == "b", "account should become eligible exactly at its retry deadline");
var secondRetry = runtime.RecordFailure("b", "second failure", start.AddSeconds(10));
Check(secondRetry == start.AddSeconds(20), "second consecutive failure must use exponential backoff");

var policy = runtime.Policy;
Check(policy.SkipUnread && policy.SkipUncertainUnread, "unread and uncertain unread conversations must be protected");
Check(policy.CaptureVipGroups && policy.ExcludeUnlistedGroups && policy.RequireTrustedGroupSenderIdentity,
    "only explicitly bound VIP groups may be collected and member attribution must require trusted identity");
Check(policy.ExcludeUnknownConversationTypes, "unknown conversation types must be excluded");
Check(policy.CaptureIncoming && policy.CaptureOutgoing, "both sides of direct and eligible VIP-group chats must be collected");
Check(policy.RequireVerifiedDirection && policy.RequireHistoryTopEvidence, "AI-ready history must require verified direction and top evidence");

var restored = new WsRuntimeCoordinator(WsCollectionPolicy.PersonalWhatsAppDefault);
restored.RegisterAccount("restored", "重启恢复账号", WsAccountRuntimeState.Registered);
Check(restored.LeaseNextBackgroundAccount(start) == "restored",
    "a restored registered account must receive one background probe so a persisted login can resume after restart");

var staleWaitingLogin = new WsRuntimeCoordinator(WsCollectionPolicy.PersonalWhatsAppDefault);
staleWaitingLogin.RegisterAccount("stale", "状态可能过期的账号", WsAccountRuntimeState.WaitingLogin);
Check(staleWaitingLogin.LeaseNextBackgroundAccount(start) == "stale",
    "an account still marked WaitingLogin must be re-probed so a completed QR login is detected without opening it");

Console.WriteLine("WS runtime coordinator scheduling: foreground isolation, fair rotation, per-account backoff and collection policy pass");
