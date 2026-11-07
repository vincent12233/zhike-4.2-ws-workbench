namespace Zhike.Domain.Jobs;

public enum JobState
{
    Pending,
    Running,
    Succeeded,
    Retrying,
    Dead,
}

public sealed record JobClaim(
    string Id,
    string JobType,
    string DedupeKey,
    string PayloadJson,
    int Attempts,
    DateTimeOffset LockedAt);
