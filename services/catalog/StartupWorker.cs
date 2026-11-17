using Microsoft.EntityFrameworkCore;

namespace Catalog;

/// <summary>Readiness flags read by /health.</summary>
public sealed class CatalogState
{
    public volatile bool DatabaseReady;
    public volatile bool ModelsSynced;
}

/// <summary>
/// Runs on every start: waits for the database and applies migrations, seeds the database (once),
/// then syncs models with MinIO as a separate step — even when the database was already seeded.
/// Until both are done /health answers 503, so Consul does not route traffic here.
/// </summary>
public sealed class StartupWorker(
    IServiceScopeFactory scopes,
    ModelSync modelSync,
    CatalogState state,
    IConfiguration config,
    ILogger<StartupWorker> log) : BackgroundService
{
    private static readonly TimeSpan RetryDelay = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan SyncRetryDelay = TimeSpan.FromSeconds(10);
    private const int SyncAttemptsBeforeError = 5;

    private string SeedPath => config["Seed:Path"] ?? "/seed";

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        try
        {
            await Retry("migrate and seed the database", async () =>
            {
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
                await db.Database.MigrateAsync(ct);
                await scope.ServiceProvider.GetRequiredService<DbSeeder>().SeedAsync(SeedPath, ct);
            }, ct);
            state.DatabaseReady = true;

            for (var attempt = 1; ; attempt++)
            {
                try
                {
                    var (uploaded, skipped) = await modelSync.SyncAsync(SeedPath, ct);
                    state.ModelsSynced = true;
                    log.LogInformation("MinIO model sync done: {Uploaded} uploaded, {Skipped} already present", uploaded, skipped);
                    break;
                }
                catch (Exception ex) when (!ct.IsCancellationRequested)
                {
                    // Keep retrying forever; /health stays 503 until the models are in the bucket.
                    if (attempt >= SyncAttemptsBeforeError)
                        log.LogError(ex, "MinIO model sync failed (attempt {Attempt}); /health reports 503 until it succeeds", attempt);
                    else
                        log.LogWarning("MinIO model sync failed (attempt {Attempt}): {Message}; retrying", attempt, ex.Message);
                    await Task.Delay(SyncRetryDelay, ct);
                }
            }
        }
        catch (Exception) when (ct.IsCancellationRequested)
        {
            // Shutting down: drivers may wrap the cancellation in their own exception types.
        }
    }

    private async Task Retry(string what, Func<Task> action, CancellationToken ct)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await action();
                return;
            }
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                log.LogWarning("Failed to {What} (attempt {Attempt}): {Message}; retrying", what, attempt, ex.Message);
                await Task.Delay(RetryDelay, ct);
            }
        }
    }
}
