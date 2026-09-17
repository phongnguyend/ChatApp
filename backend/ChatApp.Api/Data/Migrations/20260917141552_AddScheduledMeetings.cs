using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ChatApp.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddScheduledMeetings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ScheduledMeetings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    OrganizerUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Title = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Description = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: true),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false),
                    EndDate = table.Column<DateOnly>(type: "date", nullable: false),
                    IsAllDay = table.Column<bool>(type: "bit", nullable: false),
                    StartTime = table.Column<TimeOnly>(type: "time(0)", nullable: true),
                    EndTime = table.Column<TimeOnly>(type: "time(0)", nullable: true),
                    Status = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    CancelledAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ScheduledMeetings", x => x.Id);
                    table.CheckConstraint("CK_ScheduledMeetings_Dates", "[EndDate] >= [StartDate]");
                    table.CheckConstraint("CK_ScheduledMeetings_Status", "[Status] IN ('scheduled', 'cancelled')");
                    table.CheckConstraint("CK_ScheduledMeetings_Times", "([IsAllDay] = 1 AND [StartTime] IS NULL AND [EndTime] IS NULL) OR ([IsAllDay] = 0 AND [StartTime] IS NOT NULL AND [EndTime] IS NOT NULL AND ([EndDate] > [StartDate] OR [EndTime] > [StartTime]))");
                    table.ForeignKey(
                        name: "FK_ScheduledMeetings_Users_OrganizerUserId",
                        column: x => x.OrganizerUserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "ScheduledMeetingParticipants",
                columns: table => new
                {
                    MeetingId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ScheduledMeetingParticipants", x => new { x.MeetingId, x.UserId });
                    table.ForeignKey(
                        name: "FK_ScheduledMeetingParticipants_ScheduledMeetings_MeetingId",
                        column: x => x.MeetingId,
                        principalTable: "ScheduledMeetings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ScheduledMeetingParticipants_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_ScheduledMeetingParticipants_UserId",
                table: "ScheduledMeetingParticipants",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_ScheduledMeetings_OrganizerUserId",
                table: "ScheduledMeetings",
                column: "OrganizerUserId");

            migrationBuilder.CreateIndex(
                name: "IX_ScheduledMeetings_StartDate_EndDate",
                table: "ScheduledMeetings",
                columns: new[] { "StartDate", "EndDate" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ScheduledMeetingParticipants");

            migrationBuilder.DropTable(
                name: "ScheduledMeetings");
        }
    }
}
