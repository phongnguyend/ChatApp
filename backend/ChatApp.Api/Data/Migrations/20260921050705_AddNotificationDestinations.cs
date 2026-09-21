using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ChatApp.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddNotificationDestinations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_UserNotifications_Type",
                table: "UserNotifications");

            migrationBuilder.AddColumn<Guid>(
                name: "ContextId",
                table: "UserNotifications",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_UserNotifications_Type",
                table: "UserNotifications",
                sql: "[Type] IN ('meeting_invite', 'meeting_rescheduled', 'meeting_cancelled', 'document_file_share', 'document_folder_share', 'note_share', 'task_share', 'task_assignment', 'message_reaction', 'recording_ready')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_UserNotifications_Type",
                table: "UserNotifications");

            migrationBuilder.DropColumn(
                name: "ContextId",
                table: "UserNotifications");

            migrationBuilder.AddCheckConstraint(
                name: "CK_UserNotifications_Type",
                table: "UserNotifications",
                sql: "[Type] IN ('meeting_invite', 'meeting_rescheduled', 'document_file_share', 'document_folder_share', 'note_share', 'task_share', 'task_assignment')");
        }
    }
}
