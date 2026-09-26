using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ChatApp.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddMessagePolls : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_UserNotifications_Type",
                table: "UserNotifications");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Messages_Type",
                table: "Messages");

            migrationBuilder.CreateTable(
                name: "MessagePolls",
                columns: table => new
                {
                    MessageId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Question = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: false),
                    IsMultiple = table.Column<bool>(type: "bit", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MessagePolls", x => x.MessageId);
                    table.ForeignKey(
                        name: "FK_MessagePolls_Messages_MessageId",
                        column: x => x.MessageId,
                        principalTable: "Messages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "MessagePollOptions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    PollMessageId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Text = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    SortOrder = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MessagePollOptions", x => x.Id);
                    table.CheckConstraint("CK_MessagePollOptions_SortOrder", "[SortOrder] >= 0");
                    table.ForeignKey(
                        name: "FK_MessagePollOptions_MessagePolls_PollMessageId",
                        column: x => x.PollMessageId,
                        principalTable: "MessagePolls",
                        principalColumn: "MessageId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "MessagePollVotes",
                columns: table => new
                {
                    PollMessageId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    OptionId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MessagePollVotes", x => new { x.PollMessageId, x.UserId, x.OptionId });
                    table.ForeignKey(
                        name: "FK_MessagePollVotes_MessagePollOptions_OptionId",
                        column: x => x.OptionId,
                        principalTable: "MessagePollOptions",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_MessagePollVotes_MessagePolls_PollMessageId",
                        column: x => x.PollMessageId,
                        principalTable: "MessagePolls",
                        principalColumn: "MessageId",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_MessagePollVotes_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_UserNotifications_Type",
                table: "UserNotifications",
                sql: "[Type] IN ('meeting_invite', 'meeting_rescheduled', 'meeting_cancelled', 'document_file_share', 'document_folder_share', 'note_share', 'task_share', 'task_assignment', 'message_reaction', 'message_mention', 'message_reply', 'recording_ready')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Messages_Type",
                table: "Messages",
                sql: "[MessageType] IN ('text', 'image', 'file', 'audio', 'video', 'location', 'live_location', 'poll', 'system')");

            migrationBuilder.CreateIndex(
                name: "IX_MessagePollOptions_PollMessageId_SortOrder",
                table: "MessagePollOptions",
                columns: new[] { "PollMessageId", "SortOrder" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MessagePollVotes_OptionId",
                table: "MessagePollVotes",
                column: "OptionId");

            migrationBuilder.CreateIndex(
                name: "IX_MessagePollVotes_UserId",
                table: "MessagePollVotes",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MessagePollVotes");

            migrationBuilder.DropTable(
                name: "MessagePollOptions");

            migrationBuilder.DropTable(
                name: "MessagePolls");

            migrationBuilder.Sql(
                "UPDATE [Messages] SET [MessageType] = 'text' WHERE [MessageType] = 'poll';");
            migrationBuilder.Sql(
                "DELETE FROM [UserNotifications] WHERE [Type] = 'message_reply';");

            migrationBuilder.DropCheckConstraint(
                name: "CK_UserNotifications_Type",
                table: "UserNotifications");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Messages_Type",
                table: "Messages");

            migrationBuilder.AddCheckConstraint(
                name: "CK_UserNotifications_Type",
                table: "UserNotifications",
                sql: "[Type] IN ('meeting_invite', 'meeting_rescheduled', 'meeting_cancelled', 'document_file_share', 'document_folder_share', 'note_share', 'task_share', 'task_assignment', 'message_reaction', 'message_mention', 'recording_ready')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Messages_Type",
                table: "Messages",
                sql: "[MessageType] IN ('text', 'image', 'file', 'audio', 'video', 'location', 'live_location', 'system')");
        }
    }
}
