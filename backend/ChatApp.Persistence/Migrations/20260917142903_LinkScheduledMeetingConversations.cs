using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ChatApp.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class LinkScheduledMeetingConversations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ConversationId",
                table: "ScheduledMeetings",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_ScheduledMeetings_ConversationId",
                table: "ScheduledMeetings",
                column: "ConversationId",
                unique: true,
                filter: "[ConversationId] IS NOT NULL");

            migrationBuilder.AddForeignKey(
                name: "FK_ScheduledMeetings_Conversations_ConversationId",
                table: "ScheduledMeetings",
                column: "ConversationId",
                principalTable: "Conversations",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ScheduledMeetings_Conversations_ConversationId",
                table: "ScheduledMeetings");

            migrationBuilder.DropIndex(
                name: "IX_ScheduledMeetings_ConversationId",
                table: "ScheduledMeetings");

            migrationBuilder.DropColumn(
                name: "ConversationId",
                table: "ScheduledMeetings");
        }
    }
}
