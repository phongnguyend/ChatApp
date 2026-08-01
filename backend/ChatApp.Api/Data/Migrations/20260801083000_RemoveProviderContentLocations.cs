using ChatApp.Application.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ChatApp.Api.Data.Migrations;

[DbContext(typeof(ChatDbContext))]
[Migration("20260801083000_RemoveProviderContentLocations")]
public partial class RemoveProviderContentLocations : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(
            name: "ProviderContentLocationsJson",
            table: "SessionRecordings");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "ProviderContentLocationsJson",
            table: "SessionRecordings",
            type: "nvarchar(max)",
            nullable: true);
    }
}
