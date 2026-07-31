using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ChatApp.Api.Data.Migrations;

public partial class AddLiveStreams : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropCheckConstraint(
            name: "CK_Conversations_Type",
            table: "Conversations");
        migrationBuilder.AddCheckConstraint(
            name: "CK_Conversations_Type",
            table: "Conversations",
            sql: "[Type] IN ('direct', 'group', 'live_stream')");

        migrationBuilder.CreateTable(
            name: "LiveStreamSessions",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                ConversationId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                HostUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                Provider = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                ProviderCallId = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                StartedAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                EndedAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_LiveStreamSessions", x => x.Id);
                table.ForeignKey(
                    name: "FK_LiveStreamSessions_Conversations_ConversationId",
                    column: x => x.ConversationId,
                    principalTable: "Conversations",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
                table.ForeignKey(
                    name: "FK_LiveStreamSessions_Users_HostUserId",
                    column: x => x.HostUserId,
                    principalTable: "Users",
                    principalColumn: "Id");
            });

        migrationBuilder.CreateIndex(
            name: "UX_LiveStreamSessions_ActiveConversation",
            table: "LiveStreamSessions",
            column: "ConversationId",
            unique: true,
            filter: "[EndedAt] IS NULL");
        migrationBuilder.CreateIndex(
            name: "UX_LiveStreamSessions_ActiveHost",
            table: "LiveStreamSessions",
            column: "HostUserId",
            unique: true,
            filter: "[EndedAt] IS NULL");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "LiveStreamSessions");
        migrationBuilder.DropCheckConstraint(
            name: "CK_Conversations_Type",
            table: "Conversations");
        migrationBuilder.AddCheckConstraint(
            name: "CK_Conversations_Type",
            table: "Conversations",
            sql: "[Type] IN ('direct', 'group')");
    }
}
