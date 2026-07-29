using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ChatApp.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class StoreLocationCoordinates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "LocationLatitude",
                table: "Messages",
                type: "decimal(9,6)",
                precision: 9,
                scale: 6,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "LocationLongitude",
                table: "Messages",
                type: "decimal(9,6)",
                precision: 9,
                scale: 6,
                nullable: true);

            migrationBuilder.Sql(
                """
                UPDATE [Messages]
                SET [ReplyToMessageId] = NULL
                WHERE [ReplyToMessageId] IN (
                    SELECT [Id]
                    FROM [Messages]
                    WHERE [MessageType] = N'location'
                );

                UPDATE [ConversationMembers]
                SET [LastReadMessageId] = NULL
                WHERE [LastReadMessageId] IN (
                    SELECT [Id]
                    FROM [Messages]
                    WHERE [MessageType] = N'location'
                );

                UPDATE conversation
                SET
                    [LastMessageId] = latest.[Id],
                    [LastMessageAt] = latest.[CreatedAt]
                FROM [Conversations] AS conversation
                OUTER APPLY (
                    SELECT TOP (1)
                        message.[Id],
                        message.[CreatedAt]
                    FROM [Messages] AS message
                    WHERE
                        message.[ConversationId] = conversation.[Id]
                        AND message.[MessageType] <> N'location'
                    ORDER BY message.[SequenceNumber] DESC
                ) AS latest
                WHERE conversation.[LastMessageId] IN (
                    SELECT [Id]
                    FROM [Messages]
                    WHERE [MessageType] = N'location'
                );

                DELETE FROM [Messages]
                WHERE [MessageType] = N'location';
                """);

            migrationBuilder.AddCheckConstraint(
                name: "CK_Messages_Location",
                table: "Messages",
                sql: "([MessageType] = 'location' AND [Content] IS NULL AND [LocationLatitude] BETWEEN -90 AND 90 AND [LocationLongitude] BETWEEN -180 AND 180) OR ([MessageType] <> 'location' AND [LocationLatitude] IS NULL AND [LocationLongitude] IS NULL)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Messages_Location",
                table: "Messages");

            migrationBuilder.DropColumn(
                name: "LocationLatitude",
                table: "Messages");

            migrationBuilder.DropColumn(
                name: "LocationLongitude",
                table: "Messages");
        }
    }
}
