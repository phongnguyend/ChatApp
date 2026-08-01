using ChatApp.Application.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ChatApp.Api.Data.Migrations;

[DbContext(typeof(ChatDbContext))]
[Migration("20260731170000_AddCallingProvider")]
public partial class AddCallingProvider : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "Provider",
            table: "SessionRecordings",
            type: "nvarchar(80)",
            maxLength: 80,
            nullable: false,
            defaultValue: "peer-to-peer");
        migrationBuilder.AddColumn<string>(
            name: "ProviderCallLocator",
            table: "SessionRecordings",
            type: "nvarchar(500)",
            maxLength: 500,
            nullable: true);
        migrationBuilder.AddColumn<string>(
            name: "ProviderRecordingId",
            table: "SessionRecordings",
            type: "nvarchar(500)",
            maxLength: 500,
            nullable: true);
        migrationBuilder.AddColumn<string>(
            name: "ProviderContentLocationsJson",
            table: "SessionRecordings",
            type: "nvarchar(max)",
            nullable: true);

        migrationBuilder.CreateTable(
            name: "CallingProviderIdentities",
            columns: table => new
            {
                UserId = table.Column<Guid>(
                    type: "uniqueidentifier",
                    nullable: false),
                Provider = table.Column<string>(
                    type: "nvarchar(80)",
                    maxLength: 80,
                    nullable: false),
                ExternalIdentity = table.Column<string>(
                    type: "nvarchar(500)",
                    maxLength: 500,
                    nullable: false),
                CreatedAt = table.Column<DateTimeOffset>(
                    type: "datetimeoffset(3)",
                    precision: 3,
                    nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey(
                    "PK_CallingProviderIdentities",
                    x => new { x.UserId, x.Provider });
                table.ForeignKey(
                    name: "FK_CallingProviderIdentities_Users_UserId",
                    column: x => x.UserId,
                    principalTable: "Users",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "IX_SessionRecordings_Provider_ProviderRecordingId",
            table: "SessionRecordings",
            columns: new[] { "Provider", "ProviderRecordingId" });
        migrationBuilder.CreateIndex(
            name: "IX_CallingProviderIdentities_Provider_ExternalIdentity",
            table: "CallingProviderIdentities",
            columns: new[] { "Provider", "ExternalIdentity" },
            unique: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(
            name: "CallingProviderIdentities");
        migrationBuilder.DropIndex(
            name: "IX_SessionRecordings_Provider_ProviderRecordingId",
            table: "SessionRecordings");
        migrationBuilder.DropColumn(
            name: "Provider",
            table: "SessionRecordings");
        migrationBuilder.DropColumn(
            name: "ProviderCallLocator",
            table: "SessionRecordings");
        migrationBuilder.DropColumn(
            name: "ProviderRecordingId",
            table: "SessionRecordings");
        migrationBuilder.DropColumn(
            name: "ProviderContentLocationsJson",
            table: "SessionRecordings");
    }
}
