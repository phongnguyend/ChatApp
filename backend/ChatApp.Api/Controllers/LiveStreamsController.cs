using System.Data;
using ChatApp.Api.Contracts;
using ChatApp.Api.Data;
using ChatApp.Api.Hubs;
using ChatApp.Api.Models;
using ChatApp.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Controllers;

[ApiController]
[Route("api/live-streams")]
public sealed class LiveStreamsController(
    ChatDbContext db,
    IHubContext<ChatHub> hubContext,
    IServiceProvider services,
    ILogger<LiveStreamsController> logger) : ControllerBase
{
    [HttpGet("active")]
    public async Task<ActionResult<IReadOnlyList<LiveStreamDto>>> GetActive(
        [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var user = await FindUser(username, cancellationToken);
        if (user is null) return NotFound();

        var sessions = await BaseQuery()
            .Where(x => x.EndedAt == null)
            .OrderByDescending(x => x.StartedAt)
            .ToListAsync(cancellationToken);
        var hostIds = sessions.Select(x => x.HostUserId).Distinct().ToArray();
        var callingIdentities = await db.CallingProviderIdentities
            .AsNoTracking()
            .Where(x =>
                hostIds.Contains(x.UserId) &&
                x.Provider == "azure-communication-services")
            .ToDictionaryAsync(
                x => x.UserId,
                x => x.ExternalIdentity,
                cancellationToken);
        return Ok(sessions.Select(x => ToDto(x, user.Id) with
        {
            HostCommunicationUserId = callingIdentities.GetValueOrDefault(
                x.HostUserId)
        }).ToArray());
    }

    [HttpGet("joined")]
    public async Task<ActionResult<IReadOnlyList<LiveStreamDto>>> GetJoined(
        [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var user = await FindUser(username, cancellationToken);
        if (user is null) return NotFound();

        var conversations = await db.Conversations
            .AsNoTracking()
            .Where(x =>
                x.Type == "live_stream" &&
                (x.CreatedByUserId == user.Id || x.Members.Any(member =>
                    member.UserId == user.Id && member.LeftAt == null)))
            .Include(x => x.CreatedByUser)
            .Include(x => x.Members)
            .Include(x => x.LiveStreamSessions)
            .OrderByDescending(x => x.UpdatedAt)
            .ToListAsync(cancellationToken);

        return Ok(conversations
            .SelectMany(x => x.LiveStreamSessions.Count == 0
                ? [ToDto(x, null, user.Id)]
                : x.LiveStreamSessions
                    .OrderByDescending(item => item.StartedAt)
                    .Select(session => ToDto(x, session, user.Id)))
            .OrderByDescending(x => x.StartedAt)
            .ToArray());
    }

    [HttpPost]
    public async Task<ActionResult<LiveStreamDto>> Create(
        [FromQuery] string username,
        CreateLiveStreamRequest request,
        CancellationToken cancellationToken)
    {
        var title = request.Title?.Trim() ?? "";
        if (title.Length is < 2 or > 200)
        {
            return BadRequest(new { message = "Live stream names must contain 2–200 characters." });
        }
        var user = await FindUser(username, cancellationToken);
        if (user is null) return NotFound();

        var conversation = new Conversation
        {
            Type = "live_stream",
            Title = title,
            CreatedByUser = user,
            CreatedByUserId = user.Id
        };
        conversation.Members.Add(new ConversationMember
        {
            Conversation = conversation,
            User = user,
            UserId = user.Id,
            Role = "owner"
        });
        db.Conversations.Add(conversation);
        await db.SaveChangesAsync(cancellationToken);
        return CreatedAtAction(
            nameof(GetJoined),
            new { username },
            ToDto(conversation, null, user.Id));
    }

    [HttpPost("{conversationId:guid}/start")]
    public async Task<ActionResult<LiveStreamDto>> Start(
        Guid conversationId,
        [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var user = await FindUser(username, cancellationToken);
        if (user is null) return NotFound();
        if (services.GetService<ICallingProvider>() is not
                { ManagesMedia: true, ManagesRecording: true } provider ||
            provider.Name != "azure-communication-services")
        {
            return Problem(
                statusCode: StatusCodes.Status503ServiceUnavailable,
                detail: "Azure Communication Services calling is not configured.");
        }
        // Ensure the host has a stable ACS identity before the stream is listed,
        // so viewers can render media from the host identity only.
        await provider.GetAccessCredentialAsync(user, cancellationToken);

        await using var transaction = await db.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);
        var conversation = await db.Conversations
            .Include(x => x.CreatedByUser)
            .Include(x => x.Members)
            .SingleOrDefaultAsync(x => x.Id == conversationId, cancellationToken);
        if (conversation is null || conversation.Type != "live_stream") return NotFound();
        if (conversation.CreatedByUserId != user.Id) return Forbid();

        if (await db.LiveStreamSessions.AnyAsync(
                x => x.HostUserId == user.Id && x.EndedAt == null,
                cancellationToken))
        {
            return Conflict(new { message = "You already have an active live stream. Stop it before starting another." });
        }

        var sessionId = Guid.NewGuid();
        var session = new LiveStreamSession
        {
            Id = sessionId,
            Conversation = conversation,
            ConversationId = conversation.Id,
            HostUser = user,
            HostUserId = user.Id,
            Provider = provider.Name,
            ProviderCallId = sessionId.ToString()
        };
        db.LiveStreamSessions.Add(session);
        ChatMessage systemMessage;
        try
        {
            systemMessage = await AddSystemMessage(
                conversation,
                $"{user.DisplayName} started the live stream.",
                user.Id,
                cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            return Conflict(new { message = "This host or live stream is already active." });
        }

        await transaction.CommitAsync(cancellationToken);

        await NotifyChanged(cancellationToken);
        await BroadcastSystemMessage(systemMessage, cancellationToken);
        return Ok(ToDto(conversation, session, user.Id));
    }

    [HttpPost("{conversationId:guid}/stop")]
    public async Task<ActionResult<LiveStreamDto>> Stop(
        Guid conversationId,
        [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var user = await FindUser(username, cancellationToken);
        if (user is null) return NotFound();
        await using var transaction = await db.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);
        var session = await BaseQuery().SingleOrDefaultAsync(
            x => x.ConversationId == conversationId && x.EndedAt == null,
            cancellationToken);
        if (session is null) return NotFound();
        if (session.HostUserId != user.Id) return Forbid();

        var recording = await db.SessionRecordings.SingleOrDefaultAsync(
            item =>
                item.SessionId == session.Id &&
                item.SessionType == "live_stream" &&
                item.Status == "recording",
            cancellationToken);
        ICallingProvider? provider = null;
        if (recording is not null)
        {
            if (services.GetService<ICallingProvider>() is not
                    { ManagesRecording: true } resolvedProvider ||
                resolvedProvider.Name != recording.Provider ||
                string.IsNullOrWhiteSpace(recording.ProviderRecordingId))
            {
                return Problem(
                    statusCode: StatusCodes.Status503ServiceUnavailable,
                    detail: "The live stream recording cannot be stopped right now.");
            }
            provider = resolvedProvider;
        }

        var now = DateTimeOffset.UtcNow;
        session.EndedAt = now;
        if (recording is not null) recording.Status = "processing";
        var systemMessage = await AddSystemMessage(
            session.Conversation,
            $"{user.DisplayName} stopped the live stream.",
            user.Id,
            cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        try
        {
            if (recording is not null)
            {
                await provider!.StopRecordingAsync(
                    recording.ProviderRecordingId!,
                    cancellationToken);
            }
            await transaction.CommitAsync(CancellationToken.None);
        }
        catch (Exception exception)
        {
            logger.LogError(
                exception,
                "Recording could not stop for live stream session {SessionId}.",
                session.Id);
            return Problem(
                statusCode: StatusCodes.Status502BadGateway,
                detail: "The live stream recording could not be stopped.");
        }
        await NotifyChanged(cancellationToken);
        await BroadcastSystemMessage(systemMessage, cancellationToken);
        return Ok(ToDto(session, user.Id));
    }

    [HttpPost("{conversationId:guid}/join")]
    public async Task<ActionResult<LiveStreamDto>> Join(
        Guid conversationId,
        [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var user = await FindUser(username, cancellationToken);
        if (user is null) return NotFound();
        var session = await BaseQuery().SingleOrDefaultAsync(
            x => x.ConversationId == conversationId && x.EndedAt == null,
            cancellationToken);
        if (session is null) return NotFound(new { message = "The live stream has ended." });

        var membership = session.Conversation.Members.SingleOrDefault(x => x.UserId == user.Id);
        if (membership is null)
        {
            session.Conversation.Members.Add(new ConversationMember
            {
                Conversation = session.Conversation,
                User = user,
                UserId = user.Id,
                Role = "member"
            });
        }
        else
        {
            membership.LeftAt = null;
            membership.IsArchived = false;
            membership.JoinedAt = DateTimeOffset.UtcNow;
        }
        await db.SaveChangesAsync(cancellationToken);
        await NotifyChanged(cancellationToken);
        return Ok(ToDto(session, user.Id));
    }

    [HttpPost("{conversationId:guid}/leave")]
    public async Task<IActionResult> Leave(
        Guid conversationId,
        [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var user = await FindUser(username, cancellationToken);
        if (user is null) return NotFound();
        var membership = await db.ConversationMembers
            .Include(x => x.Conversation)
            .Where(x =>
                x.ConversationId == conversationId &&
                x.UserId == user.Id &&
                x.LeftAt == null)
            .SingleOrDefaultAsync(cancellationToken);
        if (membership is null || membership.Conversation.Type != "live_stream")
        {
            return NotFound();
        }
        if (membership.Role == "owner")
        {
            return BadRequest(new { message = "A host cannot leave their own live-stream conversation." });
        }
        membership.LeftAt = DateTimeOffset.UtcNow;
        membership.IsArchived = true;
        await db.SaveChangesAsync(cancellationToken);
        await NotifyChanged(cancellationToken);
        return NoContent();
    }

    [HttpPost("{conversationId:guid}/sessions/join")]
    public Task<IActionResult> JoinSession(
        Guid conversationId,
        [FromQuery] string username,
        LiveStreamSessionPresenceRequest request,
        CancellationToken cancellationToken) =>
        ChangeSessionPresence(
            conversationId,
            username,
            request.SessionId,
            "joined",
            requireActiveSession: true,
            cancellationToken: cancellationToken);

    [HttpPost("{conversationId:guid}/sessions/leave")]
    public Task<IActionResult> LeaveSession(
        Guid conversationId,
        [FromQuery] string username,
        LiveStreamSessionPresenceRequest request,
        CancellationToken cancellationToken) =>
        ChangeSessionPresence(
            conversationId,
            username,
            request.SessionId,
            "left",
            requireActiveSession: false,
            cancellationToken: cancellationToken);

    private IQueryable<LiveStreamSession> BaseQuery() => db.LiveStreamSessions
        .Include(x => x.HostUser)
        .Include(x => x.Conversation)
            .ThenInclude(x => x.Members);

    private async Task<ChatUser?> FindUser(string username, CancellationToken cancellationToken)
    {
        var normalized = Username.Normalize(username);
        return await db.Users.SingleOrDefaultAsync(
            x => x.NormalizedUsername == normalized && x.Status == "active",
            cancellationToken);
    }

    private Task NotifyChanged(CancellationToken cancellationToken) =>
        hubContext.Clients.All.SendAsync(
            "LiveStreamsChanged",
            cancellationToken: cancellationToken);

    private async Task<IActionResult> ChangeSessionPresence(
        Guid conversationId,
        string username,
        Guid sessionId,
        string action,
        bool requireActiveSession,
        CancellationToken cancellationToken)
    {
        var user = await FindUser(username, cancellationToken);
        if (user is null) return NotFound();
        if (!await db.ConversationMembers.AnyAsync(
                x =>
                    x.ConversationId == conversationId &&
                    x.UserId == user.Id &&
                    x.LeftAt == null,
                cancellationToken))
        {
            return Forbid();
        }

        await using var transaction = await db.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);
        var session = await db.LiveStreamSessions
            .Include(x => x.Conversation)
            .SingleOrDefaultAsync(
                x =>
                    x.Id == sessionId &&
                    x.ConversationId == conversationId &&
                    (!requireActiveSession || x.EndedAt == null),
                cancellationToken);
        if (session is null) return NotFound();

        var message = await AddSystemMessage(
            session.Conversation,
            $"{user.DisplayName} {action} the live stream.",
            user.Id,
            cancellationToken);
        if (action == "joined" && session.HostUserId == user.Id)
        {
            var recordingError = await StartLiveStreamRecording(
                session,
                user,
                cancellationToken);
            if (recordingError is not null) return recordingError;
        }
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        await BroadcastSystemMessage(message, cancellationToken);
        return NoContent();
    }

    private async Task<IActionResult?> StartLiveStreamRecording(
        LiveStreamSession session,
        ChatUser host,
        CancellationToken cancellationToken)
    {
        if (await db.SessionRecordings.AnyAsync(
                item =>
                    item.SessionId == session.Id &&
                    item.SessionType == "live_stream",
                cancellationToken))
        {
            return null;
        }
        if (services.GetService<ICallingProvider>() is not
                { ManagesRecording: true } provider ||
            provider.Name != session.Provider)
        {
            return Problem(
                statusCode: StatusCodes.Status503ServiceUnavailable,
                detail: "The live stream recording cannot be started right now.");
        }

        var recording = new SessionRecording
        {
            Conversation = session.Conversation,
            ConversationId = session.ConversationId,
            SessionId = session.Id,
            StartedByUser = host,
            StartedByUserId = host.Id,
            SessionType = "live_stream",
            Provider = provider.Name,
            ProviderCallLocator = session.ProviderCallId,
            Status = "requesting-consent",
            StartedAt = DateTimeOffset.UtcNow
        };
        db.SessionRecordings.Add(recording);
        await db.SaveChangesAsync(cancellationToken);
        try
        {
            recording.ProviderRecordingId =
                await provider.StartRecordingAsync(
                    session.ProviderCallId,
                    cancellationToken);
            recording.Status = "recording";
            await db.SaveChangesAsync(CancellationToken.None);
            return null;
        }
        catch (Exception exception)
        {
            logger.LogError(
                exception,
                "Recording could not start for connected live stream session {SessionId}.",
                session.Id);
            return Problem(
                statusCode: StatusCodes.Status502BadGateway,
                detail: "The live stream recording could not be started.");
        }
    }

    private async Task<ChatMessage> AddSystemMessage(
        Conversation conversation,
        string content,
        Guid actorUserId,
        CancellationToken cancellationToken)
    {
        var nextSequence = await db.Messages
            .Where(x => x.ConversationId == conversation.Id)
            .Select(x => (long?)x.SequenceNumber)
            .MaxAsync(cancellationToken) ?? 0;
        var now = DateTimeOffset.UtcNow;
        var message = new ChatMessage
        {
            Conversation = conversation,
            ConversationId = conversation.Id,
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
                member.ConversationId == conversation.Id &&
                member.LeftAt == null &&
                member.UserId != actorUserId)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(
                    member => member.UnreadCount,
                    member => member.UnreadCount + 1),
                cancellationToken);
        return message;
    }

    private Task BroadcastSystemMessage(
        ChatMessage message,
        CancellationToken cancellationToken) =>
        hubContext.Clients.Group(ChatHub.ConversationGroup(message.ConversationId))
            .SendAsync(
                "MessageReceived",
                new MessageDto(
                    message.Id,
                    message.ConversationId,
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

    private static LiveStreamDto ToDto(LiveStreamSession session, Guid userId) =>
        ToDto(session.Conversation, session, userId);

    private static LiveStreamDto ToDto(
        Conversation conversation,
        LiveStreamSession? session,
        Guid userId) => new(
            conversation.Id,
            conversation.Title ?? "Live stream",
            conversation.CreatedByUserId ?? session?.HostUserId ?? Guid.Empty,
            conversation.CreatedByUser?.DisplayName ?? session?.HostUser.DisplayName ?? "Host",
            conversation.CreatedByUser?.AvatarUrl ?? session?.HostUser.AvatarUrl,
            conversation.CreatedByUserId == userId,
            conversation.Members.Any(x => x.UserId == userId && x.LeftAt == null),
            session?.Id,
            session?.ProviderCallId,
            session?.StartedAt,
            session?.EndedAt,
            conversation.Members.Count(x => x.LeftAt == null),
            session is { EndedAt: null });
}
