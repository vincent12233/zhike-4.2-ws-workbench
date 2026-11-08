using System.Net;
using System.Security.Cryptography;
using System.Text;

namespace Zhike.Api.Auth;

/// <summary>
/// Keeps the one-time pairing endpoints local by default. A deployment that
/// deliberately exposes the API through a private network can opt in to
/// remote pairing, but must configure an approval code and send it in the
/// pairing request header. Docker Desktop's bridge compatibility path uses the
/// same proof because bridge source addresses are not host-authenticating. The
/// approval code is never returned or logged.
/// </summary>
public sealed class PairingAccessGuard(IConfiguration configuration)
{
    public PairingAccessDecision Check(HttpContext context)
    {
        var remoteAddress = context.Connection.RemoteIpAddress;
        var configuredApproval = configuration["ZHike:PairingApprovalCode"]?.Trim();
        var suppliedApproval = context.Request.Headers["X-Zhike-Pairing-Approval"].ToString().Trim();
        // A host-local reverse proxy also appears as 127.0.0.1 unless it
        // forwards the original client address. Do not let a proxied request
        // inherit the direct-loopback bypass; it must use the approval-code
        // path below. Direct desktop requests do not carry forwarding headers.
        var hasForwardedIdentity = context.Request.Headers.ContainsKey("Forwarded")
            || context.Request.Headers.ContainsKey("X-Forwarded-For")
            || context.Request.Headers.ContainsKey("X-Real-IP");
        if (remoteAddress is not null && IPAddress.IsLoopback(remoteAddress) && !hasForwardedIdentity)
        {
            return PairingAccessDecision.Allow;
        }

        // Docker Desktop forwards a host loopback request through the dedicated
        // ingress bridge, so ASP.NET sees the bridge gateway instead of
        // 127.0.0.1. Host is client-controlled, therefore it is not enough to
        // check Host: localhost: only the explicitly configured ingress CIDR
        // may use this compatibility path. Containers on zhike_internal and
        // LAN clients still need the approval-code path below.
        var allowDockerLoopback = configuration.GetValue("ZHike:AllowDockerLoopbackPairing", false);
        var dockerSourceCidr = configuration["ZHike:DockerLoopbackPairingSourceCidr"];
        if (!hasForwardedIdentity
            && allowDockerLoopback
            && IsLoopbackHost(context.Request.Host.Host)
            && IsInCidr(remoteAddress, dockerSourceCidr)
            && FixedEquals(configuredApproval ?? string.Empty, suppliedApproval))
        {
            return PairingAccessDecision.Allow;
        }

        var allowRemote = configuration.GetValue("ZHike:AllowRemotePairing", false);
        if (!allowRemote)
        {
            return new(false, "pairing-is-local-only");
        }

        if (string.IsNullOrWhiteSpace(configuredApproval))
        {
            return new(false, "remote-pairing-approval-not-configured");
        }

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

    private static bool IsLoopbackHost(string? host)
    {
        if (string.IsNullOrWhiteSpace(host)) return false;
        if (string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase)) return true;
        return IPAddress.TryParse(host, out var address) && IPAddress.IsLoopback(address);
    }

    private static bool IsInCidr(IPAddress? address, string? cidr)
    {
        if (address is null || string.IsNullOrWhiteSpace(cidr)) return false;
        var parts = cidr.Trim().Split('/', 2, StringSplitOptions.TrimEntries);
        if (parts.Length != 2 || !IPAddress.TryParse(parts[0], out var network) || !int.TryParse(parts[1], out var prefix)) return false;
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        if (network.IsIPv4MappedToIPv6) network = network.MapToIPv4();
        if (address.AddressFamily != network.AddressFamily) return false;
        var addressBytes = address.GetAddressBytes();
        var networkBytes = network.GetAddressBytes();
        var maxPrefix = addressBytes.Length * 8;
        if (prefix < 0 || prefix > maxPrefix) return false;
        var fullBytes = prefix / 8;
        var remainingBits = prefix % 8;
        for (var index = 0; index < fullBytes; index++)
            if (addressBytes[index] != networkBytes[index]) return false;
        if (remainingBits == 0) return true;
        var mask = (byte)(0xFF << (8 - remainingBits));
        return (addressBytes[fullBytes] & mask) == (networkBytes[fullBytes] & mask);
    }
}

public readonly record struct PairingAccessDecision(bool Allowed, string? Reason)
{
    public static PairingAccessDecision Allow => new(true, null);
}
