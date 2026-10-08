using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ChatApp.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class TrackFormAttachmentOwnership : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "CreatedById",
                table: "FormResponseAttachments",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "FormOwnerId",
                table: "FormResponseAttachments",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "CreatedById",
                table: "FormAttachmentUploads",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "FormOwnerId",
                table: "FormAttachmentUploads",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.Sql("""
                UPDATE uploads SET FormOwnerId = forms.OwnerId
                FROM FormAttachmentUploads uploads
                INNER JOIN Forms forms ON uploads.FormId = forms.Id;

                UPDATE attachments SET FormOwnerId = forms.OwnerId
                FROM FormResponseAttachments attachments
                INNER JOIN FormResponses responses ON attachments.ResponseId = responses.Id
                INNER JOIN Forms forms ON responses.FormId = forms.Id;
                """);

            migrationBuilder.CreateIndex(
                name: "IX_FormResponseAttachments_CreatedById",
                table: "FormResponseAttachments",
                column: "CreatedById");

            migrationBuilder.CreateIndex(
                name: "IX_FormResponseAttachments_FormOwnerId",
                table: "FormResponseAttachments",
                column: "FormOwnerId");

            migrationBuilder.CreateIndex(
                name: "IX_FormAttachmentUploads_CreatedById",
                table: "FormAttachmentUploads",
                column: "CreatedById");

            migrationBuilder.CreateIndex(
                name: "IX_FormAttachmentUploads_FormOwnerId",
                table: "FormAttachmentUploads",
                column: "FormOwnerId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_FormResponseAttachments_CreatedById",
                table: "FormResponseAttachments");

            migrationBuilder.DropIndex(
                name: "IX_FormResponseAttachments_FormOwnerId",
                table: "FormResponseAttachments");

            migrationBuilder.DropIndex(
                name: "IX_FormAttachmentUploads_CreatedById",
                table: "FormAttachmentUploads");

            migrationBuilder.DropIndex(
                name: "IX_FormAttachmentUploads_FormOwnerId",
                table: "FormAttachmentUploads");

            migrationBuilder.DropColumn(
                name: "CreatedById",
                table: "FormResponseAttachments");

            migrationBuilder.DropColumn(
                name: "FormOwnerId",
                table: "FormResponseAttachments");

            migrationBuilder.DropColumn(
                name: "CreatedById",
                table: "FormAttachmentUploads");

            migrationBuilder.DropColumn(
                name: "FormOwnerId",
                table: "FormAttachmentUploads");
        }
    }
}
