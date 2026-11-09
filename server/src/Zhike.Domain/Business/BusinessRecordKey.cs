namespace Zhike.Domain.Business;

public static class BusinessRecordKey
{
    // Compatibility adapter: the legacy key remains the source of truth. The
    // follow-up date and source are metadata, not a reason to merge two trades.
    public static string Create(string customerId, string productCode, string direction, string registeredAt, string followupAt, string source)
        => Ticket(customerId, registeredAt, productCode, direction);

    public static string Ticket(string owner, string date, string product, string direction, string note = "", string tradeRef = "")
        => string.Join('|', Clean(owner), Clean(date), Clean(product).ToLowerInvariant(), Clean(direction).ToLowerInvariant(), Clean(note).ToLowerInvariant(), Clean(tradeRef).ToLowerInvariant());

    public static string Deposit(string owner, string businessDate, string amount, string currency, string note = "")
        => string.Join("|deposit|", Clean(owner), Clean(businessDate), Clean(amount), Clean(currency).ToLowerInvariant(), Clean(note).ToLowerInvariant());

    private static string Clean(string value) => (value ?? string.Empty).Trim();
}
