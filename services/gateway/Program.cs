using Gateway;
using Yarp.ReverseProxy.Configuration;
using Yarp.ReverseProxy.Forwarder;
using Yarp.ReverseProxy.Health;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://+:8080");

// Routes and clusters: appsettings "ReverseProxy"; destinations of Consul clusters: ConsulDiscoveryService.
builder.Services.AddSingleton<ConsulProxyConfigProvider>();
builder.Services.AddSingleton<IProxyConfigProvider>(sp => sp.GetRequiredService<ConsulProxyConfigProvider>());
builder.Services.AddSingleton<IForwarderHttpClientFactory, GatewayHttpClientFactory>();
builder.Services.AddReverseProxy();
// Passive health checks (cluster "HealthCheck.Passive" in appsettings): with the defaults (10 requests
// in 60 s) a stopped instance would keep getting traffic in a demo; a 30 % failure rate over 2+ requests marks it.
// YARP never reactivates sooner than the detection window, so the window equals ReactivationPeriod (10 s).
builder.Services.Configure<TransportFailureRateHealthPolicyOptions>(o =>
{
    o.DetectionWindowSize = TimeSpan.FromSeconds(10);
    o.MinimalTotalCountThreshold = 2;
    o.DefaultFailureRateLimit = 0.3;
});
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
    pipeline.Use(ProxyErrors.Handle);
    pipeline.UseSessionAffinity();
    pipeline.UseLoadBalancing();
    pipeline.UsePassiveHealthChecks();
});

app.Run();

public partial class Program;
