using System.Net;
using System.Security.Cryptography;
using System.Text;

namespace Zhike.Api.Auth;

/// <summary>
/// Keeps the one-time pairing endpoints local by default. A deployment that
/// deliberately exposes the API through a private network can opt in to
/// remote pairing, but must configure a separate approval code and send it in
/// the pairing request header. The approval code is never returned or logged.
/// </summary>
public sealed class PairingAccessGuard(IConfiguration configuration)
{
    public PairingAccessDecision Check(HttpContext context)
    {
        var remoteAddress = context.Connection.RemoteIpAddress;
        if (remoteAddress is not null && IPAddress.IsLoopback(remoteAddress))
        {
            return PairingAccessDecision.Allow;
        }

        var allowRemote = configuration.GetValue("ZHike:AllowRemotePairing", false);
        if (!allowRemote)
        {
            return new(false, "pairing-is-local-only");
        }

        var configuredApproval = configuration["ZHike:PairingApprovalCode"]?.Trim();
        if (string.IsNullOrWhiteSpace(configuredApproval))
        {
            return new(false, "remote-pairing-approval-not-configured");
        }

        var suppliedApproval = context.Request.Headers["X-Zhike-Pairing-Approval"].ToString().Trim();
        return FixedEquals(configuredApproval, suppliedApproval)
            ? PairingAccessDecision.Allow
            : new(false, "remote-pairing-approval-required");
    }

    private static bool FixedEquals(string expected, string supplied)
    {
        var left = Encoding.UTF8.GetBytes(expected ?? string.Empty);
        var right = Encoding.UTF8.GetBytes(supplied ?? string.Empty);
        return left.Length > 0
            && left.Length == right.Length
            && CryptographicOperations.FixedTimeEquals(left, right);
    }
}

public readonly record struct PairingAccessDecision(bool Allowed, string? Reason)
{
    public static PairingAccessDecision Allow => new(true, null);
}
