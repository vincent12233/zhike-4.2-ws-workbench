namespace Zhike.Domain.Business;

public sealed record ImportClassification(
    string RecordType,
    string Phone,
    string Source,
    string Status,
    string RegisteredDate,
    string NextFollowupDate,
    string BusinessDate,
    string Product,
    string Direction);
