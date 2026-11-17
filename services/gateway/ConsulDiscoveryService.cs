using System.Text.Json;

namespace Gateway;

/// <summary>
/// Polls <c>GET /v1/health/service/{name}?passing=true</c> for every Consul cluster: the first time right
/// at start (before Kestrel accepts requests, otherwise the first seconds of /api/* would be 503), then
/// every 5 s. Publishes new destinations only when the set of addresses changes. If Consul is unreachable,
/// the last known addresses are kept and a warning is logged.
/// </summary>
public sealed class ConsulDiscoveryService(
    ConsulProxyConfigProvider provider,
    IConfiguration config,
    ILogger<ConsulDiscoveryService> log) : BackgroundService
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan FirstPollBudget = TimeSpan.FromSeconds(5);

    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(3) };
    private readonly string _consul = (config["CONSUL_HTTP_ADDR"] ?? "http://consul:8500").TrimEnd('/');
    private readonly Dictionary<string, string[]> _known = new();
    private readonly HashSet<string> _failing = new();

    public override async Task StartAsync(CancellationToken cancellationToken)
    {
        // Hosted services start before the server, so the first poll is done before the first request.
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(FirstPollBudget);
        try
        {
            await PollAllAsync(cts.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            log.LogWarning("First Consul poll did not finish in {Budget}; continuing in background", FirstPollBudget);
        }
        await base.StartAsync(cancellationToken);
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(PollInterval);
        try
        {
            while (await timer.WaitForNextTickAsync(ct))
                await PollAllAsync(ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
        }
    }

    private Task PollAllAsync(CancellationToken ct) =>
        Task.WhenAll(provider.ConsulClusters.Select(c => PollAsync(c.Key, c.Value, ct)));

    private async Task PollAsync(string clusterId, string service, CancellationToken ct)
    {
        string[] addresses;
        try
        {
            using var res = await _http.GetAsync($"{_consul}/v1/health/service/{Uri.EscapeDataString(service)}?passing=true", ct);
            res.EnsureSuccessStatusCode();
            await using var stream = await res.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            addresses = doc.RootElement.EnumerateArray()
                .Select(e => e.GetProperty("Service"))
                .Select(s => $"http://{s.GetProperty("Address").GetString()}:{s.GetProperty("Port").GetInt32()}")
                .Distinct()
                .Order(StringComparer.Ordinal)
                .ToArray();
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            lock (_failing)
            {
                if (_failing.Add(clusterId))
                    log.LogWarning("Consul is unavailable for {Service} ({Message}); keeping the last known {Count} address(es)",
                        service, ex.Message, _known.GetValueOrDefault(clusterId)?.Length ?? 0);
            }
            return;
        }

        lock (_failing)
        {
            if (_failing.Remove(clusterId)) log.LogInformation("Consul is reachable again for {Service}", service);
        }

        lock (_known)
        {
            if (_known.TryGetValue(clusterId, out var previous) && previous.SequenceEqual(addresses)) return;
            _known[clusterId] = addresses;
        }
        provider.UpdateDestinations(clusterId, addresses);
        log.LogInformation("Cluster {Cluster}: {Count} instance(s) [{Addresses}]", clusterId, addresses.Length, string.Join(", ", addresses));
    }

    public override void Dispose()
    {
        _http.Dispose();
        base.Dispose();
    }
}
