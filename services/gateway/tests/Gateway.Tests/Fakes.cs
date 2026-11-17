using System.Text.Json;
using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Logging;

namespace Gateway.Tests;

/// <summary>A real Kestrel app on 127.0.0.1 with a random port.</summary>
public abstract class FakeServer : IAsyncDisposable
{
    protected WebApplication App { get; }
    public int Port { get; private set; }
    public string Url => $"http://127.0.0.1:{Port}";

    protected FakeServer(int port = 0)
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.UseUrls($"http://127.0.0.1:{port}");
        App = builder.Build();
    }

    protected async Task StartServerAsync()
    {
        await App.StartAsync();
        Port = new Uri(App.Urls.First()).Port;
    }

    public async ValueTask DisposeAsync() => await App.DisposeAsync();
}

/// <summary>Answers like a service instance: echoes its name in X-Instance, serves a fixed-size model file.</summary>
public sealed class FakeUpstream : FakeServer
{
    public const int ModelSize = 123_457;

    private FakeUpstream(string name, int port) : base(port)
    {
        App.Use(async (ctx, next) =>
        {
            ctx.Response.Headers["X-Instance"] = name;
            await next();
        });
        App.MapGet("/models/{**rest}", (string rest) => Results.Bytes(new byte[ModelSize], "model/gltf-binary"));
        App.MapGet("/{**rest}", (HttpContext ctx) => Results.Json(new { instance = name, path = ctx.Request.Path.Value }));
    }

    public static async Task<FakeUpstream> StartAsync(string name, int port = 0)
    {
        var s = new FakeUpstream(name, port);
        await s.StartServerAsync();
        return s;
    }
}

/// <summary>Minimal Consul agent: /v1/health/service/{name}?passing=true and service registration.</summary>
public sealed class FakeConsul : FakeServer
{
    public ConcurrentDictionary<string, int[]> Services { get; } = new();
    public volatile bool Down;

    private FakeConsul()
    {
        App.MapGet("/v1/health/service/{name}", (string name) =>
            Down
                ? Results.StatusCode(500)
                // PascalCase like the real Consul API (no camelCase policy).
                : Results.Json(Services.GetValueOrDefault(name, []).Select(port =>
                    new { Service = new { Address = "127.0.0.1", Port = port } }), new JsonSerializerOptions()));
        App.MapPut("/v1/agent/service/register", () => Results.Ok());
        App.MapPut("/v1/agent/service/deregister/{id}", () => Results.Ok());
    }

    public static async Task<FakeConsul> StartAsync()
    {
        var s = new FakeConsul();
        await s.StartServerAsync();
        return s;
    }
}

public static class GatewayFactory
{
    public static WebApplicationFactory<Program> Create(FakeConsul consul, string? minioUrl = null) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseSetting("CONSUL_HTTP_ADDR", consul.Url);
            if (minioUrl is not null) b.UseSetting("ReverseProxy:Clusters:minio:Destinations:minio:Address", minioUrl);
            b.ConfigureLogging(l => l.ClearProviders());
        });

    /// <summary>A port nobody listens on: connections are refused.</summary>
    public static int ClosedPort()
    {
        var l = new TcpListener(IPAddress.Loopback, 0);
        l.Start();
        var port = ((IPEndPoint)l.LocalEndpoint).Port;
        l.Stop();
        return port;
    }
}
