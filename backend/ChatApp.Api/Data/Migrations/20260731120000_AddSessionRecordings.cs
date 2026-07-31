using ChatApp.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ChatApp.Api.Data.Migrations;

[DbContext(typeof(ChatDbContext))]
[Migration("20260731120000_AddSessionRecordings")]
public partial class AddSessionRecordings : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "SessionRecordings",
            columns: table => new
            {
                Id = table.Column<Guid>(
                    type: "uniqueidentifier",
                    nullable: false),
                ConversationId = table.Column<Guid>(
                    type: "uniqueidentifier",
                    nullable: false),
                SessionId = table.Column<Guid>(
                    type: "uniqueidentifier",
                    nullable: false),
                StartedByUserId = table.Column<Guid>(
                    type: "uniqueidentifier",
                    nullable: false),
                SessionType = table.Column<string>(
                    type: "nvarchar(20)",
                    maxLength: 20,
                    nullable: false),
                Status = table.Column<string>(
                    type: "nvarchar(30)",
                    maxLength: 30,
                    nullable: false),
                StorageObjectName = table.Column<string>(
                    type: "nvarchar(max)",
                    nullable: true),
                StartedAt = table.Column<DateTimeOffset>(
                    type: "datetimeoffset(3)",
                    precision: 3,
                    nullable: false),
                CompletedAt = table.Column<DateTimeOffset>(
                    type: "datetimeoffset(3)",
                    precision: 3,
                    nullable: true),
                DurationMilliseconds = table.Column<long>(
                    type: "bigint",
                    nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_SessionRecordings", x => x.Id);
                table.CheckConstraint(
                    "CK_SessionRecordings_SessionType",
                    "[SessionType] IN ('direct', 'meeting')");
                table.CheckConstraint(
                    "CK_SessionRecordings_Status",
                    "[Status] IN ('requesting-consent', 'recording', 'processing', 'completed', 'cancelled', 'failed')");
                table.ForeignKey(
                    name: "FK_SessionRecordings_Conversations_ConversationId",
                    column: x => x.ConversationId,
                    principalTable: "Conversations",
                    principalColumn: "Id");
                table.ForeignKey(
                    name: "FK_SessionRecordings_Users_StartedByUserId",
                    column: x => x.StartedByUserId,
                    principalTable: "Users",
                    principalColumn: "Id");
            });

        migrationBuilder.CreateTable(
            name: "SessionRecordingChunks",
            columns: table => new
            {
                RecordingId = table.Column<Guid>(
                    type: "uniqueidentifier",
                    nullable: false),
                Sequence = table.Column<int>(
                    type: "int",
                    nullable: false),
                StorageObjectName = table.Column<string>(
                    type: "nvarchar(max)",
                    nullable: false),
                FileSize = table.Column<long>(
                    type: "bigint",
                    nullable: false),
                UploadedAt = table.Column<DateTimeOffset>(
                    type: "datetimeoffset(3)",
                    precision: 3,
                    nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey(
                    "PK_SessionRecordingChunks",
                    x => new { x.RecordingId, x.Sequence });
                table.ForeignKey(
                    name: "FK_SessionRecordingChunks_SessionRecordings_RecordingId",
                    column: x => x.RecordingId,
                    principalTable: "SessionRecordings",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "IX_SessionRecordings_ConversationId",
            table: "SessionRecordings",
            column: "ConversationId");

        migrationBuilder.CreateIndex(
            name: "IX_SessionRecordings_SessionId",
            table: "SessionRecordings",
            column: "SessionId",
            unique: true,
            filter:
                "[Status] IN ('requesting-consent', 'recording', 'processing')");

        migrationBuilder.CreateIndex(
            name: "IX_SessionRecordings_StartedByUserId",
            table: "SessionRecordings",
            column: "StartedByUserId");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "SessionRecordingChunks");
        migrationBuilder.DropTable(name: "SessionRecordings");
    }
}
