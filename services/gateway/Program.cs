using Gateway;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://+:8080");
builder.Services.AddReverseProxy().LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));
builder.Services.AddHostedService<ConsulRegistrar>();

var app = builder.Build();

// The gateway must NOT set X-Instance (contracts.md): it would mix with the one from the proxied service.
app.Use(async (ctx, next) =>
{
    ctx.Response.OnStarting(() =>
    {
        ctx.Response.Headers["X-Gateway-Instance"] = Environment.MachineName;
        return Task.CompletedTask;
    });
    await next();
});

app.MapGet("/health", () => Results.Json(new { status = "ok" }));
app.MapReverseProxy();

app.Run();
