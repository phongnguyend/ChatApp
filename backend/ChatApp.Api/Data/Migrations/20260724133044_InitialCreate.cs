using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ChatApp.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Users",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Username = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    NormalizedUsername = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    DisplayName = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    AvatarUrl = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Status = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false, defaultValue: "active"),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    LastSeenAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Users", x => x.Id);
                    table.CheckConstraint("CK_Users_Status", "[Status] IN ('active', 'suspended', 'deleted')");
                });

            migrationBuilder.CreateTable(
                name: "UserBlocks",
                columns: table => new
                {
                    BlockerUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    BlockedUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserBlocks", x => new { x.BlockerUserId, x.BlockedUserId });
                    table.CheckConstraint("CK_UserBlocks_CannotBlockSelf", "[BlockerUserId] <> [BlockedUserId]");
                    table.ForeignKey(
                        name: "FK_UserBlocks_Users_BlockedUserId",
                        column: x => x.BlockedUserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_UserBlocks_Users_BlockerUserId",
                        column: x => x.BlockerUserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "ConversationInvitations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ConversationId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    InvitedUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    InvitedByUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Status = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false, defaultValue: "pending"),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    RespondedAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ConversationInvitations", x => x.Id);
                    table.CheckConstraint("CK_ConversationInvitations_Status", "[Status] IN ('pending', 'accepted', 'declined', 'cancelled')");
                    table.ForeignKey(
                        name: "FK_ConversationInvitations_Users_InvitedByUserId",
                        column: x => x.InvitedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_ConversationInvitations_Users_InvitedUserId",
                        column: x => x.InvitedUserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "ConversationMembers",
                columns: table => new
                {
                    ConversationId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Role = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false, defaultValue: "member"),
                    JoinedAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    LeftAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    LastReadMessageId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    LastReadAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    LastReadSequence = table.Column<long>(type: "bigint", nullable: false),
                    UnreadCount = table.Column<int>(type: "int", nullable: false),
                    MutedUntil = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    IsArchived = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ConversationMembers", x => new { x.ConversationId, x.UserId });
                    table.CheckConstraint("CK_ConversationMembers_Role", "[Role] IN ('owner', 'admin', 'member')");
                    table.ForeignKey(
                        name: "FK_ConversationMembers_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "Conversations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Type = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    Title = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    AvatarUrl = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    CreatedByUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    LastMessageId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    LastMessageAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    IsArchived = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Conversations", x => x.Id);
                    table.CheckConstraint("CK_Conversations_Type", "[Type] IN ('direct', 'group')");
                    table.ForeignKey(
                        name: "FK_Conversations_Users_CreatedByUserId",
                        column: x => x.CreatedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "DirectConversations",
                columns: table => new
                {
                    ConversationId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserLowId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserHighId = table.Column<Guid>(type: "uniqueidentifier", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DirectConversations", x => x.ConversationId);
                    table.CheckConstraint("CK_DirectConversations_UserOrder", "[UserLowId] < [UserHighId]");
                    table.ForeignKey(
                        name: "FK_DirectConversations_Conversations_ConversationId",
                        column: x => x.ConversationId,
                        principalTable: "Conversations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_DirectConversations_Users_UserHighId",
                        column: x => x.UserHighId,
                        principalTable: "Users",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_DirectConversations_Users_UserLowId",
                        column: x => x.UserLowId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "Messages",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ConversationId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    SenderUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    ReplyToMessageId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    MessageType = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false, defaultValue: "text"),
                    Content = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ClientMessageId = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    SequenceNumber = table.Column<long>(type: "bigint", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    EditedAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    DeletedAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Messages", x => x.Id);
                    table.CheckConstraint("CK_Messages_Type", "[MessageType] IN ('text', 'image', 'file', 'audio', 'video', 'system')");
                    table.ForeignKey(
                        name: "FK_Messages_Conversations_ConversationId",
                        column: x => x.ConversationId,
                        principalTable: "Conversations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_Messages_Messages_ReplyToMessageId",
                        column: x => x.ReplyToMessageId,
                        principalTable: "Messages",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_Messages_Users_SenderUserId",
                        column: x => x.SenderUserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "MessageAttachments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    MessageId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    StorageKey = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    FileName = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false),
                    ContentType = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: false),
                    FileSize = table.Column<long>(type: "bigint", nullable: false),
                    Width = table.Column<int>(type: "int", nullable: true),
                    Height = table.Column<int>(type: "int", nullable: true),
                    DurationMs = table.Column<long>(type: "bigint", nullable: true),
                    ThumbnailKey = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MessageAttachments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MessageAttachments_Messages_MessageId",
                        column: x => x.MessageId,
                        principalTable: "Messages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "MessageReactions",
                columns: table => new
                {
                    MessageId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Reaction = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MessageReactions", x => new { x.MessageId, x.UserId, x.Reaction });
                    table.ForeignKey(
                        name: "FK_MessageReactions_Messages_MessageId",
                        column: x => x.MessageId,
                        principalTable: "Messages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_MessageReactions_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "MessageReceipts",
                columns: table => new
                {
                    MessageId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    DeliveredAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    ReadAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MessageReceipts", x => new { x.MessageId, x.UserId });
                    table.ForeignKey(
                        name: "FK_MessageReceipts_Messages_MessageId",
                        column: x => x.MessageId,
                        principalTable: "Messages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_MessageReceipts_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "MessageVersions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    MessageId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Content = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    EditedBy = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MessageVersions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MessageVersions_Messages_MessageId",
                        column: x => x.MessageId,
                        principalTable: "Messages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_MessageVersions_Users_EditedBy",
                        column: x => x.EditedBy,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_ConversationInvitations_ConversationId_InvitedUserId",
                table: "ConversationInvitations",
                columns: new[] { "ConversationId", "InvitedUserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ConversationInvitations_InvitedByUserId",
                table: "ConversationInvitations",
                column: "InvitedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_ConversationInvitations_InvitedUserId",
                table: "ConversationInvitations",
                column: "InvitedUserId");

            migrationBuilder.CreateIndex(
                name: "IX_ConversationMembers_LastReadMessageId",
                table: "ConversationMembers",
                column: "LastReadMessageId");

            migrationBuilder.CreateIndex(
                name: "IX_ConversationMembers_User",
                table: "ConversationMembers",
                columns: new[] { "UserId", "IsArchived", "ConversationId" });

            migrationBuilder.CreateIndex(
                name: "IX_Conversations_CreatedByUserId",
                table: "Conversations",
                column: "CreatedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Conversations_LastMessageAt",
                table: "Conversations",
                column: "LastMessageAt",
                descending: new bool[0]);

            migrationBuilder.CreateIndex(
                name: "IX_Conversations_LastMessageId",
                table: "Conversations",
                column: "LastMessageId");

            migrationBuilder.CreateIndex(
                name: "IX_DirectConversations_UserHighId",
                table: "DirectConversations",
                column: "UserHighId");

            migrationBuilder.CreateIndex(
                name: "IX_DirectConversations_UserLowId_UserHighId",
                table: "DirectConversations",
                columns: new[] { "UserLowId", "UserHighId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MessageAttachments_Message",
                table: "MessageAttachments",
                column: "MessageId");

            migrationBuilder.CreateIndex(
                name: "IX_MessageReactions_Message",
                table: "MessageReactions",
                column: "MessageId");

            migrationBuilder.CreateIndex(
                name: "IX_MessageReactions_UserId",
                table: "MessageReactions",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_MessageReceipts_UserRead",
                table: "MessageReceipts",
                columns: new[] { "UserId", "ReadAt" });

            migrationBuilder.CreateIndex(
                name: "IX_Messages_ConversationCreated",
                table: "Messages",
                columns: new[] { "ConversationId", "CreatedAt", "Id" },
                descending: new[] { false, true, true });

            migrationBuilder.CreateIndex(
                name: "IX_Messages_ReplyTo",
                table: "Messages",
                column: "ReplyToMessageId",
                filter: "[ReplyToMessageId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "UQ_Messages_ClientId",
                table: "Messages",
                columns: new[] { "SenderUserId", "ClientMessageId" },
                unique: true,
                filter: "[SenderUserId] IS NOT NULL AND [ClientMessageId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "UQ_Messages_ConversationSequence",
                table: "Messages",
                columns: new[] { "ConversationId", "SequenceNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MessageVersions_EditedBy",
                table: "MessageVersions",
                column: "EditedBy");

            migrationBuilder.CreateIndex(
                name: "IX_MessageVersions_MessageId",
                table: "MessageVersions",
                column: "MessageId");

            migrationBuilder.CreateIndex(
                name: "IX_UserBlocks_BlockedUserId",
                table: "UserBlocks",
                column: "BlockedUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Users_NormalizedUsername",
                table: "Users",
                column: "NormalizedUsername",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_ConversationInvitations_Conversations_ConversationId",
                table: "ConversationInvitations",
                column: "ConversationId",
                principalTable: "Conversations",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_ConversationMembers_Conversations_ConversationId",
                table: "ConversationMembers",
                column: "ConversationId",
                principalTable: "Conversations",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_ConversationMembers_Messages_LastReadMessageId",
                table: "ConversationMembers",
                column: "LastReadMessageId",
                principalTable: "Messages",
                principalColumn: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_Conversations_Messages_LastMessageId",
                table: "Conversations",
                column: "LastMessageId",
                principalTable: "Messages",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Messages_Conversations_ConversationId",
                table: "Messages");

            migrationBuilder.DropTable(
                name: "ConversationInvitations");

            migrationBuilder.DropTable(
                name: "ConversationMembers");

            migrationBuilder.DropTable(
                name: "DirectConversations");

            migrationBuilder.DropTable(
                name: "MessageAttachments");

            migrationBuilder.DropTable(
                name: "MessageReactions");

            migrationBuilder.DropTable(
                name: "MessageReceipts");

            migrationBuilder.DropTable(
                name: "MessageVersions");

            migrationBuilder.DropTable(
                name: "UserBlocks");

            migrationBuilder.DropTable(
                name: "Conversations");

            migrationBuilder.DropTable(
                name: "Messages");

            migrationBuilder.DropTable(
                name: "Users");
        }
    }
}
