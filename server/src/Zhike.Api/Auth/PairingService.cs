using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Configuration;

namespace Zhike.Api.Auth;

public sealed record PairingStartResult(string Code, DateTimeOffset ExpiresAt);
public sealed record PairingCompleteResult(bool Succeeded, string? DeviceId, string? SessionSeed, string? Reason);

public sealed class PairingService(IConfiguration configuration)
{
    private readonly ConcurrentDictionary<string, PendingPairing> pending = new(StringComparer.Ordinal);
    private readonly TimeSpan lifetime = TimeSpan.FromSeconds(Math.Clamp(configuration.GetValue("ZHike:PairingLifetimeSeconds", 120), 30, 600));

    public PairingStartResult Start(string deviceId)
    {
        if (string.IsNullOrWhiteSpace(deviceId)) throw new ArgumentException("deviceId is required", nameof(deviceId));
        var code = Convert.ToBase64String(RandomNumberGenerator.GetBytes(18)).Replace("+", "-").Replace("/", "_").TrimEnd('=');
        var expiresAt = DateTimeOffset.UtcNow.Add(lifetime);
        pending[Hash(code)] = new PendingPairing(deviceId.Trim(), expiresAt);
        return new PairingStartResult(code, expiresAt);
    }

    public PairingCompleteResult Complete(string code, string deviceProof)
    {
        if (!pending.TryRemove(Hash(code), out var item)) return new(false, null, null, "not-found");
        if (item.ExpiresAt <= DateTimeOffset.UtcNow) return new(false, null, null, "expired");
        if (string.IsNullOrWhiteSpace(deviceProof)) return new(false, null, null, "missing-device-proof");
        var expected = ComputeProof(code, item.DeviceId);
        if (!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(deviceProof.Trim()))) return new(false, null, null, "invalid-device-proof");
        return new(true, item.DeviceId, Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)), null);
    }

    public static string ComputeProof(string code, string deviceId)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(deviceId.Trim()));
        return Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(code.Trim())))
            .Replace("+", "-").Replace("/", "_").TrimEnd('=');
    }

    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value ?? string.Empty))).ToLowerInvariant();
    private sealed record PendingPairing(string DeviceId, DateTimeOffset ExpiresAt);
}
