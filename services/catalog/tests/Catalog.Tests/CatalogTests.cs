using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;

namespace Catalog.Tests;

[Collection(nameof(CatalogCollection))]
public sealed class CatalogTests(CatalogFixture fx)
{
    [Fact]
    public async Task Manifest_after_seed_equals_source_file_by_content()
    {
        using var client = fx.Factory.CreateClient();
        foreach (var file in Directory.EnumerateFiles(Path.Combine(CatalogFixture.SeedPath, "manifests"), "*.json"))
        {
            var id = Path.GetFileNameWithoutExtension(file);
            using var res = await client.GetAsync($"/api/catalog/manifests/{id}");

            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
            Assert.Equal("application/json", res.Content.Headers.ContentType?.MediaType);
            Assert.True(res.Headers.Contains("X-Instance"));
            var expected = JsonNode.Parse(await File.ReadAllTextAsync(file));
            var actual = JsonNode.Parse(await res.Content.ReadAsStringAsync());
            Assert.True(JsonNode.DeepEquals(expected, actual), $"manifest {id} differs from {file}");
        }
    }

    [Theory]
    [InlineData("/api/catalog/manifests/nope")]
    [InlineData("/api/catalog/entities/nope")]
    public async Task Unknown_id_returns_404_with_json_error(string url)
    {
        using var client = fx.Factory.CreateClient();
        using var res = await client.GetAsync(url);

        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonObject>();
        Assert.Equal("not_found", body!["error"]!.GetValue<string>());
        Assert.False(string.IsNullOrEmpty(body["message"]?.GetValue<string>()));
    }

    [Fact]
    public async Task Detail_as_string_and_as_object_are_parsed_into_scene_parts()
    {
        await using var db = fx.CreateDb();
        var parts = await db.SceneParts.Where(p => p.ManifestId == "animal-cell").ToDictionaryAsync(p => p.PartId);

        Assert.Equal("endoplasmic-reticulum", parts["rough-er"].DetailManifestId);
        Assert.Equal("rough-er", parts["rough-er"].DetailFocus);
        Assert.Equal("golgi", parts["golgi"].DetailManifestId);
        Assert.Null(parts["golgi"].DetailFocus);
        Assert.Null(parts["plasma-membrane"].DetailManifestId);
    }

    [Fact]
    public async Task Entity_has_content_file_shape()
    {
        using var client = fx.Factory.CreateClient();
        var actual = await client.GetFromJsonAsync<JsonNode>("/api/catalog/entities/mitochondrion");
        var expected = JsonNode.Parse(await File.ReadAllTextAsync(
            Path.Combine(CatalogFixture.SeedPath, "content", "entities", "mitochondrion.json")));

        Assert.True(JsonNode.DeepEquals(expected, actual), actual!.ToJsonString());
    }

    [Fact]
    public async Task Entities_by_ids_skip_missing_and_keep_order()
    {
        using var client = fx.Factory.CreateClient();
        var list = await client.GetFromJsonAsync<JsonArray>("/api/catalog/entities?ids=nucleus,nope,mitochondrion");

        Assert.Equal(["nucleus", "mitochondrion"], list!.Select(e => e!["id"]!.GetValue<string>()));
    }

    [Fact]
    public async Task Manifest_list_has_titles_from_entities()
    {
        using var client = fx.Factory.CreateClient();
        var list = await client.GetFromJsonAsync<JsonArray>("/api/catalog/manifests");
        var cell = list!.Single(m => m!["id"]!.GetValue<string>() == "animal-cell")!;

        Assert.Equal("animal-cell", cell["entity"]!.GetValue<string>());
        Assert.Equal("ready", cell["status"]!.GetValue<string>());
        Assert.Equal("Животная клетка", cell["title"]!.GetValue<string>());
        Assert.Contains(list!, m => m!["status"]!.GetValue<string>() == "stub");
    }

    [Fact]
    public async Task Seed_is_idempotent_and_counts_are_consistent()
    {
        var again = await fx.SeedOnceAsync();
        Assert.True(again.Skipped);

        await using var db = fx.CreateDb();
        var seed = fx.FirstSeed;
        Assert.Equal(seed.Entities + seed.StubEntities, await db.Entities.CountAsync());
        Assert.Equal(seed.Manifests, await db.SceneManifests.CountAsync());
        Assert.Equal(seed.Parts, await db.SceneParts.CountAsync());
        Assert.Equal(seed.Models, await db.Models.CountAsync());
        var cellModel = await db.Models.SingleAsync(m => m.Id == "animal-cell/v1");
        Assert.Equal("animal-cell/v1/animal-cell.glb", cellModel.ObjectKey);
        Assert.Equal("montanna", cellModel.SourceAuthor);
        Assert.True(cellModel.SizeBytes > 0);
    }

    [Fact]
    public async Task OpenApi_document_is_available_in_development()
    {
        using var client = fx.Factory.CreateClient();
        var doc = await client.GetFromJsonAsync<JsonNode>("/openapi/v1.json");
        Assert.NotNull(doc!["paths"]!["/api/catalog/manifests/{id}"]);
    }
}
