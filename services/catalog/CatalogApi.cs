using Microsoft.EntityFrameworkCore;

namespace Catalog;

public sealed record LocalizedText(string Ru);
public sealed record SourceLink(string Title, string Url);

/// <summary>Same shape as projects/app/public/content/entities/&lt;id&gt;.json.</summary>
public sealed record EntityContent(string Id, string Kind, LocalizedText Title, LocalizedText Summary, IReadOnlyList<SourceLink> Sources);

public sealed record ManifestSummary(string Id, string Entity, string Status, string Title);

public sealed record ApiError(string Error, string Message);

/// <summary>Catalog endpoints from docs/lab/contracts.md ("Catalog Service", "API").</summary>
public static class CatalogApi
{
    public static void MapCatalogApi(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/catalog");

        api.MapGet("/manifests", async (CatalogDbContext db, CancellationToken ct) =>
            await db.SceneManifests.AsNoTracking()
                .OrderBy(m => m.Id)
                .Select(m => new ManifestSummary(m.Id, m.EntityId, m.Status, m.Entity!.TitleRu))
                .ToListAsync(ct));

        // The body is returned as stored (jsonb text), without deserializing and serializing it again.
        api.MapGet("/manifests/{id}", async Task<IResult> (string id, CatalogDbContext db, CancellationToken ct) =>
        {
            var body = await db.SceneManifests.AsNoTracking()
                .Where(m => m.Id == id)
                .Select(m => m.Body)
                .FirstOrDefaultAsync(ct);
            return body is null
                ? NotFound($"Manifest '{id}' not found")
                : Results.Text(body, "application/json; charset=utf-8");
        })
        .Produces(StatusCodes.Status200OK, contentType: "application/json")
        .Produces<ApiError>(StatusCodes.Status404NotFound);

        api.MapGet("/entities/{id}", async Task<IResult> (string id, CatalogDbContext db, CancellationToken ct) =>
        {
            var entity = await QueryEntities(db).FirstOrDefaultAsync(e => e.Id == id, ct);
            return entity is null ? NotFound($"Entity '{id}' not found") : Results.Ok(ToContent(entity));
        })
        .Produces<EntityContent>()
        .Produces<ApiError>(StatusCodes.Status404NotFound);

        // ?ids=a,b,c → in the requested order, missing ids skipped; without ids → all entities.
        api.MapGet("/entities", async (string? ids, CatalogDbContext db, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(ids))
            {
                var all = await QueryEntities(db).OrderBy(e => e.Id).ToListAsync(ct);
                return all.Select(ToContent).ToList();
            }
            var requested = ids.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Distinct().ToList();
            var found = await QueryEntities(db).Where(e => requested.Contains(e.Id)).ToDictionaryAsync(e => e.Id, ct);
            return requested.Where(found.ContainsKey).Select(id => ToContent(found[id])).ToList();
        });
    }

    private static IQueryable<Entity> QueryEntities(CatalogDbContext db) =>
        db.Entities.AsNoTracking().Include(e => e.Sources);

    private static EntityContent ToContent(Entity e) => new(
        e.Id,
        e.Kind,
        new LocalizedText(e.TitleRu),
        new LocalizedText(e.SummaryRu),
        e.Sources.OrderBy(s => s.Position).Select(s => new SourceLink(s.Title, s.Url)).ToList());

    private static IResult NotFound(string message) =>
        Results.Json(new ApiError("not_found", message), statusCode: StatusCodes.Status404NotFound);
}
