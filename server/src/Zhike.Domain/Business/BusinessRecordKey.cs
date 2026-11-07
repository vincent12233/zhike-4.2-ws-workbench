namespace Zhike.Domain.Business;

public static class BusinessRecordKey
{
    public static string Ticket(string owner, string date, string product, string direction, string note = "")
        => string.Join('|', Clean(owner), Clean(date), Clean(product).ToLowerInvariant(), Clean(direction).ToLowerInvariant(), Clean(note).ToLowerInvariant());

    public static string Deposit(string owner, string businessDate, string amount, string currency, string note = "")
        => string.Join("|deposit|", Clean(owner), Clean(businessDate), Clean(amount), Clean(currency).ToLowerInvariant(), Clean(note).ToLowerInvariant());

    private static string Clean(string value) => (value ?? string.Empty).Trim();
}
