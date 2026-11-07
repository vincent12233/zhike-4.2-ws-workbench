using Zhike.Contracts;

namespace Zhike.Api.Health;

public static class HealthResponseFactory
{
    public static HealthResponse Create(string appVersion, int schemaVersion, string databaseStatus, string workerStatus)
        => new(appVersion, schemaVersion, databaseStatus, workerStatus);
}
