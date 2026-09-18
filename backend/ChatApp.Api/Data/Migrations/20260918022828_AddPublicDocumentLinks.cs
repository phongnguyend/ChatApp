using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ChatApp.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddPublicDocumentLinks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "DocumentPublicLinks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    OwnerUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    FolderId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    FileId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    Token = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DocumentPublicLinks", x => x.Id);
                    table.CheckConstraint("CK_DocumentPublicLinks_Target", "([FolderId] IS NOT NULL AND [FileId] IS NULL) OR ([FolderId] IS NULL AND [FileId] IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_DocumentPublicLinks_DocumentFolders_FolderId",
                        column: x => x.FolderId,
                        principalTable: "DocumentFolders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_DocumentPublicLinks_StoredDocuments_FileId",
                        column: x => x.FileId,
                        principalTable: "StoredDocuments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_DocumentPublicLinks_Users_OwnerUserId",
                        column: x => x.OwnerUserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_DocumentPublicLinks_FileId",
                table: "DocumentPublicLinks",
                column: "FileId",
                unique: true,
                filter: "[FileId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_DocumentPublicLinks_FolderId",
                table: "DocumentPublicLinks",
                column: "FolderId",
                unique: true,
                filter: "[FolderId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_DocumentPublicLinks_OwnerUserId",
                table: "DocumentPublicLinks",
                column: "OwnerUserId");

            migrationBuilder.CreateIndex(
                name: "IX_DocumentPublicLinks_Token",
                table: "DocumentPublicLinks",
                column: "Token",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DocumentPublicLinks");
        }
    }
}
