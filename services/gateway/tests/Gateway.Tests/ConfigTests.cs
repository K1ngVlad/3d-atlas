using Microsoft.Extensions.DependencyInjection;

namespace Gateway.Tests;

public sealed class ConfigTests
{
    [Fact]
    public async Task Consul_clusters_have_passive_health_checks_from_appsettings()
    {
        await using var consul = await FakeConsul.StartAsync();
        await using var gw = GatewayFactory.Create(consul);
        var provider = gw.Services.GetRequiredService<ConsulProxyConfigProvider>();

        var catalog = provider.GetConfig().Clusters.Single(c => c.ClusterId == "catalog");
        Assert.Equal("RoundRobin", catalog.LoadBalancingPolicy);
        Assert.True(catalog.HealthCheck?.Passive?.Enabled);
        Assert.Equal("TransportFailureRate", catalog.HealthCheck!.Passive!.Policy);
        Assert.Equal(TimeSpan.FromSeconds(10), catalog.HealthCheck.Passive.ReactivationPeriod);
        Assert.Equal(["analytics", "catalog", "quiz"], provider.ConsulClusters.Keys.Order());
    }
}
