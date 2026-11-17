using Catalog;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://+:8080");
builder.Services.AddDbContext<CatalogDbContext>(o =>
    o.UseNpgsql(builder.Configuration.GetConnectionString("Default")));
builder.Services.AddScoped<DbSeeder>();
builder.Services.AddSingleton(builder.Configuration.GetSection("S3").Get<S3Options>() ?? new S3Options());
builder.Services.AddSingleton<ModelSync>();
builder.Services.AddSingleton<CatalogState>();
builder.Services.AddHostedService<StartupWorker>();
builder.Services.AddHostedService<ConsulRegistrar>();

var app = builder.Build();

app.Use(async (ctx, next) =>
{
    ctx.Response.OnStarting(() =>
    {
        ctx.Response.Headers["X-Instance"] = Environment.MachineName;
        return Task.CompletedTask;
    });
    await next();
});

app.MapGet("/health", async (CatalogDbContext db, CatalogState state, ILogger<Program> log) =>
{
    try
    {
        await db.Database.ExecuteSqlRawAsync("SELECT 1");
    }
    catch (Exception ex)
    {
        log.LogWarning("Health check failed: {Message}", ex.Message);
        return Results.Json(new { error = "unavailable", message = "database is unavailable" }, statusCode: 503);
    }
    if (!state.DatabaseReady)
        return Results.Json(new { error = "unavailable", message = "database is not migrated or seeded yet" }, statusCode: 503);
    if (!state.ModelsSynced)
        return Results.Json(new { error = "unavailable", message = "models are not synced with MinIO yet" }, statusCode: 503);
    return Results.Json(new { status = "ok" });
});

app.Run();

public partial class Program;
