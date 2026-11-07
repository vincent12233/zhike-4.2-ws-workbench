using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Configuration;

namespace Zhike.Api.Auth;

public sealed record SessionValidation(bool Valid, string? OwnerId, DateTimeOffset? ExpiresAt);
public sealed record SessionRotation(bool Succeeded, string? Token, string? Reason);

public sealed class SessionService(IConfiguration configuration)
{
    private readonly ConcurrentDictionary<string, Session> sessions = new(StringComparer.Ordinal);
    private readonly TimeSpan lifetime = TimeSpan.FromHours(Math.Clamp(configuration.GetValue("ZHike:SessionLifetimeHours", 24), 1, 168));

    public string Issue(string ownerId)
    {
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).Replace("+", "-").Replace("/", "_").TrimEnd('=');
        sessions[Hash(token)] = new Session(ownerId.Trim(), DateTimeOffset.UtcNow.Add(lifetime));
        return token;
    }

    public SessionValidation Validate(string token)
    {
        if (!sessions.TryGetValue(Hash(token), out var session) || session.ExpiresAt <= DateTimeOffset.UtcNow)
        {
            sessions.TryRemove(Hash(token), out _);
            return new(false, null, null);
        }
        return new(true, session.OwnerId, session.ExpiresAt);
    }

    public SessionRotation Rotate(string token)
    {
        var current = Validate(token);
        if (!current.Valid || current.OwnerId is null) return new(false, null, "invalid-session");
        Revoke(token);
        return new(true, Issue(current.OwnerId), null);
    }

    public void Revoke(string token) => sessions.TryRemove(Hash(token), out _);
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value ?? string.Empty))).ToLowerInvariant();
    private sealed record Session(string OwnerId, DateTimeOffset ExpiresAt);
}
