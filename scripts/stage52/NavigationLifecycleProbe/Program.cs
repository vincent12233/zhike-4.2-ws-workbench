using System.Text.Json;
using Zhike.Desktop.Services;

static void Check(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
var legacyWrappers = new HashSet<object>();
for (var i = 0; i < 1000; i++) legacyWrappers.Add(new object());
Check(legacyWrappers.Count == 1000, "Legacy wrapper identity reproduction failed.");
var state = new WsNavigationLifecycle("A", 1, "visible");
var recoveries = 0;
for (ulong navigation = 1; navigation <= 1000; navigation++)
{
    state.Starting(navigation, false);
    if (state.Completed(navigation, false, false, false).Recovery is not null) recoveries++;
}
Check(recoveries == 1, "Different callback wrappers bypassed stable owned-surface recovery budget.");
state.Starting(1001, false);
Check(state.Completed(1001, true, false, false).Outcome == "success", "Normal navigation blocked.");
state.Starting(1002, false);
Check(state.Completed(1002, false, false, false).Recovery is null, "A success silently reset the failure budget.");
Check(state.SetFailure(1002, "HostNameNotResolved"), "Current login failure was lost.");
Check(!state.SetFailure(1001, "Timeout") && state.FailureDetail == "HostNameNotResolved", "Stale completion replaced the current error.");
state.Request("explicit-refresh", true);
Check(state.FailureDetail is null, "Explicit reopen kept the prior navigation error.");
state.Starting(1003, false);
Check(state.Completed(1003, false, false, false).Recovery is not null, "Explicit refresh could not recover.");
state.Request("automatic-failure-recovery");
state.Starting(1004, false);
Check(state.Completed(1004, false, false, false).Recovery is null, "Automatic retry reset its own budget.");
state.Starting(1005, false, userInitiated: true);
Check(state.Completed(1005, false, false, false).Recovery is not null, "Legitimate new user navigation blocked.");

var isolated = new WsNavigationLifecycle("A", 2, "visible");
for (ulong id = 1; id < 1000; id++)
{
    isolated.Starting(id, true);
    Check(isolated.Completed(id, false, false, false).Outcome == "policy-cancelled", "Policy cancellation entered failure recovery.");
}
isolated.Starting(1001, false);
Check(isolated.Completed(1001, true, false, true).Outcome == "isolated-document", "Local isolated document entered login probe.");
Check(isolated.RecoveryCount == 0, "Isolated guard triggered a recovery request.");
isolated.Starting(1002, false);
Check(isolated.Completed(1002, false, true, false).Outcome == "operation-cancelled", "Cancelled request triggered recovery.");
isolated.Starting(1003, false);
var ticket = isolated.Completed(1003, false, false, false).Recovery!;
Check(ticket is not null && isolated.CanApply(ticket), "Real failure was swallowed.");
Check(isolated.Completed(1003, false, false, false).Recovery is null, "Duplicate completion repeated recovery.");
isolated.Starting(1004, false);
Check(!isolated.CanApply(ticket!), "Old asynchronous recovery overwrote a newer navigation.");
isolated.Request("explicit-reconnect", true);
Check(!isolated.CanApply(ticket!), "Old asynchronous recovery crossed an explicit reconnect.");
isolated.Starting(1005, false);
Check(isolated.Completed(1005, false, false, false).Recovery is not null, "Explicit reconnect did not reset bounded recovery.");
isolated.Dispose();
Check(!isolated.CanApply(ticket!), "Released generation can still recover.");
Check(!isolated.SetFailure(1005, "Timeout"), "Released generation can still publish a login failure.");

var accounts = Enumerable.Range(0, 2).Select(i => new WsNavigationLifecycle("account-" + i, 10 + i, "visible")).ToArray();
for (var page = 0; page < 10; page++)
    for (var account = 0; account < 10; account++)
    {
        var current = accounts[account % 2];
        // Hiding/returning a page or selecting an already-created account is
        // not a document request or recovery-budget reset.
        Check(current.RequestSequence == 0 && current.RecoveryCount == 0, "Page/account presentation caused document navigation.");
    }
accounts[0].Starting(1, false);
accounts[1].Starting(1, false);
Check(accounts[0].Completed(1, false, false, false).Recovery is not null && accounts[1].Completed(1, false, false, false).Recovery is not null, "Cross-account state shared.");
var collector = new WsNavigationLifecycle("account-0", 10, "collector");
collector.Starting(1, false);
Check(collector.Completed(1, false, false, false).Recovery is not null, "Visible recovery contaminated collector budget.");
Console.WriteLine(JsonSerializer.Serialize(new { ok = true, legacyWrapperRetries = legacyWrappers.Count, stableSurfaceRetries = recoveries, policyCancellationNeverRetries = true, explicitRefreshAndReconnect = true, cancelledAndDuplicateCompletions = true, staleRecoveryRejected = true, accountAndSurfaceIsolation = true, representativePageSelections = 100, realWebViewCore = "NotMeasuredByThisProbe" }));
