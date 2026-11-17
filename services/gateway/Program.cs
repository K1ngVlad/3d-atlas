using Gateway;
using Yarp.ReverseProxy.Configuration;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://+:8080");

// Routes and clusters: appsettings "ReverseProxy"; destinations of Consul clusters: ConsulDiscoveryService.
builder.Services.AddSingleton<ConsulProxyConfigProvider>();
builder.Services.AddSingleton<IProxyConfigProvider>(sp => sp.GetRequiredService<ConsulProxyConfigProvider>());
builder.Services.AddReverseProxy();
builder.Services.AddHostedService<ConsulDiscoveryService>();
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
app.MapReverseProxy(pipeline =>
{
    pipeline.Use(ProxyErrors.NoInstancesAsJson);
    pipeline.UseSessionAffinity();
    pipeline.UseLoadBalancing();
    pipeline.UsePassiveHealthChecks();
});

app.Run();

public partial class Program;
