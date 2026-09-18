using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ChatApp.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddMeetingRescheduleNotifications : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_UserNotifications_Type",
                table: "UserNotifications");

            migrationBuilder.AddColumn<string>(
                name: "Details",
                table: "UserNotifications",
                type: "nvarchar(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_UserNotifications_Type",
                table: "UserNotifications",
                sql: "[Type] IN ('meeting_invite', 'meeting_rescheduled', 'document_file_share', 'document_folder_share', 'note_share', 'task_share', 'task_assignment')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_UserNotifications_Type",
                table: "UserNotifications");

            migrationBuilder.DropColumn(
                name: "Details",
                table: "UserNotifications");

            migrationBuilder.AddCheckConstraint(
                name: "CK_UserNotifications_Type",
                table: "UserNotifications",
                sql: "[Type] IN ('meeting_invite', 'document_file_share', 'document_folder_share', 'note_share', 'task_share', 'task_assignment')");
        }
    }
}
