using Catalog;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://+:8080");
builder.Services.AddDbContext<CatalogDbContext>(o =>
    o.UseNpgsql(builder.Configuration.GetConnectionString("Default")));
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

app.MapGet("/health", async (CatalogDbContext db, ILogger<Program> log) =>
{
    try
    {
        await db.Database.ExecuteSqlRawAsync("SELECT 1");
        return Results.Json(new { status = "ok" });
    }
    catch (Exception ex)
    {
        log.LogWarning("Health check failed: {Message}", ex.Message);
        return Results.Json(new { error = "unavailable", message = "database is unavailable" }, statusCode: 503);
    }
});

app.Run();
