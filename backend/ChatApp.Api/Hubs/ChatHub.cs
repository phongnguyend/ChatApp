using System.Data;
using ChatApp.Api.Contracts;
using ChatApp.Api.Data;
using ChatApp.Api.Models;
using ChatApp.Api.Services;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Hubs;

public sealed class ChatHub(
    ChatDbContext db,
    PresenceTracker presence,
    AzurePushNotificationService pushNotifications,
    ILogger<ChatHub> logger) : Hub
{
    private const string UsernameQueryKey = "username";

    public override async Task OnConnectedAsync()
    {
        var username = Context.GetHttpContext()?.Request.Query[UsernameQueryKey].ToString() ?? "";
        var user = await FindUser(username);

        if (user is null)
        {
            Context.Abort();
            return;
        }

        presence.Connect(
            Context.ConnectionId,
            user.Id,
            user.Username,
            user.DisplayName,
            user.AvatarUrl);

        var conversationIds = await db.ConversationMembers
            .Where(x => x.UserId == user.Id && x.LeftAt == null)
            .Select(x => x.ConversationId)
            .ToListAsync();
        foreach (var conversationId in conversationIds)
        {
            await Groups.AddToGroupAsync(
                Context.ConnectionId,
                ConversationGroup(conversationId));
        }

        await Clients.All.SendAsync("PresenceChanged", presence.OnlineUsers());
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var session = presence.Disconnect(Context.ConnectionId);
        if (session is not null)
        {
            var user = await db.Users.FindAsync([session.UserId]);
            if (user is not null)
            {
                user.LastSeenAt = DateTimeOffset.UtcNow;
                user.UpdatedAt = DateTimeOffset.UtcNow;
                await db.SaveChangesAsync();
            }

            await Clients.All.SendAsync("PresenceChanged", presence.OnlineUsers());
        }

        await base.OnDisconnectedAsync(exception);
    }

    public async Task JoinConversation(Guid conversationId)
    {
        var session = GetSession();
        await EnsureMembership(session.UserId, conversationId);
        await Groups.AddToGroupAsync(Context.ConnectionId, ConversationGroup(conversationId));
    }

    public async Task SendMessage(SendMessageRequest request)
    {
        var session = GetSession();
        var content = request.Content?.Trim() ?? "";
        var clientMessageId = request.ClientMessageId?.Trim() ?? "";
        var messageType = request.MessageType?.Trim().ToLowerInvariant() ?? "text";

        if ((messageType == "text" && content.Length is < 1 or > 2000) ||
            clientMessageId.Length is < 1 or > 100)
        {
            throw new HubException("Messages must contain 1–2,000 characters.");
        }

        if (messageType is not ("text" or "location"))
        {
            throw new HubException("Choose a supported message type.");
        }

        var hasValidLocation =
            request.LocationLatitude is >= -90 and <= 90 &&
            request.LocationLongitude is >= -180 and <= 180;
        if (messageType == "location" && !hasValidLocation)
        {
            throw new HubException("Choose a valid location.");
        }

        await EnsureMembership(session.UserId, request.ConversationId);

        var existing = await db.Messages
            .AsNoTracking()
            .Where(x =>
                x.SenderUserId == session.UserId &&
                x.ClientMessageId == clientMessageId)
            .Select(x => new MessageDto(
                x.Id,
                x.ConversationId,
                x.SenderUserId,
                x.Sender == null ? null : x.Sender.Username,
                x.Sender == null ? null : x.Sender.AvatarUrl,
                x.DeletedAt == null ? x.Content : null,
                x.MessageType,
                x.ClientMessageId,
                x.SequenceNumber,
                x.ReplyToMessageId,
                x.CreatedAt,
                x.EditedAt,
                x.DeletedAt,
                null,
                null,
                x.LocationLatitude,
                x.LocationLongitude))
            .SingleOrDefaultAsync();

        if (existing is not null)
        {
            await Clients.Caller.SendAsync("MessageReceived", existing);
            return;
        }
        if (await DirectMessagingPolicy.IsBlockedAsync(
                db,
                session.UserId,
                request.ConversationId,
                Context.ConnectionAborted))
        {
            throw new HubException(
                "Messages cannot be sent while either user has blocked the other.");
        }

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);

        var conversation = await db.Conversations
            .SingleAsync(x => x.Id == request.ConversationId);
        var nextSequence = await db.Messages
            .Where(x => x.ConversationId == request.ConversationId)
            .Select(x => (long?)x.SequenceNumber)
            .MaxAsync() ?? 0;

        if (request.ReplyToMessageId is not null)
        {
            var replyExists = await db.Messages.AnyAsync(x =>
                x.Id == request.ReplyToMessageId &&
                x.ConversationId == request.ConversationId);
            if (!replyExists)
            {
                throw new HubException("The message being replied to no longer exists.");
            }
        }

        var message = new ChatMessage
        {
            ConversationId = request.ConversationId,
            Conversation = conversation,
            SenderUserId = session.UserId,
            MessageType = messageType,
            Content = messageType == "location" ? null : content,
            LocationLatitude =
                messageType == "location" ? request.LocationLatitude : null,
            LocationLongitude =
                messageType == "location" ? request.LocationLongitude : null,
            ClientMessageId = clientMessageId,
            SequenceNumber = nextSequence + 1,
            ReplyToMessageId = request.ReplyToMessageId
        };

        db.Messages.Add(message);
        conversation.LastMessage = message;
        conversation.LastMessageId = message.Id;
        conversation.LastMessageAt = message.CreatedAt;
        conversation.UpdatedAt = message.CreatedAt;

        await db.ConversationMembers
            .Where(x =>
                x.ConversationId == request.ConversationId &&
                x.UserId != session.UserId &&
                x.LeftAt == null)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(x => x.UnreadCount, x => x.UnreadCount + 1));

        await db.SaveChangesAsync();
        await transaction.CommitAsync();

        var result = new MessageDto(
            message.Id,
            message.ConversationId,
            session.UserId,
            session.Username,
            session.AvatarUrl,
            message.Content,
            message.MessageType,
            message.ClientMessageId,
            message.SequenceNumber,
            message.ReplyToMessageId,
            message.CreatedAt,
            null,
            null,
            null,
            null,
            message.LocationLatitude,
            message.LocationLongitude);

        await Clients.Group(ConversationGroup(request.ConversationId))
            .SendAsync("MessageReceived", result);
        await Clients.OthersInGroup(ConversationGroup(request.ConversationId))
            .SendAsync(
                "UserTyping",
                new TypingDto(request.ConversationId, session.Username, false));
        await pushNotifications.NotifyMessageAsync(
            request.ConversationId,
            session.UserId,
            session.DisplayName,
            messageType == "location" ? "Shared a location" : content,
            Context.ConnectionAborted);
    }

    public async Task<MessageDto> StartLiveLocation(
        StartLiveLocationRequest request)
    {
        var session = GetSession();
        var clientMessageId = request.ClientMessageId?.Trim() ?? "";
        if (clientMessageId.Length is < 1 or > 100 ||
            !IsValidLocation(
                request.Latitude,
                request.Longitude,
                request.AccuracyMeters) ||
            request.DurationMinutes is not (15 or 60 or 480))
        {
            throw new HubException("Choose a valid live location and duration.");
        }

        await EnsureMembership(session.UserId, request.ConversationId);
        if (await DirectMessagingPolicy.IsBlockedAsync(
                db,
                session.UserId,
                request.ConversationId,
                Context.ConnectionAborted))
        {
            throw new HubException(
                "Locations cannot be shared while either user has blocked the other.");
        }

        await using var transaction = await db.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            Context.ConnectionAborted);
        var now = DateTimeOffset.UtcNow;
        var expiredShares = await db.LiveLocationShares
            .Where(x =>
                x.ConversationId == request.ConversationId &&
                x.UserId == session.UserId &&
                x.IsActive &&
                x.ExpiresAt <= now)
            .ToListAsync(Context.ConnectionAborted);
        foreach (var expiredShare in expiredShares)
        {
            expiredShare.IsActive = false;
            expiredShare.StoppedAt = expiredShare.ExpiresAt;
        }

        if (await db.LiveLocationShares.AnyAsync(
                x =>
                    x.ConversationId == request.ConversationId &&
                    x.UserId == session.UserId &&
                    x.IsActive &&
                    x.ExpiresAt > now,
                Context.ConnectionAborted))
        {
            throw new HubException(
                "Stop your current live location before starting another.");
        }

        var conversation = await db.Conversations.SingleAsync(
            x => x.Id == request.ConversationId,
            Context.ConnectionAborted);
        var nextSequence = await db.Messages
            .Where(x => x.ConversationId == request.ConversationId)
            .Select(x => (long?)x.SequenceNumber)
            .MaxAsync(Context.ConnectionAborted) ?? 0;
        if (request.ReplyToMessageId is not null &&
            !await db.Messages.AnyAsync(
                x =>
                    x.Id == request.ReplyToMessageId &&
                    x.ConversationId == request.ConversationId,
                Context.ConnectionAborted))
        {
            throw new HubException(
                "The message being replied to no longer exists.");
        }

        var message = new ChatMessage
        {
            ConversationId = request.ConversationId,
            Conversation = conversation,
            SenderUserId = session.UserId,
            MessageType = "live_location",
            Content = null,
            ClientMessageId = clientMessageId,
            SequenceNumber = nextSequence + 1,
            ReplyToMessageId = request.ReplyToMessageId,
            CreatedAt = now
        };
        var share = new LiveLocationShare
        {
            MessageId = message.Id,
            Message = message,
            ConversationId = conversation.Id,
            Conversation = conversation,
            UserId = session.UserId,
            User = await db.Users.SingleAsync(
                x => x.Id == session.UserId,
                Context.ConnectionAborted),
            Latitude = request.Latitude,
            Longitude = request.Longitude,
            AccuracyMeters = request.AccuracyMeters,
            StartedAt = now,
            UpdatedAt = now,
            ExpiresAt = now.AddMinutes(request.DurationMinutes)
        };

        db.Messages.Add(message);
        db.LiveLocationShares.Add(share);
        conversation.LastMessage = message;
        conversation.LastMessageId = message.Id;
        conversation.LastMessageAt = now;
        conversation.UpdatedAt = now;
        await db.ConversationMembers
            .Where(x =>
                x.ConversationId == request.ConversationId &&
                x.UserId != session.UserId &&
                x.LeftAt == null)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(
                    x => x.UnreadCount,
                    x => x.UnreadCount + 1),
                Context.ConnectionAborted);
        await db.SaveChangesAsync(Context.ConnectionAborted);
        await transaction.CommitAsync(Context.ConnectionAborted);

        var liveLocation = ToDto(share);
        var result = new MessageDto(
            message.Id,
            message.ConversationId,
            session.UserId,
            session.Username,
            session.AvatarUrl,
            null,
            message.MessageType,
            message.ClientMessageId,
            message.SequenceNumber,
            message.ReplyToMessageId,
            message.CreatedAt,
            null,
            null,
            null,
            null,
            null,
            null,
            liveLocation);
        await Clients.Group(ConversationGroup(request.ConversationId))
            .SendAsync(
                "MessageReceived",
                result,
                Context.ConnectionAborted);
        await pushNotifications.NotifyMessageAsync(
            request.ConversationId,
            session.UserId,
            session.DisplayName,
            "Started sharing a live location",
            Context.ConnectionAborted);
        return result;
    }

    public async Task UpdateLiveLocation(UpdateLiveLocationRequest request)
    {
        var session = GetSession();
        if (!IsValidLocation(
                request.Latitude,
                request.Longitude,
                request.AccuracyMeters))
        {
            throw new HubException("Choose a valid live location.");
        }

        var share = await db.LiveLocationShares
            .Include(x => x.Message)
            .SingleOrDefaultAsync(
                x => x.MessageId == request.MessageId,
                Context.ConnectionAborted)
            ?? throw new HubException("Live location was not found.");
        if (share.UserId != session.UserId)
        {
            throw new HubException("You cannot update this live location.");
        }

        var now = DateTimeOffset.UtcNow;
        if (!share.IsActive || share.ExpiresAt <= now)
        {
            if (share.IsActive)
            {
                share.IsActive = false;
                share.StoppedAt = share.ExpiresAt;
                await db.SaveChangesAsync(Context.ConnectionAborted);
                await Clients.Group(ConversationGroup(share.ConversationId))
                    .SendAsync(
                        "LiveLocationStopped",
                        new LiveLocationStoppedDto(
                            share.MessageId,
                            share.ConversationId,
                            share.StoppedAt.Value),
                        Context.ConnectionAborted);
            }
            throw new HubException("Live location sharing has ended.");
        }

        share.Latitude = request.Latitude;
        share.Longitude = request.Longitude;
        share.AccuracyMeters = request.AccuracyMeters;
        share.UpdatedAt = now;
        await db.SaveChangesAsync(Context.ConnectionAborted);
        await Clients.Group(ConversationGroup(share.ConversationId))
            .SendAsync(
                "LiveLocationUpdated",
                ToDto(share),
                Context.ConnectionAborted);
    }

    public async Task StopLiveLocation(Guid messageId)
    {
        var session = GetSession();
        var share = await db.LiveLocationShares
            .SingleOrDefaultAsync(
                x => x.MessageId == messageId,
                Context.ConnectionAborted)
            ?? throw new HubException("Live location was not found.");
        if (share.UserId != session.UserId)
        {
            throw new HubException("You cannot stop this live location.");
        }
        if (!share.IsActive) return;

        share.IsActive = false;
        share.StoppedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(Context.ConnectionAborted);
        await Clients.Group(ConversationGroup(share.ConversationId))
            .SendAsync(
                "LiveLocationStopped",
                new LiveLocationStoppedDto(
                    share.MessageId,
                    share.ConversationId,
                    share.StoppedAt.Value),
                Context.ConnectionAborted);
    }

    public async Task SetTyping(Guid conversationId, bool isTyping)
    {
        var session = GetSession();
        await EnsureMembership(session.UserId, conversationId);
        if (await DirectMessagingPolicy.IsBlockedAsync(
                db,
                session.UserId,
                conversationId,
                Context.ConnectionAborted))
        {
            return;
        }
        await Clients.OthersInGroup(ConversationGroup(conversationId))
            .SendAsync(
                "UserTyping",
                new TypingDto(conversationId, session.Username, isTyping));
    }

    public async Task MarkRead(Guid conversationId, long sequenceNumber)
    {
        var session = GetSession();
        var membership = await db.ConversationMembers.FindAsync(conversationId, session.UserId)
            ?? throw new HubException("You are not a member of this conversation.");

        membership.LastReadSequence = Math.Max(membership.LastReadSequence, sequenceNumber);
        membership.LastReadAt = DateTimeOffset.UtcNow;
        membership.UnreadCount = 0;

        var message = await db.Messages
            .Where(x =>
                x.ConversationId == conversationId &&
                x.SequenceNumber <= sequenceNumber)
            .OrderByDescending(x => x.SequenceNumber)
            .FirstOrDefaultAsync();
        membership.LastReadMessageId = message?.Id;

        await db.SaveChangesAsync();
    }

    private PresenceTracker.Session GetSession() =>
        presence.Get(Context.ConnectionId)
        ?? throw new HubException("Your chat session is not active.");

    private async Task EnsureMembership(Guid userId, Guid conversationId)
    {
        var isMember = await db.ConversationMembers.AnyAsync(x =>
            x.ConversationId == conversationId &&
            x.UserId == userId &&
            x.LeftAt == null);
        if (!isMember)
        {
            throw new HubException("You are not a member of this conversation.");
        }
    }

    private async Task<ChatUser?> FindUser(string username)
    {
        if (!Username.IsValid(username))
        {
            logger.LogWarning("Rejected SignalR connection with an invalid username.");
            return null;
        }

        var normalized = Username.Normalize(username);
        return await db.Users.SingleOrDefaultAsync(x => x.NormalizedUsername == normalized);
    }

    public static string ConversationGroup(Guid conversationId) =>
        $"conversation:{conversationId:N}";

    private static bool IsValidLocation(
        decimal latitude,
        decimal longitude,
        decimal? accuracyMeters) =>
        latitude is >= -90 and <= 90 &&
        longitude is >= -180 and <= 180 &&
        (accuracyMeters is null or >= 0 and <= 10000);

    internal static LiveLocationDto ToDto(LiveLocationShare share) =>
        new(
            share.MessageId,
            share.ConversationId,
            share.UserId,
            share.Latitude,
            share.Longitude,
            share.AccuracyMeters,
            share.StartedAt,
            share.UpdatedAt,
            share.ExpiresAt,
            share.StoppedAt,
            share.IsActive);
}
