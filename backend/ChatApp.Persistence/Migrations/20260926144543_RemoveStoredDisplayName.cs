using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ChatApp.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RemoveStoredDisplayName : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Preserve legacy names without guessing how to split a person's name.
            migrationBuilder.Sql("""
                UPDATE [Users]
                SET [FirstName] = LTRIM(RTRIM([DisplayName]))
                WHERE NULLIF(LTRIM(RTRIM([FirstName])), N'') IS NULL
                  AND NULLIF(LTRIM(RTRIM([LastName])), N'') IS NULL
                  AND NULLIF(LTRIM(RTRIM([DisplayName])), N'') IS NOT NULL;
                """);
            migrationBuilder.DropColumn(
                name: "DisplayName",
                table: "Users");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DisplayName",
                table: "Users",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");
            migrationBuilder.Sql("""
                UPDATE [Users]
                SET [DisplayName] = LEFT(COALESCE(
                    NULLIF(LTRIM(RTRIM(COALESCE([FirstName], N'') + N' ' + COALESCE([LastName], N''))), N''),
                    [Username]), 100);
                """);
        }
    }
}
