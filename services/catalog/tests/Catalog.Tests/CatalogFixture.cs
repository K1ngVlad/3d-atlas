using Microsoft.Extensions.Logging;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Testcontainers.PostgreSql;

namespace Catalog.Tests;

/// <summary>PostgreSQL in a container, migrated and seeded from projects/app/public, plus the app on TestServer.</summary>
public sealed class CatalogFixture : IAsyncLifetime
{
    // Same image as deploy/docker-compose.yml.
    private readonly PostgreSqlContainer _pg = new PostgreSqlBuilder("postgres:18.7-alpine").Build();

    public static string SeedPath { get; } = FindSeedPath();
    public string ConnectionString => _pg.GetConnectionString();
    public SeedResult FirstSeed { get; private set; } = null!;
    public WebApplicationFactory<Program> Factory { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        await _pg.StartAsync();
        await using (var db = CreateDb())
        {
            await db.Database.MigrateAsync();
        }

        // Two seeders at once on an empty database: the advisory lock must let exactly one of them insert.
        var results = await Task.WhenAll(SeedOnceAsync(), SeedOnceAsync());
        FirstSeed = results.Single(r => !r.Skipped);

        Factory = new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Development");
            b.UseSetting("ConnectionStrings:Default", ConnectionString);
            b.UseSetting("Seed:Path", SeedPath);
            // No Consul or MinIO in tests: the background workers just keep retrying.
            b.UseSetting("CONSUL_HTTP_ADDR", "http://127.0.0.1:1");
            // On Windows the default host adds the EventLog provider, which throws ObjectDisposedException
            // when a background service logs during factory disposal.
            b.ConfigureLogging(l => l.ClearProviders());
        });
    }

    public async Task<SeedResult> SeedOnceAsync()
    {
        await using var db = CreateDb();
        return await new DbSeeder(db, NullLogger<DbSeeder>.Instance).SeedAsync(SeedPath);
    }

    public CatalogDbContext CreateDb() =>
        new(new DbContextOptionsBuilder<CatalogDbContext>().UseNpgsql(ConnectionString).Options);

    public async Task DisposeAsync()
    {
        if (Factory is not null) await Factory.DisposeAsync();
        await _pg.DisposeAsync();
    }

    private static string FindSeedPath()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "projects", "app", "public");
            if (Directory.Exists(Path.Combine(candidate, "manifests"))) return candidate;
        }
        throw new DirectoryNotFoundException("projects/app/public not found above the test output directory");
    }
}

[CollectionDefinition(nameof(CatalogCollection))]
public sealed class CatalogCollection : ICollectionFixture<CatalogFixture>;
