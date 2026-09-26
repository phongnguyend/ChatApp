using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ChatApp.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddUserDocumentStorageLimits : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "DocumentStorageLimitBytes",
                table: "Users",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_Users_DocumentStorageLimitBytes",
                table: "Users",
                sql: "[DocumentStorageLimitBytes] IS NULL OR [DocumentStorageLimitBytes] > 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Users_DocumentStorageLimitBytes",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "DocumentStorageLimitBytes",
                table: "Users");
        }
    }
}
