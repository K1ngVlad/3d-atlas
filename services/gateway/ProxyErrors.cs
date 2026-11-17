using Yarp.ReverseProxy.Forwarder;
using Yarp.ReverseProxy.Model;

namespace Gateway;

/// <summary>
/// First step of the proxy pipeline (before load balancing and passive health checks):
/// <list type="bullet">
/// <item>no instances in Consul → 503 with a JSON error (YARP's own 503 has an empty body);</item>
/// <item>idempotent GET/HEAD that failed at the transport level (instance stopped, connection refused)
/// is retried on another instance, so a stopped instance does not show up as 502 while Consul still lists it;</item>
/// <item>other forwarding errors get a JSON body.</item>
/// </list>
/// </summary>
public static class ProxyErrors
{
    private const int MaxAttempts = 3;

    public static async Task Handle(HttpContext ctx, Func<Task> next)
    {
        var feature = ctx.GetReverseProxyFeature();
        if (feature.AllDestinations.Count == 0)
        {
            await WriteAsync(ctx, StatusCodes.Status503ServiceUnavailable, "service_unavailable",
                $"No live instances of '{feature.Cluster.Config.ClusterId}'");
            return;
        }
        // All instances are marked unhealthy by passive checks: try them anyway rather than fail
        // (Consul still reports them passing, and the mark may be a single transient error).
        if (feature.AvailableDestinations.Count == 0)
            feature.AvailableDestinations = feature.AllDestinations;

        var retriable = HttpMethods.IsGet(ctx.Request.Method) || HttpMethods.IsHead(ctx.Request.Method);
        var candidates = feature.AvailableDestinations;
        var tried = new HashSet<DestinationState>();

        for (var attempt = 1; ; attempt++)
        {
            await next();

            var error = ctx.Features.Get<IForwarderErrorFeature>();
            if (error is null || ctx.Response.HasStarted) return;

            if (feature.ProxiedDestination is { } failed) tried.Add(failed);
            var remaining = candidates.Where(d => !tried.Contains(d)).ToList();
            if (!retriable || !IsRetriable(error.Error) || attempt >= MaxAttempts || remaining.Count == 0)
            {
                await ForwarderErrorAsJson(ctx, error);
                return;
            }

            // Reset what the failed attempt left and send the request to another instance.
            ctx.Features.Set<IForwarderErrorFeature>(null);
            ctx.Response.Clear();
            feature.AvailableDestinations = remaining;
            feature.ProxiedDestination = null;
        }
    }

    // Errors before any response bytes came back; GET/HEAD are safe to resend.
    private static bool IsRetriable(ForwarderError e) =>
        e is ForwarderError.Request or ForwarderError.RequestTimedOut or ForwarderError.ResponseHeaders;

    private static Task ForwarderErrorAsJson(HttpContext ctx, IForwarderErrorFeature error)
    {
        if (error.Error == ForwarderError.RequestCanceled) return Task.CompletedTask;
        var cluster = ctx.GetReverseProxyFeature().Cluster.Config.ClusterId;
        var code = ctx.Response.StatusCode == StatusCodes.Status504GatewayTimeout ? "gateway_timeout" : "bad_gateway";
        return WriteAsync(ctx, ctx.Response.StatusCode, code, $"Upstream '{cluster}' failed: {error.Error}");
    }

    private static Task WriteAsync(HttpContext ctx, int status, string code, string message)
    {
        ctx.Response.StatusCode = status;
        return ctx.Response.WriteAsJsonAsync(new { error = code, message });
    }
}
