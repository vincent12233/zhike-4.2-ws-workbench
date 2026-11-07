using Zhike.Api.Health;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/api/v2/health", () => HealthResponseFactory.Create(
    app.Configuration["ZHike:AppVersion"] ?? "5.0.0-dev",
    int.TryParse(app.Configuration["ZHike:SchemaVersion"], out var schemaVersion) ? schemaVersion : 1,
    "starting",
    "starting"));

app.Run();

public partial class Program { }
