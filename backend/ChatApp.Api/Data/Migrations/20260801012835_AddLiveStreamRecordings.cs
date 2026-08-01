using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ChatApp.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddLiveStreamRecordings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_SessionRecordings_SessionType",
                table: "SessionRecordings");

            migrationBuilder.AddCheckConstraint(
                name: "CK_SessionRecordings_SessionType",
                table: "SessionRecordings",
                sql: "[SessionType] IN ('direct', 'meeting', 'live_stream')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_SessionRecordings_SessionType",
                table: "SessionRecordings");

            migrationBuilder.AddCheckConstraint(
                name: "CK_SessionRecordings_SessionType",
                table: "SessionRecordings",
                sql: "[SessionType] IN ('direct', 'meeting')");
        }
    }
}
