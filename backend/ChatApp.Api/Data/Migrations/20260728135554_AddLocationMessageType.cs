using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ChatApp.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddLocationMessageType : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Messages_Type",
                table: "Messages");

            migrationBuilder.Sql(
                """
                UPDATE [Messages]
                SET [MessageType] = N'location'
                WHERE [MessageType] = N'text'
                  AND [Content] LIKE N'My current location: https://www.openstreetmap.org/?mlat=%&mlon=%';
                """);

            migrationBuilder.AddCheckConstraint(
                name: "CK_Messages_Type",
                table: "Messages",
                sql: "[MessageType] IN ('text', 'image', 'file', 'audio', 'video', 'location', 'system')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Messages_Type",
                table: "Messages");

            migrationBuilder.Sql(
                """
                UPDATE [Messages]
                SET [MessageType] = N'text'
                WHERE [MessageType] = N'location';
                """);

            migrationBuilder.AddCheckConstraint(
                name: "CK_Messages_Type",
                table: "Messages",
                sql: "[MessageType] IN ('text', 'image', 'file', 'audio', 'video', 'system')");
        }
    }
}
