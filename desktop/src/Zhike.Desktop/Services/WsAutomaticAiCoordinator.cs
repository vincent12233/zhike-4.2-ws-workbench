using System.Text.Json;
using System.Text.Json.Nodes;

namespace Zhike.Desktop.Services;

public static class WsAutomaticAiCoordinator
{
    // The same coordinator is exercised with a disposable sidecar and a stub
    // provider in tests; there is no mock switch in the production adapter.
    public static Task<JsonElement> ExecuteAsync(AiBridgeService provider,
        Func<object, CancellationToken, Task<JsonElement>> ledger, Func<string> activeAccount,
        JsonElement payload, CancellationToken cancellationToken = default, Func<long>? accountEpoch = null)
        => provider.RunWsAutomaticOperationAsync(payload.TryGetProperty("requestId", out var id) ? id.GetString() ?? "" : "",
            token => ExecuteCoreAsync(provider, ledger, activeAccount, payload, token, accountEpoch), cancellationToken);

    private static async Task<JsonElement> ExecuteCoreAsync(AiBridgeService provider,
        Func<object, CancellationToken, Task<JsonElement>> ledger, Func<string> activeAccount,
        JsonElement payload, CancellationToken cancellationToken, Func<long>? accountEpoch)
    {
        static string Text(JsonElement value, string key) => value.TryGetProperty(key, out var item) && item.ValueKind == JsonValueKind.String ? item.GetString() ?? "" : "";
        var accountId = Text(payload, "accountId");
        var epoch = accountEpoch?.Invoke() ?? 0;
        void CheckAccount()
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (string.IsNullOrWhiteSpace(accountId) || !string.Equals(accountId, activeAccount(), StringComparison.Ordinal) || (accountEpoch?.Invoke() ?? 0) != epoch)
                throw new InvalidOperationException("自动 AI 账号已切换，未发送请求。");
        }
        CheckAccount();
        var leaseToken = Text(payload, "leaseToken");
        var permit = await ledger(new { action = "reserve", accountId, conversationId = Text(payload, "conversationId"), jobId = Text(payload, "jobId"), leaseToken }, cancellationToken);
        var attemptId = Text(permit, "attemptId");
        var resultCode = "unknown";
        JsonElement? usage = null;
        try
        {
            // Use only the sidecar's reconstructed input, never renderer input.
            var prepared = JsonNode.Parse(permit.GetRawText())!.AsObject();
            prepared["requestId"] = Text(payload, "requestId");
            CheckAccount();
            await ledger(new { action = "dispatch", accountId, attemptId, leaseToken }, cancellationToken);
            CheckAccount();
            var result = await provider.RequestWsAutomaticAsync(JsonSerializer.SerializeToElement(prepared), cancellationToken, CheckAccount);
            resultCode = "completed";
            if (result.TryGetProperty("usage", out var counters)) usage = counters.Clone();
            return result;
        }
        finally
        {
            using var auditTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            try { await ledger(new { action = "finish", accountId, attemptId, leaseToken, resultCode, usage }, auditTimeout.Token); } catch { }
        }
    }
}
