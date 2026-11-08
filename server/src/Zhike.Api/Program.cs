using Zhike.Api.Health;
using Zhike.Api.Auth;
using Zhike.Api.Routes;
using Zhike.Infrastructure.Database;
using Zhike.Infrastructure.Repositories;
using System.Security.Cryptography;
using System.Text;

var builder = WebApplication.CreateBuilder(args);
var connectionString = builder.Configuration.GetConnectionString("Postgres")
    ?? builder.Configuration["ConnectionStrings:Postgres"]
    ?? throw new InvalidOperationException("缺少 PostgreSQL 连接字符串。");
var migrationDirectory = builder.Configuration["ZHike:MigrationDirectory"]
    ?? Path.Combine(AppContext.BaseDirectory, "migrations");
builder.Services.AddSingleton(new PostgresConnectionFactory(connectionString));
builder.Services.AddSingleton<WorkerHeartbeatRepository>();
builder.Services.AddSingleton(serviceProvider => new MigrationRunner(
    serviceProvider.GetRequiredService<PostgresConnectionFactory>(), migrationDirectory));
builder.Services.AddSingleton<DatabaseHealthProbe>();
builder.Services.AddSingleton<PairingService>();
builder.Services.AddSingleton<PairingAccessGuard>();
builder.Services.AddSingleton<SessionService>();
builder.Services.AddSingleton<WorkspaceOwnerGuard>();
builder.Services.AddSingleton<WsRepository>();
builder.Services.AddSingleton<CustomerRepository>();
builder.Services.AddSingleton<BusinessRecordRepository>();
builder.Services.AddSingleton<ImportRepository>();
var app = builder.Build();

app.UseExceptionHandler(handler => handler.Run(async context =>
{
    var feature = context.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>();
    var logger = context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Zhike.Api.Errors");
    if (feature?.Error is not null) logger.LogError(feature.Error, "API request failed: {Path}", context.Request.Path);
    context.Response.StatusCode = StatusCodes.Status500InternalServerError;
    context.Response.ContentType = "application/json; charset=utf-8";
    await context.Response.WriteAsJsonAsync(new { error = "服务暂时不可用，请稍后重试。", requestId = context.TraceIdentifier });
}));

app.Use(async (context, next) =>
{
    var path = context.Request.Path.Value ?? string.Empty;
    var publicEndpoint = path.Equals("/api/v2/health", StringComparison.OrdinalIgnoreCase)
        || path.Equals("/api/v2/pairing/start", StringComparison.OrdinalIgnoreCase)
        || path.Equals("/api/v2/pairing/complete", StringComparison.OrdinalIgnoreCase);
    if (path.StartsWith("/api/v2/", StringComparison.OrdinalIgnoreCase) && !publicEndpoint)
    {
        var header = context.Request.Headers.Authorization.ToString();
        var token = header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? header[7..].Trim() : string.Empty;
        var sessions = context.RequestServices.GetRequiredService<SessionService>();
        var validation = sessions.Validate(token);
        var ownerGuard = context.RequestServices.GetRequiredService<WorkspaceOwnerGuard>();
        var configuredConnectorToken = ResolveConnectorToken(app.Configuration);
        // The static connector credential is deliberately narrower than a
        // paired desktop session.  It can ingest/advance checkpoints and send
        // heartbeats, but it can never read followups or enumerate accounts.
        var connectorRequest = IsConnectorWriteEndpoint(context)
            && configuredConnectorToken.Length > 0
            && FixedEquals(token, configuredConnectorToken);
        if (!validation.Valid && !connectorRequest)
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            await context.Response.WriteAsJsonAsync(new { error = "会话无效或已过期，请重新配对。" });
            return;
        }
        if (validation.Valid && !ownerGuard.IsAllowed(validation.OwnerId))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            await context.Response.WriteAsJsonAsync(new { error = "该会话不属于当前知客工作区。" });
            return;
        }
        context.Items["Zhike.OwnerId"] = validation.OwnerId ?? "connector";
    }
    await next();
});

var migrationRunner = app.Services.GetRequiredService<MigrationRunner>();
await migrationRunner.ApplyAsync(app.Lifetime.ApplicationStopping);

app.MapGet("/api/v2/health", async (DatabaseHealthProbe probe, WorkerHeartbeatRepository heartbeats, CancellationToken cancellationToken) =>
{
    var databaseHealthy = await probe.CheckAsync(cancellationToken);
    var schemaVersion = int.TryParse(app.Configuration["ZHike:SchemaVersion"], out var parsed) ? parsed : 9;
    var workerStatus = databaseHealthy
        ? await heartbeats.GetStatusAsync("ai-worker", TimeSpan.FromSeconds(30), cancellationToken)
        : "unavailable";
    var response = HealthResponseFactory.Create(
        app.Configuration["ZHike:AppVersion"] ?? "5.0.0-dev",
        schemaVersion,
        databaseHealthy ? "healthy" : "degraded",
        workerStatus);
    return databaseHealthy ? Results.Ok(response) : Results.Json(response, statusCode: StatusCodes.Status503ServiceUnavailable);
});
app.MapWsRoutes();
app.MapCustomerRoutes();
app.MapBusinessRecordRoutes();
app.MapImportRoutes();
app.MapAuthRoutes();

app.Run();

static bool FixedEquals(string left, string right)
{
    var a = Encoding.UTF8.GetBytes(left ?? string.Empty);
    var b = Encoding.UTF8.GetBytes(right ?? string.Empty);
    return a.Length > 0 && a.Length == b.Length && CryptographicOperations.FixedTimeEquals(a, b);
}

static string ResolveConnectorToken(IConfiguration configuration)
{
    var configured = configuration["ZHike:ConnectorToken"]?.Trim();
    if (!string.IsNullOrWhiteSpace(configured)) return configured;

    var configuredFile = configuration["ZHike:ConnectorTokenFile"]?.Trim()
        ?? Environment.GetEnvironmentVariable("ZHIKE_API_TOKEN_FILE")?.Trim();
    if (!string.IsNullOrWhiteSpace(configuredFile) && File.Exists(configuredFile))
    {
        try
        {
            var fileToken = File.ReadAllText(configuredFile).Trim();
            if (!string.IsNullOrWhiteSpace(fileToken)) return fileToken;
        }
        catch { /* an unavailable secret file is equivalent to no connector token */ }
    }

    return Environment.GetEnvironmentVariable("ZHIKE_API_TOKEN")?.Trim() ?? string.Empty;
}

static bool IsConnectorWriteEndpoint(HttpContext context)
{
    if (!HttpMethods.IsPost(context.Request.Method)) return false;
    var path = context.Request.Path.Value ?? string.Empty;
    return path.Equals("/api/v2/ws/ingest/batch", StringComparison.OrdinalIgnoreCase)
        || path.Equals("/api/v2/ws/checkpoints", StringComparison.OrdinalIgnoreCase)
        || path.Equals("/api/v2/ws/heartbeat", StringComparison.OrdinalIgnoreCase);
}

public partial class Program { }
