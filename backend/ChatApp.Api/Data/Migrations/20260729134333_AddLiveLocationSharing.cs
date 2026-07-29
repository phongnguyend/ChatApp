using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ChatApp.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddLiveLocationSharing : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Messages_Type",
                table: "Messages");

            migrationBuilder.CreateTable(
                name: "LiveLocationShares",
                columns: table => new
                {
                    MessageId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ConversationId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Latitude = table.Column<decimal>(type: "decimal(9,6)", precision: 9, scale: 6, nullable: false),
                    Longitude = table.Column<decimal>(type: "decimal(9,6)", precision: 9, scale: 6, nullable: false),
                    AccuracyMeters = table.Column<decimal>(type: "decimal(9,2)", precision: 9, scale: 2, nullable: true),
                    StartedAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    StoppedAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    IsActive = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LiveLocationShares", x => x.MessageId);
                    table.CheckConstraint("CK_LiveLocationShares_Coordinates", "[Latitude] BETWEEN -90 AND 90 AND [Longitude] BETWEEN -180 AND 180 AND ([AccuracyMeters] IS NULL OR [AccuracyMeters] BETWEEN 0 AND 10000)");
                    table.ForeignKey(
                        name: "FK_LiveLocationShares_Conversations_ConversationId",
                        column: x => x.ConversationId,
                        principalTable: "Conversations",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_LiveLocationShares_Messages_MessageId",
                        column: x => x.MessageId,
                        principalTable: "Messages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_LiveLocationShares_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Messages_Type",
                table: "Messages",
                sql: "[MessageType] IN ('text', 'image', 'file', 'audio', 'video', 'location', 'live_location', 'system')");

            migrationBuilder.CreateIndex(
                name: "IX_LiveLocationShares_ConversationId_UserId",
                table: "LiveLocationShares",
                columns: new[] { "ConversationId", "UserId" },
                unique: true,
                filter: "[IsActive] = 1");

            migrationBuilder.CreateIndex(
                name: "IX_LiveLocationShares_UserId",
                table: "LiveLocationShares",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "LiveLocationShares");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Messages_Type",
                table: "Messages");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Messages_Type",
                table: "Messages",
                sql: "[MessageType] IN ('text', 'image', 'file', 'audio', 'video', 'location', 'system')");
        }
    }
}
