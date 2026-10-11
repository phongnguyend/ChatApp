using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ChatApp.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddWhiteboards : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Whiteboards",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    CreatedById = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Title = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    DocumentJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Revision = table.Column<int>(type: "int", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Whiteboards", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Whiteboards_Users_CreatedById",
                        column: x => x.CreatedById,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "WhiteboardImages",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    WhiteboardId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    DocumentId = table.Column<Guid>(type: "uniqueidentifier", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WhiteboardImages", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WhiteboardImages_StoredDocuments_DocumentId",
                        column: x => x.DocumentId,
                        principalTable: "StoredDocuments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_WhiteboardImages_Whiteboards_WhiteboardId",
                        column: x => x.WhiteboardId,
                        principalTable: "Whiteboards",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "WhiteboardMembers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    WhiteboardId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CanEdit = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WhiteboardMembers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WhiteboardMembers_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_WhiteboardMembers_Whiteboards_WhiteboardId",
                        column: x => x.WhiteboardId,
                        principalTable: "Whiteboards",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "WhiteboardVersions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    WhiteboardId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    OperationId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    CreatedById = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Revision = table.Column<int>(type: "int", nullable: false),
                    DocumentJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WhiteboardVersions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WhiteboardVersions_Whiteboards_WhiteboardId",
                        column: x => x.WhiteboardId,
                        principalTable: "Whiteboards",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_WhiteboardImages_DocumentId",
                table: "WhiteboardImages",
                column: "DocumentId");

            migrationBuilder.CreateIndex(
                name: "IX_WhiteboardImages_WhiteboardId",
                table: "WhiteboardImages",
                column: "WhiteboardId");

            migrationBuilder.CreateIndex(
                name: "IX_WhiteboardMembers_UserId",
                table: "WhiteboardMembers",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_WhiteboardMembers_WhiteboardId_UserId",
                table: "WhiteboardMembers",
                columns: new[] { "WhiteboardId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Whiteboards_CreatedById_UpdatedAt",
                table: "Whiteboards",
                columns: new[] { "CreatedById", "UpdatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_WhiteboardVersions_WhiteboardId_OperationId",
                table: "WhiteboardVersions",
                columns: new[] { "WhiteboardId", "OperationId" },
                unique: true,
                filter: "[OperationId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_WhiteboardVersions_WhiteboardId_Revision",
                table: "WhiteboardVersions",
                columns: new[] { "WhiteboardId", "Revision" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "WhiteboardImages");

            migrationBuilder.DropTable(
                name: "WhiteboardMembers");

            migrationBuilder.DropTable(
                name: "WhiteboardVersions");

            migrationBuilder.DropTable(
                name: "Whiteboards");
        }
    }
}
