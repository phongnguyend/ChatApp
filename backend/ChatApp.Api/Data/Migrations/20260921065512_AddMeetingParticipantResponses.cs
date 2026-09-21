using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ChatApp.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddMeetingParticipantResponses : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "RespondedAt",
                table: "ScheduledMeetingParticipants",
                type: "datetimeoffset(3)",
                precision: 3,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ResponseStatus",
                table: "ScheduledMeetingParticipants",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "pending");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ScheduledMeetingParticipants_ResponseStatus",
                table: "ScheduledMeetingParticipants",
                sql: "[ResponseStatus] IN ('pending', 'accepted', 'tentative', 'declined')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_ScheduledMeetingParticipants_ResponseStatus",
                table: "ScheduledMeetingParticipants");

            migrationBuilder.DropColumn(
                name: "RespondedAt",
                table: "ScheduledMeetingParticipants");

            migrationBuilder.DropColumn(
                name: "ResponseStatus",
                table: "ScheduledMeetingParticipants");
        }
    }
}
