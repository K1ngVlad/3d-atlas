using Yarp.ReverseProxy.Forwarder;
using Yarp.ReverseProxy.Model;

namespace Gateway;

/// <summary>Errors of the proxy pipeline as JSON (contracts.md: <c>{"error", "message"}</c>).</summary>
public static class ProxyErrors
{
    /// <summary>No live instances of the cluster → 503 with a JSON body instead of YARP's empty 503.</summary>
    public static async Task NoInstancesAsJson(HttpContext ctx, Func<Task> next)
    {
        var feature = ctx.GetReverseProxyFeature();
        if (feature.AvailableDestinations.Count == 0)
        {
            await WriteAsync(ctx, StatusCodes.Status503ServiceUnavailable, "service_unavailable",
                $"No live instances of '{feature.Cluster.Config.ClusterId}'");
            return;
        }
        await next();
        await ForwarderErrorAsJson(ctx);
    }

    /// <summary>A forwarding error (502/504 from YARP with an empty body) gets a JSON body, if nothing was sent yet.</summary>
    public static async Task ForwarderErrorAsJson(HttpContext ctx)
    {
        var error = ctx.Features.Get<IForwarderErrorFeature>();
        if (error is null || ctx.Response.HasStarted || error.Error == ForwarderError.RequestCanceled) return;
        var cluster = ctx.GetReverseProxyFeature().Cluster.Config.ClusterId;
        await WriteAsync(ctx, ctx.Response.StatusCode, "bad_gateway", $"Upstream '{cluster}' failed: {error.Error}");
    }

    private static Task WriteAsync(HttpContext ctx, int status, string code, string message)
    {
        ctx.Response.StatusCode = status;
        return ctx.Response.WriteAsJsonAsync(new { error = code, message });
    }
}
