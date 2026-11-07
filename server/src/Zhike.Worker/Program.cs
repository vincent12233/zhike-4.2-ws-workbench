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
using var host = builder.Build();
await host.RunAsync();
