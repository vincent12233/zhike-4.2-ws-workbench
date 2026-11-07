using System.Threading;
using Microsoft.Extensions.Configuration;

namespace Zhike.Api.Auth;

/// <summary>
/// Zhike is a personal, single-workspace desktop product. Bind the API
/// process to one paired owner so a token from another workspace cannot use a
/// valid session to enumerate or mutate the local database. A deployment may
/// pin the owner with ZHike:WorkspaceOwnerId; otherwise the first successful
/// pairing binds the process until restart (sessions are also in-memory).
/// </summary>
public sealed class WorkspaceOwnerGuard(IConfiguration configuration)
{
    private readonly string configuredOwner = configuration["ZHike:WorkspaceOwnerId"]?.Trim() ?? string.Empty;
    private string? boundOwner;

    public bool IsAllowed(string? ownerId)
    {
        var candidate = ownerId?.Trim() ?? string.Empty;
        if (candidate.Length == 0) return false;
        if (configuredOwner.Length > 0) return CryptographicEquals(configuredOwner, candidate);
        var current = Volatile.Read(ref boundOwner);
        if (current is null) return Interlocked.CompareExchange(ref boundOwner, candidate, null) is null;
        return CryptographicEquals(current, candidate);
    }

    private static bool CryptographicEquals(string left, string right)
    {
        var a = System.Text.Encoding.UTF8.GetBytes(left);
        var b = System.Text.Encoding.UTF8.GetBytes(right);
        return a.Length == b.Length && System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(a, b);
    }
}
