using System.Security.Cryptography;
using System.Text;

namespace Zhike.Domain.Messaging;

public sealed record MessageFingerprintInput(
    string AccountId,
    string ConversationKey,
    string ExternalMessageId,
    string Body,
    DateTimeOffset SentAt,
    string Direction);

public static class MessageFingerprint
{
    public static string Create(MessageFingerprintInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        var canonical = string.Join("\u001f", new[]
        {
            input.AccountId.Trim(),
            input.ConversationKey.Trim(),
            input.ExternalMessageId.Trim(),
            input.Body.Trim(),
            input.SentAt.ToUniversalTime().ToString("O"),
            input.Direction.Equals("outgoing", StringComparison.OrdinalIgnoreCase) ? "outgoing" : "incoming",
        });
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical))).ToLowerInvariant();
    }
}
