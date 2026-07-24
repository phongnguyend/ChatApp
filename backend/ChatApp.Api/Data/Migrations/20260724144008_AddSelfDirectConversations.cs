using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ChatApp.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSelfDirectConversations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_DirectConversations_UserOrder",
                table: "DirectConversations");

            migrationBuilder.AddCheckConstraint(
                name: "CK_DirectConversations_UserOrder",
                table: "DirectConversations",
                sql: "[UserLowId] <= [UserHighId]");

            migrationBuilder.Sql(
                """
                DECLARE @Now datetimeoffset(3) = SYSDATETIMEOFFSET();
                DECLARE @SelfConversations TABLE
                (
                    UserId uniqueidentifier NOT NULL PRIMARY KEY,
                    ConversationId uniqueidentifier NOT NULL
                );

                INSERT INTO @SelfConversations (UserId, ConversationId)
                SELECT [Id], NEWID()
                FROM [Users] AS [user]
                WHERE NOT EXISTS
                (
                    SELECT 1
                    FROM [DirectConversations] AS [direct]
                    WHERE [direct].[UserLowId] = [user].[Id]
                      AND [direct].[UserHighId] = [user].[Id]
                );

                INSERT INTO [Conversations]
                    ([Id], [Type], [Title], [AvatarUrl], [CreatedByUserId],
                     [CreatedAt], [UpdatedAt], [LastMessageId], [LastMessageAt], [IsArchived])
                SELECT
                    [ConversationId], N'direct', NULL, NULL, [UserId],
                    @Now, @Now, NULL, NULL, CAST(0 AS bit)
                FROM @SelfConversations;

                INSERT INTO [ConversationMembers]
                    ([ConversationId], [UserId], [Role], [JoinedAt], [LeftAt],
                     [LastReadMessageId], [LastReadAt], [LastReadSequence],
                     [UnreadCount], [MutedUntil], [IsArchived])
                SELECT
                    [ConversationId], [UserId], N'member', @Now, NULL,
                    NULL, NULL, 0, 0, NULL, CAST(0 AS bit)
                FROM @SelfConversations;

                INSERT INTO [DirectConversations]
                    ([ConversationId], [UserLowId], [UserHighId])
                SELECT [ConversationId], [UserId], [UserId]
                FROM @SelfConversations;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_DirectConversations_UserOrder",
                table: "DirectConversations");

            migrationBuilder.Sql(
                """
                DELETE [conversation]
                FROM [Conversations] AS [conversation]
                INNER JOIN [DirectConversations] AS [direct]
                    ON [direct].[ConversationId] = [conversation].[Id]
                WHERE [direct].[UserLowId] = [direct].[UserHighId];
                """);

            migrationBuilder.AddCheckConstraint(
                name: "CK_DirectConversations_UserOrder",
                table: "DirectConversations",
                sql: "[UserLowId] < [UserHighId]");
        }
    }
}
