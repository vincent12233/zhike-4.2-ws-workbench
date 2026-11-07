using Npgsql;

namespace Zhike.Infrastructure.Database;

public sealed class PostgresConnectionFactory(string connectionString)
{
    public NpgsqlConnection Create() => new(connectionString);
}
