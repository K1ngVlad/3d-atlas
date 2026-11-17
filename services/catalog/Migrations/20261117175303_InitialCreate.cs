using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Catalog.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "entities",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    kind = table.Column<string>(type: "text", nullable: false),
                    title_ru = table.Column<string>(type: "text", nullable: false),
                    summary_ru = table.Column<string>(type: "text", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_entities", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "models",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    object_key = table.Column<string>(type: "text", nullable: false),
                    size_bytes = table.Column<long>(type: "bigint", nullable: false),
                    content_type = table.Column<string>(type: "text", nullable: false),
                    source_author = table.Column<string>(type: "text", nullable: true),
                    source_url = table.Column<string>(type: "text", nullable: true),
                    source_platform = table.Column<string>(type: "text", nullable: true),
                    license = table.Column<string>(type: "text", nullable: true),
                    modified = table.Column<bool>(type: "boolean", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_models", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "entity_sources",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.SerialColumn),
                    entity_id = table.Column<string>(type: "text", nullable: false),
                    title = table.Column<string>(type: "text", nullable: false),
                    url = table.Column<string>(type: "text", nullable: false),
                    position = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_entity_sources", x => x.id);
                    table.ForeignKey(
                        name: "FK_entity_sources_entities_entity_id",
                        column: x => x.entity_id,
                        principalTable: "entities",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "scene_manifests",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    entity_id = table.Column<string>(type: "text", nullable: false),
                    model_id = table.Column<string>(type: "text", nullable: false),
                    status = table.Column<string>(type: "text", nullable: false),
                    schema_version = table.Column<int>(type: "integer", nullable: false),
                    body = table.Column<string>(type: "jsonb", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_scene_manifests", x => x.id);
                    table.CheckConstraint("ck_scene_manifests_status", "status IN ('ready', 'stub')");
                    table.ForeignKey(
                        name: "FK_scene_manifests_entities_entity_id",
                        column: x => x.entity_id,
                        principalTable: "entities",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_scene_manifests_models_model_id",
                        column: x => x.model_id,
                        principalTable: "models",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "scene_parts",
                columns: table => new
                {
                    manifest_id = table.Column<string>(type: "text", nullable: false),
                    part_id = table.Column<string>(type: "text", nullable: false),
                    entity_id = table.Column<string>(type: "text", nullable: false),
                    detail_manifest_id = table.Column<string>(type: "text", nullable: true),
                    detail_focus = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_scene_parts", x => new { x.manifest_id, x.part_id });
                    table.ForeignKey(
                        name: "FK_scene_parts_entities_entity_id",
                        column: x => x.entity_id,
                        principalTable: "entities",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_scene_parts_scene_manifests_manifest_id",
                        column: x => x.manifest_id,
                        principalTable: "scene_manifests",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_entity_sources_entity_id",
                table: "entity_sources",
                column: "entity_id");

            migrationBuilder.CreateIndex(
                name: "IX_models_object_key",
                table: "models",
                column: "object_key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_scene_manifests_entity_id",
                table: "scene_manifests",
                column: "entity_id");

            migrationBuilder.CreateIndex(
                name: "IX_scene_manifests_model_id",
                table: "scene_manifests",
                column: "model_id");

            migrationBuilder.CreateIndex(
                name: "IX_scene_parts_entity_id",
                table: "scene_parts",
                column: "entity_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "entity_sources");

            migrationBuilder.DropTable(
                name: "scene_parts");

            migrationBuilder.DropTable(
                name: "scene_manifests");

            migrationBuilder.DropTable(
                name: "entities");

            migrationBuilder.DropTable(
                name: "models");
        }
    }
}
