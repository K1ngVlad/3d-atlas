using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Yarp.ReverseProxy;
using Yarp.ReverseProxy.Model;

namespace Gateway.Tests;

/// <summary>Stage 4.1: passive health checks and retry of idempotent GET on another instance.</summary>
public sealed class FailoverTests
{
    [Fact]
    public async Task Get_is_retried_on_another_instance_and_dead_one_is_marked_unhealthy()
    {
        await using var consul = await FakeConsul.StartAsync();
        await using var alive = await FakeUpstream.StartAsync("alive");
        var dead = GatewayFactory.ClosedPort();
        consul.Services["quiz"] = [alive.Port, dead];
        await using var gw = GatewayFactory.Create(consul);
        using var client = gw.CreateClient();

        for (var i = 0; i < 10; i++)
        {
            using var res = await client.GetAsync("/api/quiz/quizzes");
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
            Assert.Equal("alive", res.Headers.GetValues("X-Instance").Single());
        }

        var lookup = gw.Services.GetRequiredService<IProxyStateLookup>();
        Assert.True(lookup.TryGetCluster("quiz", out var cluster));
        var deadState = cluster.Destinations.Values.Single(d => d.Model.Config.Address.EndsWith($":{dead}"));
        Assert.Equal(DestinationHealth.Unhealthy, deadState.Health.Passive);
    }

    [Fact]
    public async Task Post_is_not_retried_and_failure_is_json()
    {
        await using var consul = await FakeConsul.StartAsync();
        consul.Services["quiz"] = [GatewayFactory.ClosedPort()];
        await using var gw = GatewayFactory.Create(consul);
        using var client = gw.CreateClient();

        using var res = await client.PostAsJsonAsync("/api/quiz/attempts", new { quizId = "x" });

        // Linux refuses the connection at once (502); Windows loopback retries SYN until the 2 s connect timeout (504).
        Assert.Contains(res.StatusCode, new[] { HttpStatusCode.BadGateway, HttpStatusCode.GatewayTimeout });
        var body = await res.Content.ReadFromJsonAsync<JsonObject>();
        Assert.Contains(body!["error"]!.GetValue<string>(), new[] { "bad_gateway", "gateway_timeout" });
    }

    [Fact]
    public async Task Single_instance_marked_unhealthy_is_still_tried()
    {
        await using var consul = await FakeConsul.StartAsync();
        var port = GatewayFactory.ClosedPort();
        consul.Services["catalog"] = [port];
        await using var gw = GatewayFactory.Create(consul);
        using var client = gw.CreateClient();
        for (var i = 0; i < 3; i++) await client.GetAsync("/api/catalog/manifests"); // marks it unhealthy

        // The instance comes back on the same address (e.g. restarted container).
        await using var back = await FakeUpstream.StartAsync("back", port);
        using var res = await client.GetAsync("/api/catalog/manifests");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }
}
