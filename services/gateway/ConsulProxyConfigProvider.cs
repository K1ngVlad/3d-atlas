using Microsoft.Extensions.Primitives;
using Yarp.ReverseProxy.Configuration;

namespace Gateway;

/// <summary>
/// YARP configuration: routes and clusters come from the static "ReverseProxy" section of appsettings;
/// clusters with metadata <c>"Consul": "true"</c> get their destinations from Consul
/// (<see cref="ConsulDiscoveryService"/> calls <see cref="UpdateDestinations"/>). Static clusters
/// (minio, web) are left as configured. Each change publishes a new snapshot and fires its change token.
/// </summary>
public sealed class ConsulProxyConfigProvider : IProxyConfigProvider
{
    public const string ConsulMetadataKey = "Consul";
    public const string ServiceNameMetadataKey = "ConsulService";

    private readonly object _gate = new();
    private readonly IReadOnlyList<RouteConfig> _routes;
    private readonly Dictionary<string, ClusterConfig> _clusters;
    private Snapshot _snapshot;

    public ConsulProxyConfigProvider(IConfiguration config)
    {
        var section = config.GetSection("ReverseProxy");
        _routes = section.GetSection("Routes").GetChildren()
            .Select(c => (c.Get<RouteConfig>() ?? new RouteConfig()) with { RouteId = c.Key })
            .ToList();
        _clusters = section.GetSection("Clusters").GetChildren()
            .Select(c => (c.Get<ClusterConfig>() ?? new ClusterConfig()) with { ClusterId = c.Key })
            .ToDictionary(c => c.ClusterId);

        // Cluster id → Consul service name (metadata "ConsulService", defaults to the cluster id).
        ConsulClusters = _clusters.Values
            .Where(c => c.Metadata?.TryGetValue(ConsulMetadataKey, out var v) == true && bool.TryParse(v, out var b) && b)
            .ToDictionary(
                c => c.ClusterId,
                c => c.Metadata!.TryGetValue(ServiceNameMetadataKey, out var name) && !string.IsNullOrWhiteSpace(name) ? name : c.ClusterId);

        _snapshot = new Snapshot(_routes, _clusters.Values.ToList());
    }

    /// <summary>Clusters whose destinations are discovered in Consul: cluster id → service name.</summary>
    public IReadOnlyDictionary<string, string> ConsulClusters { get; }

    public IProxyConfig GetConfig() => _snapshot;

    /// <summary>Replaces the destinations of a Consul cluster. Addresses are like <c>http://172.20.0.5:8080</c>.</summary>
    public void UpdateDestinations(string clusterId, IReadOnlyCollection<string> addresses)
    {
        Snapshot old;
        lock (_gate)
        {
            // Destination id = address: YARP keeps health state of destinations whose id did not change.
            var destinations = addresses.ToDictionary(a => a, a => new DestinationConfig { Address = a }, StringComparer.Ordinal);
            _clusters[clusterId] = _clusters[clusterId] with { Destinations = destinations };
            old = _snapshot;
            _snapshot = new Snapshot(_routes, _clusters.Values.ToList());
        }
        old.SignalChange();
    }

    private sealed class Snapshot : IProxyConfig
    {
        private readonly CancellationTokenSource _cts = new();

        public Snapshot(IReadOnlyList<RouteConfig> routes, IReadOnlyList<ClusterConfig> clusters)
        {
            Routes = routes;
            Clusters = clusters;
            ChangeToken = new CancellationChangeToken(_cts.Token);
        }

        public IReadOnlyList<RouteConfig> Routes { get; }
        public IReadOnlyList<ClusterConfig> Clusters { get; }
        public IChangeToken ChangeToken { get; }

        public void SignalChange() => _cts.Cancel();
    }
}
