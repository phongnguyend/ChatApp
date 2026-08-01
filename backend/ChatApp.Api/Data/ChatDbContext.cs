using ChatApp.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Data;

public sealed class ChatDbContext(DbContextOptions<ChatDbContext> options)
    : DbContext(options)
{
    public DbSet<ChatUser> Users => Set<ChatUser>();
    public DbSet<Conversation> Conversations => Set<Conversation>();
    public DbSet<ConversationMember> ConversationMembers => Set<ConversationMember>();
    public DbSet<ChatMessage> Messages => Set<ChatMessage>();
    public DbSet<MessageAttachment> MessageAttachments => Set<MessageAttachment>();
    public DbSet<MessageReaction> MessageReactions => Set<MessageReaction>();
    public DbSet<MessageReceipt> MessageReceipts => Set<MessageReceipt>();
    public DbSet<DirectConversation> DirectConversations => Set<DirectConversation>();
    public DbSet<ConversationInvitation> ConversationInvitations => Set<ConversationInvitation>();
    public DbSet<MessageVersion> MessageVersions => Set<MessageVersion>();
    public DbSet<UserBlock> UserBlocks => Set<UserBlock>();
    public DbSet<LiveLocationShare> LiveLocationShares => Set<LiveLocationShare>();
    public DbSet<SessionRecording> SessionRecordings =>
        Set<SessionRecording>();
    public DbSet<CallingProviderIdentity> CallingProviderIdentities =>
        Set<CallingProviderIdentity>();
    public DbSet<LiveStreamSession> LiveStreamSessions => Set<LiveStreamSession>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ConfigureUsers(modelBuilder);
        ConfigureConversations(modelBuilder);
        ConfigureConversationMembers(modelBuilder);
        ConfigureMessages(modelBuilder);
        ConfigureAttachments(modelBuilder);
        ConfigureReactions(modelBuilder);
        ConfigureReceipts(modelBuilder);
        ConfigureDirectConversations(modelBuilder);
        ConfigureInvitations(modelBuilder);
        ConfigureMessageVersions(modelBuilder);
        ConfigureUserBlocks(modelBuilder);
        ConfigureLiveLocationShares(modelBuilder);
        ConfigureSessionRecordings(modelBuilder);
        ConfigureCallingProviderIdentities(modelBuilder);
        ConfigureLiveStreams(modelBuilder);
    }

    private static void ConfigureUsers(ModelBuilder modelBuilder)
    {
        var entity = modelBuilder.Entity<ChatUser>();
        entity.ToTable("Users", table =>
            table.HasCheckConstraint(
                "CK_Users_Status",
                "[Status] IN ('active', 'suspended', 'deleted')"));
        entity.HasKey(x => x.Id);
        entity.Property(x => x.Username).HasMaxLength(50).IsRequired();
        entity.Property(x => x.NormalizedUsername).HasMaxLength(50).IsRequired();
        entity.HasIndex(x => x.NormalizedUsername).IsUnique();
        entity.Property(x => x.DisplayName).HasMaxLength(100).IsRequired();
        entity.Property(x => x.AvatarUrl).HasColumnType("nvarchar(max)");
        entity.Property(x => x.Status).HasMaxLength(20).HasDefaultValue("active");
        entity.Property(x => x.CreatedAt).HasPrecision(3);
        entity.Property(x => x.UpdatedAt).HasPrecision(3);
        entity.Property(x => x.LastSeenAt).HasPrecision(3);
    }

    private static void ConfigureConversations(ModelBuilder modelBuilder)
    {
        var entity = modelBuilder.Entity<Conversation>();
        entity.ToTable("Conversations", table =>
            table.HasCheckConstraint(
                "CK_Conversations_Type",
                "[Type] IN ('direct', 'group', 'live_stream')"));
        entity.HasKey(x => x.Id);
        entity.Property(x => x.Type).HasMaxLength(20).IsRequired();
        entity.Property(x => x.Title).HasMaxLength(200);
        entity.Property(x => x.AvatarUrl).HasColumnType("nvarchar(max)");
        entity.Property(x => x.CreatedAt).HasPrecision(3);
        entity.Property(x => x.UpdatedAt).HasPrecision(3);
        entity.Property(x => x.LastMessageAt).HasPrecision(3);
        entity.HasIndex(x => x.LastMessageAt)
            .HasDatabaseName("IX_Conversations_LastMessageAt")
            .IsDescending();
        entity.HasOne(x => x.CreatedByUser)
            .WithMany()
            .HasForeignKey(x => x.CreatedByUserId)
            .OnDelete(DeleteBehavior.NoAction);
        entity.HasOne(x => x.LastMessage)
            .WithMany()
            .HasForeignKey(x => x.LastMessageId)
            .OnDelete(DeleteBehavior.NoAction);
    }

    private static void ConfigureLiveStreams(ModelBuilder modelBuilder)
    {
        var session = modelBuilder.Entity<LiveStreamSession>();
        session.ToTable("LiveStreamSessions");
        session.HasKey(x => x.Id);
        session.Property(x => x.Provider).HasMaxLength(80).IsRequired();
        session.Property(x => x.ProviderCallId).HasMaxLength(500).IsRequired();
        session.Property(x => x.StartedAt).HasPrecision(3);
        session.Property(x => x.EndedAt).HasPrecision(3);
        session.HasIndex(x => x.ConversationId)
            .IsUnique()
            .HasFilter("[EndedAt] IS NULL")
            .HasDatabaseName("UX_LiveStreamSessions_ActiveConversation");
        session.HasIndex(x => x.HostUserId)
            .IsUnique()
            .HasFilter("[EndedAt] IS NULL")
            .HasDatabaseName("UX_LiveStreamSessions_ActiveHost");
        session.HasOne(x => x.Conversation)
            .WithMany(x => x.LiveStreamSessions)
            .HasForeignKey(x => x.ConversationId)
            .OnDelete(DeleteBehavior.Cascade);
        session.HasOne(x => x.HostUser)
            .WithMany()
            .HasForeignKey(x => x.HostUserId)
            .OnDelete(DeleteBehavior.NoAction);

    }

    private static void ConfigureConversationMembers(ModelBuilder modelBuilder)
    {
        var entity = modelBuilder.Entity<ConversationMember>();
        entity.ToTable("ConversationMembers", table =>
            table.HasCheckConstraint(
                "CK_ConversationMembers_Role",
                "[Role] IN ('owner', 'admin', 'member')"));
        entity.HasKey(x => new { x.ConversationId, x.UserId });
        entity.Property(x => x.Role).HasMaxLength(20).HasDefaultValue("member");
        entity.Property(x => x.JoinedAt).HasPrecision(3);
        entity.Property(x => x.LeftAt).HasPrecision(3);
        entity.Property(x => x.LastReadAt).HasPrecision(3);
        entity.Property(x => x.MutedUntil).HasPrecision(3);
        entity.HasIndex(x => new { x.UserId, x.IsArchived, x.ConversationId })
            .HasDatabaseName("IX_ConversationMembers_User");
        entity.HasOne(x => x.Conversation)
            .WithMany(x => x.Members)
            .HasForeignKey(x => x.ConversationId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne(x => x.User)
            .WithMany(x => x.ConversationMemberships)
            .HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.NoAction);
        entity.HasOne(x => x.LastReadMessage)
            .WithMany()
            .HasForeignKey(x => x.LastReadMessageId)
            .OnDelete(DeleteBehavior.NoAction);
    }

    private static void ConfigureMessages(ModelBuilder modelBuilder)
    {
        var entity = modelBuilder.Entity<ChatMessage>();
        entity.ToTable("Messages", table =>
        {
            table.HasCheckConstraint(
                "CK_Messages_Type",
                "[MessageType] IN ('text', 'image', 'file', 'audio', 'video', 'location', 'live_location', 'system')");
            table.HasCheckConstraint(
                "CK_Messages_Location",
                "([MessageType] = 'location' AND [Content] IS NULL AND [LocationLatitude] BETWEEN -90 AND 90 AND [LocationLongitude] BETWEEN -180 AND 180) OR ([MessageType] <> 'location' AND [LocationLatitude] IS NULL AND [LocationLongitude] IS NULL)");
        });
        entity.HasKey(x => x.Id);
        entity.Property(x => x.MessageType).HasMaxLength(20).HasDefaultValue("text");
        entity.Property(x => x.Content).HasColumnType("nvarchar(max)");
        entity.Property(x => x.LocationLatitude).HasPrecision(9, 6);
        entity.Property(x => x.LocationLongitude).HasPrecision(9, 6);
        entity.Property(x => x.ClientMessageId).HasMaxLength(100);
        entity.Property(x => x.CreatedAt).HasPrecision(3);
        entity.Property(x => x.EditedAt).HasPrecision(3);
        entity.Property(x => x.DeletedAt).HasPrecision(3);
        entity.HasIndex(x => new { x.SenderUserId, x.ClientMessageId })
            .HasDatabaseName("UQ_Messages_ClientId")
            .IsUnique()
            .HasFilter("[SenderUserId] IS NOT NULL AND [ClientMessageId] IS NOT NULL");
        entity.HasIndex(x => new { x.ConversationId, x.SequenceNumber })
            .HasDatabaseName("UQ_Messages_ConversationSequence")
            .IsUnique();
        entity.HasIndex(x => new { x.ConversationId, x.CreatedAt, x.Id })
            .HasDatabaseName("IX_Messages_ConversationCreated")
            .IsDescending(false, true, true);
        entity.HasIndex(x => x.ReplyToMessageId)
            .HasDatabaseName("IX_Messages_ReplyTo")
            .HasFilter("[ReplyToMessageId] IS NOT NULL");
        entity.HasOne(x => x.Conversation)
            .WithMany(x => x.Messages)
            .HasForeignKey(x => x.ConversationId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne(x => x.Sender)
            .WithMany(x => x.Messages)
            .HasForeignKey(x => x.SenderUserId)
            .OnDelete(DeleteBehavior.NoAction);
        entity.HasOne(x => x.ReplyToMessage)
            .WithMany()
            .HasForeignKey(x => x.ReplyToMessageId)
            .OnDelete(DeleteBehavior.NoAction);
    }

    private static void ConfigureAttachments(ModelBuilder modelBuilder)
    {
        var entity = modelBuilder.Entity<MessageAttachment>();
        entity.ToTable("MessageAttachments");
        entity.HasKey(x => x.Id);
        entity.Property(x => x.StorageKey).HasColumnType("nvarchar(max)").IsRequired();
        entity.Property(x => x.FileName).HasMaxLength(255).IsRequired();
        entity.Property(x => x.ContentType).HasMaxLength(150).IsRequired();
        entity.Property(x => x.ThumbnailKey).HasColumnType("nvarchar(max)");
        entity.Property(x => x.CreatedAt).HasPrecision(3);
        entity.HasIndex(x => x.MessageId).HasDatabaseName("IX_MessageAttachments_Message");
        entity.HasOne(x => x.Message)
            .WithMany(x => x.Attachments)
            .HasForeignKey(x => x.MessageId)
            .OnDelete(DeleteBehavior.Cascade);
    }

    private static void ConfigureReactions(ModelBuilder modelBuilder)
    {
        var entity = modelBuilder.Entity<MessageReaction>();
        entity.ToTable("MessageReactions");
        entity.HasKey(x => new { x.MessageId, x.UserId, x.Reaction });
        entity.Property(x => x.Reaction).HasMaxLength(50);
        entity.Property(x => x.CreatedAt).HasPrecision(3);
        entity.HasIndex(x => x.MessageId).HasDatabaseName("IX_MessageReactions_Message");
        entity.HasOne(x => x.Message)
            .WithMany(x => x.Reactions)
            .HasForeignKey(x => x.MessageId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne(x => x.User)
            .WithMany()
            .HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.NoAction);
    }

    private static void ConfigureReceipts(ModelBuilder modelBuilder)
    {
        var entity = modelBuilder.Entity<MessageReceipt>();
        entity.ToTable("MessageReceipts");
        entity.HasKey(x => new { x.MessageId, x.UserId });
        entity.Property(x => x.DeliveredAt).HasPrecision(3);
        entity.Property(x => x.ReadAt).HasPrecision(3);
        entity.HasIndex(x => new { x.UserId, x.ReadAt })
            .HasDatabaseName("IX_MessageReceipts_UserRead");
        entity.HasOne(x => x.Message)
            .WithMany(x => x.Receipts)
            .HasForeignKey(x => x.MessageId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne(x => x.User)
            .WithMany()
            .HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.NoAction);
    }

    private static void ConfigureDirectConversations(ModelBuilder modelBuilder)
    {
        var entity = modelBuilder.Entity<DirectConversation>();
        entity.ToTable("DirectConversations", table =>
            table.HasCheckConstraint(
                "CK_DirectConversations_UserOrder",
                "[UserLowId] <= [UserHighId]"));
        entity.HasKey(x => x.ConversationId);
        entity.HasIndex(x => new { x.UserLowId, x.UserHighId }).IsUnique();
        entity.HasOne(x => x.Conversation)
            .WithOne()
            .HasForeignKey<DirectConversation>(x => x.ConversationId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne(x => x.UserLow)
            .WithMany()
            .HasForeignKey(x => x.UserLowId)
            .OnDelete(DeleteBehavior.NoAction);
        entity.HasOne(x => x.UserHigh)
            .WithMany()
            .HasForeignKey(x => x.UserHighId)
            .OnDelete(DeleteBehavior.NoAction);
    }

    private static void ConfigureInvitations(ModelBuilder modelBuilder)
    {
        var entity = modelBuilder.Entity<ConversationInvitation>();
        entity.ToTable("ConversationInvitations", table =>
            table.HasCheckConstraint(
                "CK_ConversationInvitations_Status",
                "[Status] IN ('pending', 'accepted', 'declined', 'cancelled')"));
        entity.HasKey(x => x.Id);
        entity.Property(x => x.Status).HasMaxLength(20).HasDefaultValue("pending");
        entity.Property(x => x.CreatedAt).HasPrecision(3);
        entity.Property(x => x.RespondedAt).HasPrecision(3);
        entity.HasIndex(x => new { x.ConversationId, x.InvitedUserId }).IsUnique();
        entity.HasOne(x => x.Conversation)
            .WithMany()
            .HasForeignKey(x => x.ConversationId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne(x => x.InvitedUser)
            .WithMany()
            .HasForeignKey(x => x.InvitedUserId)
            .OnDelete(DeleteBehavior.NoAction);
        entity.HasOne(x => x.InvitedByUser)
            .WithMany()
            .HasForeignKey(x => x.InvitedByUserId)
            .OnDelete(DeleteBehavior.NoAction);
    }

    private static void ConfigureMessageVersions(ModelBuilder modelBuilder)
    {
        var entity = modelBuilder.Entity<MessageVersion>();
        entity.ToTable("MessageVersions");
        entity.HasKey(x => x.Id);
        entity.Property(x => x.Content).HasColumnType("nvarchar(max)");
        entity.Property(x => x.CreatedAt).HasPrecision(3);
        entity.HasOne(x => x.Message)
            .WithMany()
            .HasForeignKey(x => x.MessageId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne(x => x.Editor)
            .WithMany()
            .HasForeignKey(x => x.EditedBy)
            .OnDelete(DeleteBehavior.NoAction);
    }

    private static void ConfigureUserBlocks(ModelBuilder modelBuilder)
    {
        var entity = modelBuilder.Entity<UserBlock>();
        entity.ToTable("UserBlocks", table =>
            table.HasCheckConstraint(
                "CK_UserBlocks_CannotBlockSelf",
                "[BlockerUserId] <> [BlockedUserId]"));
        entity.HasKey(x => new { x.BlockerUserId, x.BlockedUserId });
        entity.Property(x => x.CreatedAt).HasPrecision(3);
        entity.HasOne(x => x.BlockerUser)
            .WithMany()
            .HasForeignKey(x => x.BlockerUserId)
            .OnDelete(DeleteBehavior.NoAction);
        entity.HasOne(x => x.BlockedUser)
            .WithMany()
            .HasForeignKey(x => x.BlockedUserId)
            .OnDelete(DeleteBehavior.NoAction);
    }

    private static void ConfigureLiveLocationShares(ModelBuilder modelBuilder)
    {
        var entity = modelBuilder.Entity<LiveLocationShare>();
        entity.ToTable("LiveLocationShares", table =>
            table.HasCheckConstraint(
                "CK_LiveLocationShares_Coordinates",
                "[Latitude] BETWEEN -90 AND 90 AND [Longitude] BETWEEN -180 AND 180 AND ([AccuracyMeters] IS NULL OR [AccuracyMeters] BETWEEN 0 AND 10000)"));
        entity.HasKey(x => x.MessageId);
        entity.Property(x => x.Latitude).HasPrecision(9, 6);
        entity.Property(x => x.Longitude).HasPrecision(9, 6);
        entity.Property(x => x.AccuracyMeters).HasPrecision(9, 2);
        entity.Property(x => x.StartedAt).HasPrecision(3);
        entity.Property(x => x.UpdatedAt).HasPrecision(3);
        entity.Property(x => x.ExpiresAt).HasPrecision(3);
        entity.Property(x => x.StoppedAt).HasPrecision(3);
        entity.HasIndex(x => new { x.ConversationId, x.UserId })
            .IsUnique()
            .HasFilter("[IsActive] = 1");
        entity.HasOne(x => x.Message)
            .WithOne(x => x.LiveLocationShare)
            .HasForeignKey<LiveLocationShare>(x => x.MessageId)
            .OnDelete(DeleteBehavior.Cascade);
        entity.HasOne(x => x.Conversation)
            .WithMany()
            .HasForeignKey(x => x.ConversationId)
            .OnDelete(DeleteBehavior.NoAction);
        entity.HasOne(x => x.User)
            .WithMany()
            .HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.NoAction);
    }

    private static void ConfigureSessionRecordings(ModelBuilder modelBuilder)
    {
        var recording = modelBuilder.Entity<SessionRecording>();
        recording.ToTable("SessionRecordings", table =>
        {
            table.HasCheckConstraint(
                "CK_SessionRecordings_SessionType",
                "[SessionType] IN ('direct', 'meeting', 'live_stream')");
            table.HasCheckConstraint(
                "CK_SessionRecordings_Status",
                "[Status] IN ('requesting-consent', 'recording', 'processing', 'completed', 'cancelled', 'failed')");
        });
        recording.HasKey(x => x.Id);
        recording.Property(x => x.SessionType).HasMaxLength(20).IsRequired();
        recording.Property(x => x.Status).HasMaxLength(30).IsRequired();
        recording.Property(x => x.Provider).HasMaxLength(80).IsRequired();
        recording.Property(x => x.ProviderCallLocator).HasMaxLength(500);
        recording.Property(x => x.ProviderRecordingId).HasMaxLength(500);
        recording.Property(x => x.ProviderContentLocationsJson)
            .HasColumnType("nvarchar(max)");
        recording.HasIndex(x => new { x.Provider, x.ProviderRecordingId });
        recording.Property(x => x.StorageObjectName).HasColumnType("nvarchar(max)");
        recording.Property(x => x.StartedAt).HasPrecision(3);
        recording.Property(x => x.CompletedAt).HasPrecision(3);
        recording.HasIndex(x => x.SessionId)
            .IsUnique()
            .HasFilter("[Status] IN ('requesting-consent', 'recording', 'processing')");
        recording.HasOne(x => x.Conversation)
            .WithMany()
            .HasForeignKey(x => x.ConversationId)
            .OnDelete(DeleteBehavior.NoAction);
        recording.HasOne(x => x.StartedByUser)
            .WithMany()
            .HasForeignKey(x => x.StartedByUserId)
            .OnDelete(DeleteBehavior.NoAction);

    }

    private static void ConfigureCallingProviderIdentities(
        ModelBuilder modelBuilder)
    {
        var entity = modelBuilder.Entity<CallingProviderIdentity>();
        entity.ToTable("CallingProviderIdentities");
        entity.HasKey(x => new { x.UserId, x.Provider });
        entity.Property(x => x.Provider).HasMaxLength(80);
        entity.Property(x => x.ExternalIdentity).HasMaxLength(500).IsRequired();
        entity.Property(x => x.CreatedAt).HasPrecision(3);
        entity.HasIndex(x => new { x.Provider, x.ExternalIdentity }).IsUnique();
        entity.HasOne(x => x.User)
            .WithMany()
            .HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
