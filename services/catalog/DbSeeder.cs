using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;

namespace Catalog;

public sealed record SeedResult(bool Skipped, int Entities, int StubEntities, int Manifests, int Parts, int Models);

/// <summary>
/// Fills catalog_db from the mounted projects/app/public (contracts.md, "Начальные данные", step 1).
/// The whole seed runs in one transaction under pg_advisory_xact_lock; the "already seeded" check is done
/// after the lock is taken, so two instances starting on an empty database do not both insert.
/// </summary>
public sealed class DbSeeder(CatalogDbContext db, ILogger<DbSeeder> log)
{
    // Arbitrary constant shared by all catalog instances.
    private const long SeedLockKey = 0x_A71A5_CA7A1;

    public const string GlbContentType = "model/gltf-binary";

    public async Task<SeedResult> SeedAsync(string seedPath, CancellationToken ct = default)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Database.ExecuteSqlAsync($"SELECT pg_advisory_xact_lock({SeedLockKey})", ct);

        if (await db.Entities.AnyAsync(ct))
        {
            await tx.CommitAsync(ct);
            log.LogInformation("Catalog database is already seeded; skipping");
            return new SeedResult(true, 0, 0, 0, 0, 0);
        }

        var now = DateTimeOffset.UtcNow;
        var entities = new Dictionary<string, Entity>();
        var stubs = 0;

        foreach (var file in Directory.EnumerateFiles(Path.Combine(seedPath, "content", "entities"), "*.json").Order(StringComparer.Ordinal))
        {
            var node = JsonNode.Parse(await File.ReadAllTextAsync(file, ct))!;
            var id = Str(node, "id") ?? Path.GetFileNameWithoutExtension(file);
            var entity = new Entity
            {
                Id = id,
                Kind = Str(node, "kind") ?? "unknown",
                TitleRu = node["title"]?["ru"]?.GetValue<string>() ?? id,
                SummaryRu = node["summary"]?["ru"]?.GetValue<string>() ?? "",
                UpdatedAt = now,
            };
            var position = 0;
            foreach (var src in node["sources"]?.AsArray() ?? [])
            {
                entity.Sources.Add(new EntitySource
                {
                    EntityId = id,
                    Title = Str(src!, "title") ?? "",
                    Url = Str(src!, "url") ?? "",
                    Position = position++,
                });
            }
            entities.Add(id, entity);
        }
        var contentEntities = entities.Count;

        // Returns true only when a stub was actually created, so the counter in the summary is real.
        bool EnsureEntity(string id, string context)
        {
            if (entities.ContainsKey(id)) return false;
            entities.Add(id, new Entity { Id = id, Kind = "unknown", TitleRu = id, UpdatedAt = now });
            log.LogWarning("Entity {EntityId} ({Context}) has no content file; created a stub", id, context);
            return true;
        }

        var models = new Dictionary<string, Model>();
        var manifests = new List<SceneManifest>();
        var parts = 0;

        foreach (var file in Directory.EnumerateFiles(Path.Combine(seedPath, "manifests"), "*.json").Order(StringComparer.Ordinal))
        {
            var text = await File.ReadAllTextAsync(file, ct);
            var node = JsonNode.Parse(text)!;
            var id = Str(node, "id") ?? throw new InvalidDataException($"{file}: manifest has no id");
            var entityId = Str(node, "entity") ?? throw new InvalidDataException($"{file}: manifest has no entity");
            if (EnsureEntity(entityId, $"manifest {id}")) stubs++;

            var url = node["model"]?["url"]?.GetValue<string>() ?? throw new InvalidDataException($"{file}: manifest has no model.url");
            var objectKey = url.StartsWith("models/", StringComparison.Ordinal) ? url["models/".Length..] : url;
            var modelId = Path.GetDirectoryName(objectKey)?.Replace('\\', '/') is { Length: > 0 } dir ? dir : objectKey;

            if (!models.TryGetValue(modelId, out var model))
            {
                var glb = new FileInfo(Path.Combine(seedPath, "models", objectKey));
                if (!glb.Exists) log.LogWarning("Model file {ObjectKey} referenced by manifest {Id} is missing in the seed", objectKey, id);
                model = new Model
                {
                    Id = modelId,
                    ObjectKey = objectKey,
                    SizeBytes = glb.Exists ? glb.Length : 0,
                    ContentType = GlbContentType,
                };
                models.Add(modelId, model);
            }
            // Several manifests may share one model (stubs): the first manifest with a source wins.
            if (model.SourceAuthor is null && node["source"] is JsonObject source)
            {
                model.SourceAuthor = Str(source, "author");
                model.SourceUrl = Str(source, "url");
                model.SourcePlatform = Str(source, "platform");
                model.License = Str(source, "license");
                model.Modified = source["modified"]?.GetValue<bool>();
            }

            var manifest = new SceneManifest
            {
                Id = id,
                EntityId = entityId,
                ModelId = modelId,
                Status = Str(node, "status") ?? "ready",
                SchemaVersion = node["schemaVersion"]?.GetValue<int>() ?? 1,
                Body = text,
                UpdatedAt = now,
            };
            foreach (var p in node["parts"]?.AsArray() ?? [])
            {
                var partId = Str(p!, "id") ?? throw new InvalidDataException($"{file}: part without id");
                var partEntity = Str(p!, "entity") ?? partId;
                if (EnsureEntity(partEntity, $"part {id}/{partId}")) stubs++;

                // detail is either "manifest-id" or { "id": "...", "focus": "..." } (docs/05-manifest.md).
                var (detailId, detailFocus) = p!["detail"] switch
                {
                    JsonValue v when v.GetValueKind() == JsonValueKind.String => (v.GetValue<string>(), (string?)null),
                    JsonObject o => (Str(o, "id"), Str(o, "focus")),
                    _ => ((string?)null, (string?)null),
                };
                manifest.Parts.Add(new ScenePart
                {
                    ManifestId = id,
                    PartId = partId,
                    EntityId = partEntity,
                    DetailManifestId = detailId,
                    DetailFocus = detailFocus,
                });
                parts++;
            }
            manifests.Add(manifest);
        }

        db.Entities.AddRange(entities.Values);
        db.Models.AddRange(models.Values);
        db.SceneManifests.AddRange(manifests);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        var result = new SeedResult(false, contentEntities, stubs, manifests.Count, parts, models.Count);
        log.LogInformation(
            "Catalog seed done: {Entities} entities from content + {Stubs} stub entities, {Manifests} manifests, {Parts} parts, {Models} models",
            result.Entities, result.StubEntities, result.Manifests, result.Parts, result.Models);
        return result;
    }

    private static string? Str(JsonNode node, string name) =>
        node[name] is JsonValue v && v.GetValueKind() == JsonValueKind.String ? v.GetValue<string>() : null;
}
