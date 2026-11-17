using Yarp.ReverseProxy.Forwarder;

namespace Gateway;

/// <summary>
/// Short connect timeout: a stopped container's IP may not refuse the connection at once,
/// and the request should fail over to another instance quickly instead of hanging.
/// </summary>
public sealed class GatewayHttpClientFactory : ForwarderHttpClientFactory
{
    public static readonly TimeSpan ConnectTimeout = TimeSpan.FromSeconds(2);

    protected override void ConfigureHandler(ForwarderHttpClientContext context, SocketsHttpHandler handler)
    {
        base.ConfigureHandler(context, handler);
        handler.ConnectTimeout = ConnectTimeout;
    }
}
