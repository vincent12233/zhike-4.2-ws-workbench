using Npgsql;

namespace Zhike.Infrastructure.Database;

public sealed class DatabaseHealthProbe(PostgresConnectionFactory connections)
{
    public async Task<bool> CheckAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            await using var connection = connections.Create();
            await connection.OpenAsync(cancellationToken);
            await using var command = new NpgsqlCommand("SELECT 1", connection);
            return Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken)) == 1;
        }
        catch (Exception error) when (error is NpgsqlException or TimeoutException)
        {
            return false;
        }
    }
}
