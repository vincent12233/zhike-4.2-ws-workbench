using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Zhike.Infrastructure.Database;
using Zhike.Infrastructure.Repositories;
using Zhike.Worker;
using Zhike.Worker.Providers;
using Zhike.Worker.Workers;

var builder = Host.CreateApplicationBuilder(args);
var connectionString = builder.Configuration.GetConnectionString("Postgres")
    ?? builder.Configuration["ConnectionStrings:Postgres"]
    ?? throw new InvalidOperationException("缺少 PostgreSQL 连接字符串。");
builder.Services.AddSingleton(new PostgresConnectionFactory(connectionString));
builder.Services.AddSingleton<WorkerHeartbeatRepository>();
var migrationDirectory = builder.Configuration["ZHike:MigrationDirectory"]
    ?? Path.Combine(AppContext.BaseDirectory, "migrations");
builder.Services.AddSingleton(serviceProvider => new MigrationRunner(
    serviceProvider.GetRequiredService<PostgresConnectionFactory>(), migrationDirectory));
builder.Services.AddSingleton<WsRepository>();
builder.Services.AddSingleton<AiJobRepository>();
builder.Services.AddSingleton<AiAnalysisRepository>();
builder.Services.AddSingleton<BackupWorker>();
builder.Services.AddSingleton<JobDispatcher>();
builder.Services.AddHttpClient<HttpAiAnalysisProvider>();
builder.Services.AddSingleton<IAiAnalysisProvider>(serviceProvider => serviceProvider.GetRequiredService<HttpAiAnalysisProvider>());
builder.Services.AddSingleton<WsIngestWorker>();
builder.Services.AddHostedService(serviceProvider => serviceProvider.GetRequiredService<WsIngestWorker>());
builder.Services.AddHostedService<AiAnalysisWorker>();
builder.Services.AddHostedService<FollowupReminderWorker>();
builder.Services.AddHostedService<BackupScheduler>();
builder.Services.AddHostedService<WorkerHeartbeatService>();
using var host = builder.Build();
// The API and Worker may start at the same time in Compose.  Apply migrations
// here as well so background jobs never query tables before the API has created
// them.  MigrationRunner uses a PostgreSQL advisory lock, so concurrent API and
// Worker startup remains serialized and idempotent.
var migrationRunner = host.Services.GetRequiredService<MigrationRunner>();
await migrationRunner.ApplyAsync(host.Services.GetRequiredService<IHostApplicationLifetime>().ApplicationStopping);
await host.RunAsync();
