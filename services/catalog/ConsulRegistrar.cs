using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace Catalog;

/// <summary>
/// Registers the service in Consul via the agent HTTP API (contracts.md, "Consul"):
/// retries on start, re-registers every 30 s, deregisters on shutdown (SIGTERM).
/// </summary>
public sealed class ConsulRegistrar(IConfiguration config, ILogger<ConsulRegistrar> log) : BackgroundService
{
    private static readonly TimeSpan RetryDelay = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan ReregisterInterval = TimeSpan.FromSeconds(30);

    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(5) };
    private readonly string _consul = (config["CONSUL_HTTP_ADDR"] ?? "http://consul:8500").TrimEnd('/');
    private readonly string _name = config["Service:Name"] ?? "catalog";
    private readonly string _id = $"{config["Service:Name"] ?? "catalog"}-{Dns.GetHostName()}";
    private bool _registered;

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await RegisterAsync(ct);
                if (!_registered) log.LogInformation("Registered {Id} in Consul", _id);
                _registered = true;
                await Task.Delay(ReregisterInterval, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                log.LogWarning("Consul registration failed ({Message}); retrying", ex.Message);
                try { await Task.Delay(RetryDelay, ct); } catch (OperationCanceledException) { break; }
            }
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        await base.StopAsync(cancellationToken);
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            cts.CancelAfter(TimeSpan.FromSeconds(3));
            using var res = await _http.PutAsync($"{_consul}/v1/agent/service/deregister/{_id}", null, cts.Token);
            log.LogInformation("Deregistered {Id} from Consul: {Status}", _id, (int)res.StatusCode);
        }
        catch (Exception ex)
        {
            log.LogWarning("Consul deregistration failed: {Message}", ex.Message);
        }
    }

    private async Task RegisterAsync(CancellationToken ct)
    {
        var ip = ContainerIp();
        var body = JsonSerializer.Serialize(new
        {
            Name = _name,
            ID = _id,
            Address = ip,
            Port = 8080,
            Check = new
            {
                HTTP = $"http://{ip}:8080/health",
                Interval = "5s",
                Timeout = "2s",
                DeregisterCriticalServiceAfter = "1m",
            },
        });
        using var content = new StringContent(body, Encoding.UTF8, "application/json");
        using var res = await _http.PutAsync($"{_consul}/v1/agent/service/register", content, ct);
        res.EnsureSuccessStatusCode();
    }

    private static string ContainerIp() =>
        NetworkInterface.GetAllNetworkInterfaces()
            .Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType != NetworkInterfaceType.Loopback)
            .SelectMany(n => n.GetIPProperties().UnicastAddresses)
            .Select(a => a.Address)
            .FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork)?.ToString()
        ?? throw new InvalidOperationException("No container IPv4 address found");
}
