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
    CallStateTracker calls,
    GroupMeetingStateTracker meetings,
    RecordingStateTracker recordingStates,
    IServiceProvider services,
    AzurePushNotificationService pushNotifications,
    ILogger<ChatHub> logger) : Hub
{
    private const string UsernameQueryKey = "username";
    private ICallingProvider? CallingProvider =>
        services.GetService<ICallingProvider>();

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
            if (presence.ConnectionIdsForUser(session.UserId).Count == 0)
            {
                foreach (var stopped in recordingStates.Disconnect(session.UserId))
                {
                    var callingProvider = CallingProvider;
                    var recording = await db.SessionRecordings
                        .Include(item => item.StartedByUser)
                        .SingleOrDefaultAsync(item =>
                            item.Id == stopped.RecordingId);
                    if (recording is null ||
                        recording.Status is "completed" or "cancelled" or "failed")
                    {
                        continue;
                    }
                    if (callingProvider?.ManagesRecording == true &&
                        recording.Provider == callingProvider.Name &&
                        !string.IsNullOrWhiteSpace(
                            recording.ProviderRecordingId))
                    {
                        await callingProvider.StopRecordingAsync(
                            recording.ProviderRecordingId,
                            CancellationToken.None);
                        recording.Status = "processing";
                    }
                    else
                    {
                        recording.Status = "failed";
                        recording.CompletedAt = DateTimeOffset.UtcNow;
                    }
                    await db.SaveChangesAsync();
                    await Clients
                        .Group(ConversationGroup(recording.ConversationId))
                        .SendAsync(
                            recording.Status == "processing"
                                ? "RecordingStopped"
                                : "RecordingFailed",
                            recording.Status == "processing"
                                ? ToRecordingDto(recording)
                                : new
                            {
                                recording = ToRecordingDto(recording),
                                message =
                                    "Recording stopped because the recorder disconnected."
                            });
                    await SendMeetingSystemMessage(
                        recording.ConversationId,
                        "Recording stopped because the recorder disconnected.",
                        session.UserId,
                        CancellationToken.None);
                }

                foreach (var change in meetings.Disconnect(session.UserId))
                {
                    await Clients.Group(ConversationGroup(change.ConversationId))
                        .SendAsync(
                            "GroupMeetingChanged",
                            new GroupMeetingChangedDto(
                                change.ConversationId,
                                change.Meeting is null
                                    ? null
                                    : ToDto(change.Meeting)));
                    await SendMeetingSystemMessage(
                        change.ConversationId,
                        $"{session.DisplayName} left the meeting.",
                        session.UserId,
                        CancellationToken.None);
                    if (change.AutoStopped)
                    {
                        await SendMeetingSystemMessage(
                            change.ConversationId,
                            "The meeting stopped automatically because the last participant left.",
                            session.UserId,
                            CancellationToken.None);
                    }
                }
                var endedCalls = calls.EndCallsForUser(session.UserId);
                foreach (var call in endedCalls)
                {
                    var remainingUserId =
                        call.InitiatorUserId == session.UserId
                            ? call.PeerUserId
                            : call.InitiatorUserId;
                    await Clients.Clients(
                            presence.ConnectionIdsForUser(remainingUserId))
                        .SendAsync(
                            "CallEnded",
                            new CallEndedDto(
                                call.CallId,
                                call.ConversationId,
                                session.UserId,
                                "ended"));
                }
            }
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

    public async Task StartCall(StartCallRequest request)
    {
        var session = GetSession();
        if (request.CallId == Guid.Empty)
        {
            throw new HubException("Choose a valid call.");
        }

        var target = await EnsureDirectPeer(
            session.UserId,
            request.ConversationId,
            request.TargetUserId);
        if (await DirectMessagingPolicy.IsBlockedAsync(
                db,
                session.UserId,
                request.ConversationId,
                Context.ConnectionAborted))
        {
            throw new HubException(
                "Calls cannot be started while either user has blocked the other.");
        }
        if (meetings.HasParticipant(session.UserId) ||
            meetings.HasParticipant(target.Id))
        {
            throw new HubException(
                "A direct call cannot be started while either person is in a meeting.");
        }

        var targetConnections = presence.ConnectionIdsForUser(target.Id);
        if (targetConnections.Count == 0)
        {
            throw new HubException($"{target.DisplayName} is not online.");
        }

        calls.StartCall(
            request.CallId,
            request.ConversationId,
            session.UserId,
            target.Id);
        await Clients.Clients(targetConnections).SendAsync(
            "CallIncoming",
            new IncomingCallDto(
                request.CallId,
                request.ConversationId,
                session.UserId,
                session.Username,
                session.DisplayName,
                session.AvatarUrl,
                request.HasVideo),
            Context.ConnectionAborted);
    }

    public async Task RespondToCall(RespondToCallRequest request)
    {
        var session = GetSession();
        var initiator = await EnsureDirectPeer(
            session.UserId,
            request.ConversationId,
            request.InitiatorUserId);
        try
        {
            calls.Respond(request.CallId, session.UserId, request.Accepted);
        }
        catch (InvalidOperationException exception)
        {
            throw new HubException(exception.Message);
        }

        await Clients.Clients(presence.ConnectionIdsForUser(initiator.Id)).SendAsync(
            request.Accepted ? "CallAccepted" : "CallDeclined",
            new CallResponseDto(
                request.CallId,
                request.ConversationId,
                session.UserId,
                session.DisplayName,
                request.Accepted),
            Context.ConnectionAborted);
    }

    public async Task SendCallSignal(SendCallSignalRequest request)
    {
        var session = GetSession();
        var signalType = request.SignalType.Trim().ToLowerInvariant();
        if (signalType is not ("offer" or "answer" or "ice") ||
            string.IsNullOrWhiteSpace(request.Payload) ||
            request.Payload.Length > 24_000)
        {
            throw new HubException("Choose a valid call signal.");
        }

        var target = await EnsureDirectPeer(
            session.UserId,
            request.ConversationId,
            request.TargetUserId);
        await Clients.Clients(presence.ConnectionIdsForUser(target.Id)).SendAsync(
            "CallSignal",
            new CallSignalDto(
                request.CallId,
                request.ConversationId,
                session.UserId,
                signalType,
                request.Payload),
            Context.ConnectionAborted);
    }

    public async Task EndCall(EndCallRequest request)
    {
        var session = GetSession();
        var target = await EnsureDirectPeer(
            session.UserId,
            request.ConversationId,
            request.TargetUserId);
        var reason = request.Reason.Trim().ToLowerInvariant();
        if (reason is not ("ended" or "cancelled" or "failed"))
        {
            reason = "ended";
        }

        calls.EndCall(request.CallId);
        await Clients.Clients(presence.ConnectionIdsForUser(target.Id)).SendAsync(
            "CallEnded",
            new CallEndedDto(
                request.CallId,
                request.ConversationId,
                session.UserId,
                reason),
            Context.ConnectionAborted);
    }

    public async Task StartScreenShare(CallScreenShareRequest request)
    {
        var session = GetSession();
        var target = await EnsureDirectPeer(
            session.UserId,
            request.ConversationId,
            request.TargetUserId);
        var previous = calls.StartScreenShare(
            request.CallId,
            request.ConversationId,
            session.UserId,
            target.Id);

        if (previous is not null)
        {
            await Clients.Clients(
                    presence.ConnectionIdsForUser(previous.OwnerUserId))
                .SendAsync(
                    "CallScreenShareTakenOver",
                    new CallScreenShareTakenOverDto(
                        request.CallId,
                        request.ConversationId,
                        session.UserId),
                    Context.ConnectionAborted);
        }

        await Clients.Clients(presence.ConnectionIdsForUser(target.Id)).SendAsync(
            "CallScreenShareChanged",
            new CallScreenShareChangedDto(
                request.CallId,
                request.ConversationId,
                session.UserId,
                true),
            Context.ConnectionAborted);
    }

    public async Task StopScreenShare(CallScreenShareRequest request)
    {
        var session = GetSession();
        var target = await EnsureDirectPeer(
            session.UserId,
            request.ConversationId,
            request.TargetUserId);
        if (!calls.StopScreenShare(request.CallId, session.UserId))
        {
            return;
        }

        await Clients.Clients(presence.ConnectionIdsForUser(target.Id)).SendAsync(
            "CallScreenShareChanged",
            new CallScreenShareChangedDto(
                request.CallId,
                request.ConversationId,
                session.UserId,
                false),
            Context.ConnectionAborted);
    }

    public async Task SetCallMicrophoneState(
        CallMicrophoneStateRequest request)
    {
        var session = GetSession();
        var target = await EnsureDirectPeer(
            session.UserId,
            request.ConversationId,
            request.TargetUserId);

        await Clients.Clients(presence.ConnectionIdsForUser(target.Id)).SendAsync(
            "CallMicrophoneStateChanged",
            new CallMicrophoneStateDto(
                request.CallId,
                request.ConversationId,
                session.UserId,
                request.IsMuted),
            Context.ConnectionAborted);
    }

    public async Task<GroupMeetingDto?> GetGroupMeeting(Guid conversationId)
    {
        var session = GetSession();
        await EnsureMembership(session.UserId, conversationId);
        var meeting = meetings.Get(conversationId);
        return meeting is null ? null : ToDto(meeting);
    }

    public async Task<GroupMeetingDto> StartGroupMeeting(Guid conversationId)
    {
        var session = GetSession();
        await EnsureMembership(session.UserId, conversationId);
        EnsureUserIsNotInDirectCall(session.UserId);
        var change = meetings.Start(
            conversationId,
            session.UserId,
            session.DisplayName,
            session.AvatarUrl);
        var dto = ToDto(change.Meeting);
        await BroadcastMeeting(conversationId, dto);
        if (change.Created)
        {
            await SendMeetingSystemMessage(
                conversationId,
                $"{session.DisplayName} started a meeting.",
                session.UserId);
        }
        return dto;
    }

    public async Task<GroupMeetingDto> JoinGroupMeeting(Guid conversationId)
    {
        var session = GetSession();
        await EnsureMembership(session.UserId, conversationId);
        EnsureUserIsNotInDirectCall(session.UserId);
        GroupMeetingStateTracker.MeetingParticipantChange change;
        try
        {
            change = meetings.Join(
                conversationId,
                session.UserId,
                session.DisplayName,
                session.AvatarUrl);
        }
        catch (InvalidOperationException exception)
        {
            throw new HubException(exception.Message);
        }

        var dto = ToDto(
            change.Meeting
            ?? throw new HubException("The meeting has ended."));
        RecordingStateTracker.RecordingSnapshot? recording = null;
        if (change.Changed)
        {
            recording = recordingStates.AddParticipant(
                dto.MeetingId,
                session.UserId);
        }
        await BroadcastMeeting(conversationId, dto);
        if (change.Changed)
        {
            if (recording is not null)
            {
                await Clients.Caller.SendAsync(
                    "RequestRecordingConsent",
                    new RecordingConsentRequestedDto(
                        ToRecordingDto(recording),
                        true),
                    Context.ConnectionAborted);
            }
            await SendMeetingSystemMessage(
                conversationId,
                $"{session.DisplayName} joined the meeting.",
                session.UserId);
        }
        return dto;
    }

    public async Task<GroupMeetingDto?> LeaveGroupMeeting(Guid conversationId)
    {
        var session = GetSession();
        await EnsureMembership(session.UserId, conversationId);
        var change = meetings.Leave(conversationId, session.UserId);
        var dto = change.Meeting is null ? null : ToDto(change.Meeting);
        await BroadcastMeeting(conversationId, dto);
        if (change.Changed)
        {
            await SendMeetingSystemMessage(
                conversationId,
                $"{session.DisplayName} left the meeting.",
                session.UserId);
        }
        if (change.AutoStopped)
        {
            await SendMeetingSystemMessage(
                conversationId,
                "The meeting stopped automatically because the last participant left.",
                session.UserId);
        }
        return dto;
    }

    public async Task StopGroupMeeting(Guid conversationId)
    {
        var session = GetSession();
        await EnsureMembership(session.UserId, conversationId);
        try
        {
            if (!meetings.Stop(conversationId, session.UserId))
            {
                return;
            }
        }
        catch (InvalidOperationException exception)
        {
            throw new HubException(exception.Message);
        }

        await BroadcastMeeting(conversationId, null);
        await SendMeetingSystemMessage(
            conversationId,
            $"{session.DisplayName} stopped the meeting.",
            session.UserId);
    }

    public async Task SendGroupMeetingSignal(
        SendGroupMeetingSignalRequest request)
    {
        var session = GetSession();
        var signalType = request.SignalType.Trim().ToLowerInvariant();
        if (signalType is not ("offer" or "answer" or "ice") ||
            string.IsNullOrWhiteSpace(request.Payload) ||
            request.Payload.Length > 24_000)
        {
            throw new HubException("Choose a valid meeting signal.");
        }

        await EnsureMembership(session.UserId, request.ConversationId);
        if (!meetings.HasParticipant(
                request.ConversationId,
                request.MeetingId,
                session.UserId) ||
            !meetings.HasParticipant(
                request.ConversationId,
                request.MeetingId,
                request.TargetUserId))
        {
            throw new HubException(
                "Meeting signals can only be sent between participants.");
        }
        if (!recordingStates.HasConsent(
                request.MeetingId,
                session.UserId) ||
            !recordingStates.HasConsent(
                request.MeetingId,
                request.TargetUserId))
        {
            throw new HubException(
                "Recording consent is required before receiving meeting media.");
        }

        await Clients.Clients(
                presence.ConnectionIdsForUser(request.TargetUserId))
            .SendAsync(
                "GroupMeetingSignal",
                new GroupMeetingSignalDto(
                    request.MeetingId,
                    request.ConversationId,
                    session.UserId,
                    signalType,
                    request.Payload),
                Context.ConnectionAborted);
    }

    public async Task SetGroupMeetingMicrophoneState(
        GroupMeetingMicrophoneStateRequest request)
    {
        var session = GetSession();
        await EnsureMembership(session.UserId, request.ConversationId);
        GroupMeetingStateTracker.MeetingSnapshot meeting;
        try
        {
            meeting = meetings.SetMicrophoneState(
                request.ConversationId,
                request.MeetingId,
                session.UserId,
                request.IsMuted);
        }
        catch (InvalidOperationException exception)
        {
            throw new HubException(exception.Message);
        }

        await BroadcastMeeting(request.ConversationId, ToDto(meeting));
    }

    public async Task StartGroupMeetingScreenShare(
        GroupMeetingScreenShareRequest request)
    {
        var session = GetSession();
        await EnsureMembership(session.UserId, request.ConversationId);
        GroupMeetingStateTracker.ScreenShareChange change;
        try
        {
            change = meetings.StartScreenShare(
                request.ConversationId,
                request.MeetingId,
                session.UserId);
        }
        catch (InvalidOperationException exception)
        {
            throw new HubException(exception.Message);
        }

        if (change.PreviousOwnerUserId is Guid previousOwnerUserId)
        {
            await Clients.Clients(
                    presence.ConnectionIdsForUser(previousOwnerUserId))
                .SendAsync(
                    "GroupMeetingScreenShareTakenOver",
                    new GroupMeetingScreenShareTakenOverDto(
                        request.MeetingId,
                        request.ConversationId,
                        session.UserId),
                    Context.ConnectionAborted);
        }
        await BroadcastMeeting(
            request.ConversationId,
            ToDto(change.Meeting));
    }

    public async Task StopGroupMeetingScreenShare(
        GroupMeetingScreenShareRequest request)
    {
        var session = GetSession();
        await EnsureMembership(session.UserId, request.ConversationId);
        GroupMeetingStateTracker.MeetingSnapshot meeting;
        try
        {
            meeting = meetings.StopScreenShare(
                request.ConversationId,
                request.MeetingId,
                session.UserId);
        }
        catch (InvalidOperationException exception)
        {
            throw new HubException(exception.Message);
        }

        await BroadcastMeeting(request.ConversationId, ToDto(meeting));
    }

    public async Task RequestRecordingConsent(Guid recordingId)
    {
        var session = GetSession();
        var recording = await db.SessionRecordings
            .Include(item => item.StartedByUser)
            .SingleOrDefaultAsync(
                item => item.Id == recordingId,
                Context.ConnectionAborted)
            ?? throw new HubException("The recording was not found.");
        if (recording.StartedByUserId != session.UserId ||
            recording.Status != "requesting-consent")
        {
            throw new HubException(
                "Only the recorder can request consent.");
        }

        IReadOnlyCollection<Guid> participantIds;
        if (recording.SessionType == "direct")
        {
            var call = calls.Get(recording.SessionId);
            if (call is null ||
                call.ConversationId != recording.ConversationId ||
                (call.InitiatorUserId != session.UserId &&
                 call.PeerUserId != session.UserId))
            {
                throw new HubException("The direct call is no longer active.");
            }
            participantIds = [call.InitiatorUserId, call.PeerUserId];
        }
        else
        {
            var meeting = meetings.Get(recording.ConversationId);
            if (meeting is null ||
                meeting.MeetingId != recording.SessionId ||
                !meeting.Participants.Any(item =>
                    item.UserId == session.UserId))
            {
                throw new HubException("The meeting is no longer active.");
            }
            participantIds = meeting.Participants
                .Select(item => item.UserId)
                .ToArray();
        }

        RecordingStateTracker.RecordingSnapshot state;
        try
        {
            state = recordingStates.Begin(
                recording.Id,
                recording.ConversationId,
                recording.SessionId,
                recording.SessionType,
                session.UserId,
                session.DisplayName,
                participantIds);
        }
        catch (InvalidOperationException exception)
        {
            throw new HubException(exception.Message);
        }

        var recorderConsent = recordingStates.Respond(
            recording.Id,
            session.UserId,
            true);
        state = recorderConsent.Recording;
        if (recorderConsent.Started)
        {
            await StartCallingProviderRecording(recording);
            recording.Status = "recording";
            recording.StartedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(Context.ConnectionAborted);
            await Clients
                .Group(ConversationGroup(recording.ConversationId))
                .SendAsync(
                    "RecordingStarted",
                    ToRecordingDto(recording),
                    Context.ConnectionAborted);
            await SendMeetingSystemMessage(
                recording.ConversationId,
                $"{recording.StartedByUser.DisplayName} started recording.",
                recording.StartedByUserId);
            return;
        }

        var request = new RecordingConsentRequestedDto(
            ToRecordingDto(state),
            false);
        foreach (var participantId in participantIds.Where(
                     participantId => participantId != session.UserId))
        {
            await Clients
                .Clients(presence.ConnectionIdsForUser(participantId))
                .SendAsync(
                    "RequestRecordingConsent",
                    request,
                    Context.ConnectionAborted);
        }
        await SendMeetingSystemMessage(
            recording.ConversationId,
            $"{session.DisplayName} requested permission to record.",
            session.UserId);
    }

    public async Task<ActiveRecordingDto?> GetActiveRecording(Guid sessionId)
    {
        var session = GetSession();
        var recording = recordingStates.GetForSession(sessionId);
        if (recording is null)
        {
            return null;
        }
        await EnsureMembership(session.UserId, recording.ConversationId);
        if (!recording.RequiredConsentUserIds.Contains(session.UserId))
        {
            return null;
        }
        return new ActiveRecordingDto(
            ToRecordingDto(recording),
            !recording.AcceptedUserIds.Contains(session.UserId));
    }

    public async Task RespondToRecordingConsent(
        RecordingConsentResponseRequest request)
    {
        var session = GetSession();
        var recording = await db.SessionRecordings
            .Include(item => item.StartedByUser)
            .SingleOrDefaultAsync(
                item => item.Id == request.RecordingId,
                Context.ConnectionAborted)
            ?? throw new HubException("The recording was not found.");
        await EnsureMembership(session.UserId, recording.ConversationId);

        RecordingStateTracker.ConsentChange change;
        try
        {
            change = recordingStates.Respond(
                recording.Id,
                session.UserId,
                request.Accepted);
        }
        catch (InvalidOperationException exception)
        {
            throw new HubException(exception.Message);
        }

        if (change.ParticipantDeclined)
        {
            await Clients.Caller.SendAsync(
                "RecordingConsentDeclined",
                ToRecordingDto(change.Recording),
                Context.ConnectionAborted);
            return;
        }

        if (change.Declined)
        {
            recording.Status = "cancelled";
            recording.CompletedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(Context.ConnectionAborted);
            await Clients
                .Group(ConversationGroup(recording.ConversationId))
                .SendAsync(
                    "RecordingFailed",
                    new
                    {
                        recording = ToRecordingDto(recording),
                        message =
                            $"{session.DisplayName} declined recording consent."
                    },
                    Context.ConnectionAborted);
            await SendMeetingSystemMessage(
                recording.ConversationId,
                $"{session.DisplayName} declined recording consent.",
                session.UserId);
            return;
        }

        if (change.Started)
        {
            await StartCallingProviderRecording(recording);
            recording.Status = "recording";
            recording.StartedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(Context.ConnectionAborted);
            await Clients
                .Group(ConversationGroup(recording.ConversationId))
                .SendAsync(
                    "RecordingStarted",
                    ToRecordingDto(recording),
                    Context.ConnectionAborted);
            await SendMeetingSystemMessage(
                recording.ConversationId,
                $"{recording.StartedByUser.DisplayName} started recording.",
                recording.StartedByUserId);
        }
        else if (request.Accepted && recording.Status == "recording")
        {
            await Clients.Caller.SendAsync(
                "RecordingStarted",
                ToRecordingDto(recording),
                Context.ConnectionAborted);
        }
    }

    public async Task StopRecording(Guid recordingId)
    {
        var session = GetSession();
        var recording = await db.SessionRecordings
            .Include(item => item.StartedByUser)
            .SingleOrDefaultAsync(
                item => item.Id == recordingId,
                Context.ConnectionAborted)
            ?? throw new HubException("The recording was not found.");
        await EnsureMembership(session.UserId, recording.ConversationId);
        var isOwner = recording.SessionType == "meeting" &&
            await db.ConversationMembers.AnyAsync(
                member =>
                    member.ConversationId == recording.ConversationId &&
                    member.UserId == session.UserId &&
                    member.LeftAt == null &&
                    member.Role == "owner",
                Context.ConnectionAborted);
        if (recording.StartedByUserId != session.UserId && !isOwner)
        {
            throw new HubException(
                "Only the recorder or group owner can stop recording.");
        }
        if (recording.Status != "recording")
        {
            return;
        }

        var callingProvider = CallingProvider;
        if (callingProvider?.ManagesRecording == true &&
            recording.Provider == callingProvider.Name)
        {
            if (string.IsNullOrWhiteSpace(recording.ProviderRecordingId))
            {
                throw new HubException(
                    "The provider recording identifier is missing.");
            }
            await callingProvider.StopRecordingAsync(
                recording.ProviderRecordingId,
                Context.ConnectionAborted);
            recording.Status = "processing";
            await db.SaveChangesAsync(Context.ConnectionAborted);
            recordingStates.Stop(recording.Id);
            await Clients
                .Group(ConversationGroup(recording.ConversationId))
                .SendAsync(
                    "RecordingStopped",
                    ToRecordingDto(recording),
                    Context.ConnectionAborted);
            await SendMeetingSystemMessage(
                recording.ConversationId,
                $"{recording.StartedByUser.DisplayName} stopped the recording. Processing…",
                session.UserId);
            return;
        }

        await Clients
            .Clients(presence.ConnectionIdsForUser(recording.StartedByUserId))
            .SendAsync(
                "RecordingStopRequested",
                ToRecordingDto(recording),
                Context.ConnectionAborted);
    }

    private async Task StartCallingProviderRecording(
        SessionRecording recording)
    {
        var callingProvider = CallingProvider;
        if (callingProvider is null ||
            !callingProvider.ManagesRecording ||
            recording.Provider != callingProvider.Name)
        {
            return;
        }
        if (string.IsNullOrWhiteSpace(recording.ProviderCallLocator))
        {
            throw new HubException(
                "The provider call is not ready for recording.");
        }
        if (!string.IsNullOrWhiteSpace(recording.ProviderRecordingId))
        {
            return;
        }
        try
        {
            recording.ProviderRecordingId =
                await callingProvider.StartRecordingAsync(
                    recording.ProviderCallLocator,
                    Context.ConnectionAborted);
        }
        catch (Exception exception)
        {
            logger.LogError(
                exception,
                "Provider recording could not start for session {SessionId}.",
                recording.SessionId);
            recording.Status = "failed";
            recording.CompletedAt = DateTimeOffset.UtcNow;
            recordingStates.Stop(recording.Id);
            await db.SaveChangesAsync(CancellationToken.None);
            await Clients
                .Group(ConversationGroup(recording.ConversationId))
                .SendAsync(
                    "RecordingFailed",
                    new
                    {
                        recording = ToRecordingDto(recording),
                        message = "The calling provider could not start recording."
                    },
                    CancellationToken.None);
            await SendMeetingSystemMessage(
                recording.ConversationId,
                "The calling provider could not start recording.",
                recording.StartedByUserId,
                CancellationToken.None);
            throw new HubException(
                "The calling provider could not start recording.");
        }
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

    private void EnsureUserIsNotInDirectCall(Guid userId)
    {
        if (calls.HasActiveCallForUser(userId))
        {
            throw new HubException(
                "Leave or end the direct call before starting or joining a meeting.");
        }
    }

    private async Task SendMeetingSystemMessage(
        Guid conversationId,
        string content,
        Guid? actorUserId,
        CancellationToken cancellationToken = default)
    {
        await using var transaction =
            await db.Database.BeginTransactionAsync(
                IsolationLevel.Serializable,
                cancellationToken);
        var conversation = await db.Conversations.SingleAsync(
            x => x.Id == conversationId,
            cancellationToken);
        var nextSequence = await db.Messages
            .Where(x => x.ConversationId == conversationId)
            .Select(x => (long?)x.SequenceNumber)
            .MaxAsync(cancellationToken) ?? 0;
        var now = DateTimeOffset.UtcNow;
        var message = new ChatMessage
        {
            ConversationId = conversationId,
            Conversation = conversation,
            MessageType = "system",
            Content = content,
            SequenceNumber = nextSequence + 1,
            CreatedAt = now
        };

        db.Messages.Add(message);
        conversation.LastMessage = message;
        conversation.LastMessageId = message.Id;
        conversation.LastMessageAt = now;
        conversation.UpdatedAt = now;

        await db.ConversationMembers
            .Where(member =>
                member.ConversationId == conversationId &&
                member.LeftAt == null &&
                (actorUserId == null || member.UserId != actorUserId))
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(
                    member => member.UnreadCount,
                    member => member.UnreadCount + 1),
                cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        await Clients.Group(ConversationGroup(conversationId)).SendAsync(
            "MessageReceived",
            new MessageDto(
                message.Id,
                conversationId,
                null,
                null,
                null,
                message.Content,
                message.MessageType,
                null,
                message.SequenceNumber,
                null,
                message.CreatedAt,
                null,
                null),
            cancellationToken);
    }

    private Task BroadcastMeeting(
        Guid conversationId,
        GroupMeetingDto? meeting) =>
        Clients.Group(ConversationGroup(conversationId)).SendAsync(
            "GroupMeetingChanged",
            new GroupMeetingChangedDto(conversationId, meeting),
            Context.ConnectionAborted);

    private async Task<ChatUser> EnsureDirectPeer(
        Guid userId,
        Guid conversationId,
        Guid targetUserId)
    {
        if (targetUserId == userId)
        {
            throw new HubException("Calls require another participant.");
        }

        var isMember = await db.ConversationMembers.AnyAsync(x =>
            x.ConversationId == conversationId &&
            x.UserId == userId &&
            x.LeftAt == null &&
            x.Conversation.Type == "direct");
        if (!isMember)
        {
            throw new HubException("Calls are only available in direct conversations.");
        }

        return await db.ConversationMembers
            .Where(x =>
                x.ConversationId == conversationId &&
                x.UserId == targetUserId &&
                x.LeftAt == null)
            .Select(x => x.User)
            .SingleOrDefaultAsync()
            ?? throw new HubException("The call participant was not found.");
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

    private static GroupMeetingDto ToDto(
        GroupMeetingStateTracker.MeetingSnapshot meeting) =>
        new(
            meeting.MeetingId,
            meeting.ConversationId,
            meeting.StartedByUserId,
            meeting.StartedByDisplayName,
            meeting.StartedAt,
            meeting.ScreenSharingUserId,
            meeting.Participants
                .Select(participant => new GroupMeetingParticipantDto(
                    participant.UserId,
                    participant.DisplayName,
                    participant.AvatarUrl,
                    participant.JoinedAt,
                    participant.IsMuted))
                .ToArray());

    private static RecordingStateDto ToRecordingDto(
        SessionRecording recording) =>
        new(
            recording.Id,
            recording.ConversationId,
            recording.SessionId,
            recording.StartedByUserId,
            recording.StartedByUser.DisplayName,
            recording.StartedAt,
            recording.Status);

    private static RecordingStateDto ToRecordingDto(
        RecordingStateTracker.RecordingSnapshot recording) =>
        new(
            recording.RecordingId,
            recording.ConversationId,
            recording.SessionId,
            recording.RecorderUserId,
            recording.RecorderDisplayName,
            recording.StartedAt,
            recording.Status);

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
