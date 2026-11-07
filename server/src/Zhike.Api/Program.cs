using Zhike.Api.Health;
using Zhike.Infrastructure.Database;

var builder = WebApplication.CreateBuilder(args);
var connectionString = builder.Configuration.GetConnectionString("Postgres")
    ?? builder.Configuration["ConnectionStrings:Postgres"]
    ?? throw new InvalidOperationException("缺少 PostgreSQL 连接字符串。");
var migrationDirectory = builder.Configuration["ZHike:MigrationDirectory"]
    ?? Path.Combine(AppContext.BaseDirectory, "migrations");
builder.Services.AddSingleton(new PostgresConnectionFactory(connectionString));
builder.Services.AddSingleton(serviceProvider => new MigrationRunner(
    serviceProvider.GetRequiredService<PostgresConnectionFactory>(), migrationDirectory));
builder.Services.AddSingleton<DatabaseHealthProbe>();
var app = builder.Build();

var migrationRunner = app.Services.GetRequiredService<MigrationRunner>();
await migrationRunner.ApplyAsync(app.Lifetime.ApplicationStopping);

app.MapGet("/api/v2/health", async (DatabaseHealthProbe probe, CancellationToken cancellationToken) =>
{
    var databaseHealthy = await probe.CheckAsync(cancellationToken);
    var schemaVersion = int.TryParse(app.Configuration["ZHike:SchemaVersion"], out var parsed) ? parsed : 1;
    var response = HealthResponseFactory.Create(
        app.Configuration["ZHike:AppVersion"] ?? "5.0.0-dev",
        schemaVersion,
        databaseHealthy ? "healthy" : "degraded",
        "starting");
    return databaseHealthy ? Results.Ok(response) : Results.Json(response, statusCode: StatusCodes.Status503ServiceUnavailable);
});

app.Run();

public partial class Program { }
