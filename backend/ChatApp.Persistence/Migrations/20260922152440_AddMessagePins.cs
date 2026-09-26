using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ChatApp.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddMessagePins : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "PinnedAt",
                table: "Messages",
                type: "datetimeoffset(3)",
                precision: 3,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "PinnedByUserId",
                table: "Messages",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Messages_ConversationPinned",
                table: "Messages",
                columns: new[] { "ConversationId", "PinnedAt" },
                descending: new[] { false, true },
                filter: "[PinnedAt] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Messages_PinnedByUserId",
                table: "Messages",
                column: "PinnedByUserId");

            migrationBuilder.AddForeignKey(
                name: "FK_Messages_Users_PinnedByUserId",
                table: "Messages",
                column: "PinnedByUserId",
                principalTable: "Users",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Messages_Users_PinnedByUserId",
                table: "Messages");

            migrationBuilder.DropIndex(
                name: "IX_Messages_ConversationPinned",
                table: "Messages");

            migrationBuilder.DropIndex(
                name: "IX_Messages_PinnedByUserId",
                table: "Messages");

            migrationBuilder.DropColumn(
                name: "PinnedAt",
                table: "Messages");

            migrationBuilder.DropColumn(
                name: "PinnedByUserId",
                table: "Messages");
        }
    }
}
