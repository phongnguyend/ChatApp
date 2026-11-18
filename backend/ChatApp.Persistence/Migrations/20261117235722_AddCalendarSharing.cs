using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ChatApp.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCalendarSharing : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CalendarFeedToken",
                table: "Users",
                type: "nvarchar(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CalendarSequence",
                table: "ScheduledMeetings",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "ShareToken",
                table: "ScheduledMeetings",
                type: "nvarchar(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TimeZoneId",
                table: "ScheduledMeetings",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Users_CalendarFeedToken",
                table: "Users",
                column: "CalendarFeedToken",
                unique: true,
                filter: "[CalendarFeedToken] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_ScheduledMeetings_ShareToken",
                table: "ScheduledMeetings",
                column: "ShareToken",
                unique: true,
                filter: "[ShareToken] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Users_CalendarFeedToken",
                table: "Users");

            migrationBuilder.DropIndex(
                name: "IX_ScheduledMeetings_ShareToken",
                table: "ScheduledMeetings");

            migrationBuilder.DropColumn(
                name: "CalendarFeedToken",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "CalendarSequence",
                table: "ScheduledMeetings");

            migrationBuilder.DropColumn(
                name: "ShareToken",
                table: "ScheduledMeetings");

            migrationBuilder.DropColumn(
                name: "TimeZoneId",
                table: "ScheduledMeetings");
        }
    }
}
