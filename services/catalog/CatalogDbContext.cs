using Microsoft.EntityFrameworkCore;

namespace Catalog;

// Tables and columns follow docs/lab/contracts.md ("Catalog Service", "Таблицы").

public class Entity
{
    public required string Id { get; set; }
    public required string Kind { get; set; }
    public required string TitleRu { get; set; }
    public string SummaryRu { get; set; } = "";
    public DateTimeOffset UpdatedAt { get; set; }
    public List<EntitySource> Sources { get; set; } = [];
}

public class EntitySource
{
    public int Id { get; set; }
    public required string EntityId { get; set; }
    public required string Title { get; set; }
    public required string Url { get; set; }
    public int Position { get; set; }
}

public class Model
{
    public required string Id { get; set; }
    public required string ObjectKey { get; set; }
    public long SizeBytes { get; set; }
    public required string ContentType { get; set; }
    public string? SourceAuthor { get; set; }
    public string? SourceUrl { get; set; }
    public string? SourcePlatform { get; set; }
    public string? License { get; set; }
    public bool? Modified { get; set; }
}

public class SceneManifest
{
    public required string Id { get; set; }
    public required string EntityId { get; set; }
    public required string ModelId { get; set; }
    public required string Status { get; set; }
    public int SchemaVersion { get; set; }

    /// <summary>The manifest file as-is, stored in a jsonb column (equal by content, not by text).</summary>
    public required string Body { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
    public Entity? Entity { get; set; }
    public List<ScenePart> Parts { get; set; } = [];
}

public class ScenePart
{
    public required string ManifestId { get; set; }
    public required string PartId { get; set; }
    public required string EntityId { get; set; }
    public string? DetailManifestId { get; set; }
    public string? DetailFocus { get; set; }
}

public class CatalogDbContext(DbContextOptions<CatalogDbContext> options) : DbContext(options)
{
    public DbSet<Entity> Entities => Set<Entity>();
    public DbSet<EntitySource> EntitySources => Set<EntitySource>();
    public DbSet<Model> Models => Set<Model>();
    public DbSet<SceneManifest> SceneManifests => Set<SceneManifest>();
    public DbSet<ScenePart> SceneParts => Set<ScenePart>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Entity>(e =>
        {
            e.ToTable("entities");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.Kind).HasColumnName("kind");
            e.Property(x => x.TitleRu).HasColumnName("title_ru");
            e.Property(x => x.SummaryRu).HasColumnName("summary_ru");
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at");
            e.HasMany(x => x.Sources).WithOne().HasForeignKey(s => s.EntityId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<EntitySource>(e =>
        {
            e.ToTable("entity_sources");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id").UseSerialColumn();
            e.Property(x => x.EntityId).HasColumnName("entity_id");
            e.Property(x => x.Title).HasColumnName("title");
            e.Property(x => x.Url).HasColumnName("url");
            e.Property(x => x.Position).HasColumnName("position");
        });

        b.Entity<Model>(e =>
        {
            e.ToTable("models");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.ObjectKey).HasColumnName("object_key");
            e.HasIndex(x => x.ObjectKey).IsUnique();
            e.Property(x => x.SizeBytes).HasColumnName("size_bytes");
            e.Property(x => x.ContentType).HasColumnName("content_type");
            e.Property(x => x.SourceAuthor).HasColumnName("source_author");
            e.Property(x => x.SourceUrl).HasColumnName("source_url");
            e.Property(x => x.SourcePlatform).HasColumnName("source_platform");
            e.Property(x => x.License).HasColumnName("license");
            e.Property(x => x.Modified).HasColumnName("modified");
        });

        b.Entity<SceneManifest>(e =>
        {
            e.ToTable("scene_manifests", t => t.HasCheckConstraint("ck_scene_manifests_status", "status IN ('ready', 'stub')"));
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.EntityId).HasColumnName("entity_id");
            e.Property(x => x.ModelId).HasColumnName("model_id");
            e.Property(x => x.Status).HasColumnName("status");
            e.Property(x => x.SchemaVersion).HasColumnName("schema_version");
            e.Property(x => x.Body).HasColumnName("body").HasColumnType("jsonb");
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at");
            e.HasOne(x => x.Entity).WithMany().HasForeignKey(x => x.EntityId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Model>().WithMany().HasForeignKey(x => x.ModelId).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(x => x.Parts).WithOne().HasForeignKey(p => p.ManifestId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<ScenePart>(e =>
        {
            e.ToTable("scene_parts");
            e.HasKey(x => new { x.ManifestId, x.PartId });
            e.Property(x => x.ManifestId).HasColumnName("manifest_id");
            e.Property(x => x.PartId).HasColumnName("part_id");
            e.Property(x => x.EntityId).HasColumnName("entity_id");
            // No FK on purpose: a detail level may point to a manifest that does not exist yet (contracts.md).
            e.Property(x => x.DetailManifestId).HasColumnName("detail_manifest_id");
            e.Property(x => x.DetailFocus).HasColumnName("detail_focus");
            e.HasOne<Entity>().WithMany().HasForeignKey(x => x.EntityId).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
