using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;

namespace Gateway.Tests;

public sealed class GatewayTests
{
    [Fact]
    public async Task Routes_api_to_instance_from_consul_right_after_start()
    {
        await using var consul = await FakeConsul.StartAsync();
        await using var a = await FakeUpstream.StartAsync("catalog-a");
        consul.Services["catalog"] = [a.Port];
        await using var gw = GatewayFactory.Create(consul);
        using var client = gw.CreateClient();

        // No waiting: the first Consul poll happens during start.
        using var res = await client.GetAsync("/api/catalog/manifests/animal-cell");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("catalog-a", res.Headers.GetValues("X-Instance").Single());
        Assert.True(res.Headers.Contains("X-Gateway-Instance"));
        var body = await res.Content.ReadFromJsonAsync<JsonObject>();
        Assert.Equal("/api/catalog/manifests/animal-cell", body!["path"]!.GetValue<string>()); // path is not rewritten
    }

    [Fact]
    public async Task Balances_round_robin_between_instances()
    {
        await using var consul = await FakeConsul.StartAsync();
        await using var a = await FakeUpstream.StartAsync("a");
        await using var b = await FakeUpstream.StartAsync("b");
        consul.Services["catalog"] = [a.Port, b.Port];
        await using var gw = GatewayFactory.Create(consul);
        using var client = gw.CreateClient();

        var seen = new List<string>();
        for (var i = 0; i < 4; i++)
        {
            using var res = await client.GetAsync("/api/catalog/manifests");
            seen.Add(res.Headers.GetValues("X-Instance").Single());
        }

        Assert.Equal(2, seen.Distinct().Count());
        Assert.NotEqual(seen[0], seen[1]);
        Assert.Equal(seen[0], seen[2]);
    }

    [Fact]
    public async Task No_instances_gives_503_with_json_error()
    {
        await using var consul = await FakeConsul.StartAsync();
        await using var gw = GatewayFactory.Create(consul);
        using var client = gw.CreateClient();

        using var res = await client.GetAsync("/api/quiz/quizzes");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonObject>();
        Assert.Equal("service_unavailable", body!["error"]!.GetValue<string>());
        Assert.Contains("quiz", body["message"]!.GetValue<string>());
    }

    [Fact]
    public async Task Picks_up_new_instances_and_keeps_last_known_when_consul_is_down()
    {
        await using var consul = await FakeConsul.StartAsync();
        await using var a = await FakeUpstream.StartAsync("a");
        await using var gw = GatewayFactory.Create(consul);
        using var client = gw.CreateClient();
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.GetAsync("/api/analytics/summary")).StatusCode);

        consul.Services["analytics"] = [a.Port];
        await Task.Delay(TimeSpan.FromSeconds(6)); // one poll interval
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/analytics/summary")).StatusCode);

        consul.Down = true;
        await Task.Delay(TimeSpan.FromSeconds(6));
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/analytics/summary")).StatusCode);
    }

    [Fact]
    public async Task Models_go_to_minio_with_content_length()
    {
        await using var consul = await FakeConsul.StartAsync();
        await using var minio = await FakeUpstream.StartAsync("minio");
        await using var gw = GatewayFactory.Create(consul, minio.Url);
        using var client = gw.CreateClient();

        using var res = await client.GetAsync("/models/animal-cell/v1/animal-cell.glb", HttpCompletionOption.ResponseHeadersRead);

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal(FakeUpstream.ModelSize, res.Content.Headers.ContentLength);
        Assert.Equal("minio", res.Headers.GetValues("X-Instance").Single());
    }
}
