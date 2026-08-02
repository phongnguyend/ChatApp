using System.Data;
using ChatApp.Application.Contracts;
using ChatApp.Application.Data;
using ChatApp.Api.Hubs;
using ChatApp.Application.Models;
using ChatApp.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Controllers;

[ApiController]
[Route("api/recordings")]
public sealed class RecordingsController(
    ChatDbContext db,
    CallStateTracker calls,
    GroupMeetingStateTracker meetings,
    RecordingStateTracker recordingStates,
    ICallingProvider callingProvider,
    IHubContext<ChatHub> hubContext) : ControllerBase
{
    [HttpPost("internal/completed")]
    public async Task<IActionResult> NotifyRecordingCompleted(
        RecordingCompletedNotificationRequest request,
        CancellationToken cancellationToken)
    {
        var recording = await db.SessionRecordings
            .Include(item => item.StartedByUser)
            .SingleOrDefaultAsync(
                item => item.Id == request.RecordingId,
                cancellationToken);
        if (recording is null)
        {
            return NotFound();
        }
        if (recording.Status != "completed" ||
            string.IsNullOrWhiteSpace(recording.StorageObjectName))
        {
            return Conflict(new
            {
                message = "The recording has not completed processing."
            });
        }

        var message = await db.Messages
            .Include(item => item.Attachments)
            .Where(item =>
                item.ConversationId == recording.ConversationId &&
                item.Attachments.Any(attachment =>
                    attachment.StorageKey == recording.StorageObjectName))
            .OrderByDescending(item => item.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);
        if (message is null)
        {
            return NotFound();
        }

        recordingStates.Stop(recording.Id);
        var attachments = message.Attachments
            .Select(attachment => new MessageAttachmentDto(
                attachment.Id,
                attachment.FileName,
                attachment.ContentType,
                attachment.FileSize,
                null,
                null,
                attachment.DurationMs))
            .ToArray();
        await hubContext.Clients
            .Group(ChatHub.ConversationGroup(recording.ConversationId))
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
                    null,
                    attachments),
                cancellationToken);
        await hubContext.Clients
            .Group(ChatHub.ConversationGroup(recording.ConversationId))
            .SendAsync(
                "RecordingCompleted",
                new
                {
                    recording = new RecordingStateDto(
                        recording.Id,
                        recording.ConversationId,
                        recording.SessionId,
                        recording.StartedByUserId,
                        recording.StartedByUser.DisplayName,
                        recording.StartedAt,
                        recording.Status),
                    attachments
                },
                cancellationToken);
        return NoContent();
    }

    [HttpPost]
    public async Task<ActionResult<RecordingStateDto>> Create(
        [FromQuery] string username,
        CreateRecordingRequest request,
        CancellationToken cancellationToken)
    {
        var user = await FindUser(username, cancellationToken);
        if (user is null)
        {
            return NotFound();
        }
        if (request.ConversationId == Guid.Empty ||
            request.SessionId == Guid.Empty ||
            request.SessionType.Trim().ToLowerInvariant() is not
                ("direct" or "meeting"))
        {
            return BadRequest(new { message = "Choose a valid active call." });
        }

        var sessionType = request.SessionType.Trim().ToLowerInvariant();
        if (!await IsActiveParticipant(
                user.Id,
                request.ConversationId,
                request.SessionId,
                sessionType,
                cancellationToken))
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                new { message = "Only active call participants can record." });
        }

        var hasActiveRecording = await db.SessionRecordings.AnyAsync(
            recording =>
                recording.SessionId == request.SessionId &&
                (recording.Status == "requesting-consent" ||
                 recording.Status == "recording" ||
                 recording.Status == "processing"),
            cancellationToken);
        if (hasActiveRecording)
        {
            return Conflict(new
            {
                message = "A recording is already active for this call."
            });
        }

        var conversation = await db.Conversations.SingleAsync(
            conversation => conversation.Id == request.ConversationId,
            cancellationToken);
        var recording = new SessionRecording
        {
            Conversation = conversation,
            ConversationId = conversation.Id,
            SessionId = request.SessionId,
            StartedByUser = user,
            StartedByUserId = user.Id,
            SessionType = sessionType,
            Provider = callingProvider.Name,
            ProviderCallLocator = request.SessionId.ToString(),
            Status = "requesting-consent",
            StartedAt = DateTimeOffset.UtcNow
        };
        db.SessionRecordings.Add(recording);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            return Conflict(new
            {
                message = "A recording is already active for this call."
            });
        }

        return Ok(ToDto(recording, user.DisplayName));
    }

    [HttpPost("{recordingId:guid}/cancel")]
    public async Task<IActionResult> Cancel(
        Guid recordingId,
        [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var user = await FindUser(username, cancellationToken);
        var recording = await db.SessionRecordings
            .Include(item => item.StartedByUser)
            .SingleOrDefaultAsync(
                item => item.Id == recordingId,
                cancellationToken);
        if (user is null || recording is null)
        {
            return NotFound();
        }

        var isOwner = recording.SessionType == "meeting" &&
            await db.ConversationMembers.AnyAsync(
                member =>
                    member.ConversationId == recording.ConversationId &&
                    member.UserId == user.Id &&
                    member.LeftAt == null &&
                    member.Role == "owner",
                cancellationToken);
        if (recording.StartedByUserId != user.Id && !isOwner)
        {
            return Forbid();
        }
        if (recording.Status is "completed" or "cancelled" or "failed")
        {
            return NoContent();
        }

        recording.Status = "cancelled";
        recording.CompletedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        recordingStates.Stop(recording.Id);
        await PublishFailed(recording, "Recording was cancelled.");
        return NoContent();
    }

    [HttpGet("{recordingId:guid}")]
    public async Task<ActionResult<RecordingStateDto>> Get(
        Guid recordingId,
        [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var normalized = Username.Normalize(username);
        var recording = await db.SessionRecordings
            .AsNoTracking()
            .Where(item =>
                item.Id == recordingId &&
                item.Conversation.Members.Any(member =>
                    member.LeftAt == null &&
                    member.User.NormalizedUsername == normalized))
            .Select(item => new RecordingStateDto(
                item.Id,
                item.ConversationId,
                item.SessionId,
                item.StartedByUserId,
                item.StartedByUser.DisplayName,
                item.StartedAt,
                item.Status))
            .SingleOrDefaultAsync(cancellationToken);
        return recording is null ? NotFound() : Ok(recording);
    }

    [HttpGet("conversation/{conversationId:guid}")]
    public async Task<ActionResult<IReadOnlyList<SessionRecordingListItemDto>>>
        GetForConversation(
            Guid conversationId,
            [FromQuery] string username,
            CancellationToken cancellationToken)
    {
        var normalized = Username.Normalize(username);
        var isMember = await db.ConversationMembers.AnyAsync(
            member =>
                member.ConversationId == conversationId &&
                member.LeftAt == null &&
                member.User.NormalizedUsername == normalized,
            cancellationToken);
        if (!isMember)
        {
            return NotFound();
        }

        var managedProviderName = callingProvider.Name;
        var canCheckManagedRecording = callingProvider.ManagesRecording;

        return await db.SessionRecordings
            .AsNoTracking()
            .Where(recording => recording.ConversationId == conversationId)
            .OrderByDescending(recording => recording.StartedAt)
            .Select(recording => new SessionRecordingListItemDto(
                recording.Id,
                recording.ConversationId,
                recording.SessionId,
                recording.StartedByUserId,
                recording.StartedByUser.DisplayName,
                recording.StartedByUser.AvatarUrl,
                recording.SessionType,
                recording.Provider,
                recording.Status,
                recording.StartedAt,
                recording.CompletedAt,
                recording.DurationMilliseconds,
                db.MessageAttachments
                    .Where(attachment =>
                        recording.StorageObjectName != null &&
                        attachment.StorageKey == recording.StorageObjectName)
                    .Select(attachment => new MessageAttachmentDto(
                        attachment.Id,
                        attachment.FileName,
                        attachment.ContentType,
                        attachment.FileSize,
                        attachment.Width,
                        attachment.Height,
                        attachment.DurationMs))
                    .FirstOrDefault(),
                canCheckManagedRecording &&
                recording.Provider == managedProviderName &&
                recording.ProviderRecordingId != null))
            .ToListAsync(cancellationToken);
    }

    [HttpPost("{recordingId:guid}/check-status")]
    public async Task<ActionResult<RecordingProviderStatusDto>> CheckStatus(
        Guid recordingId,
        [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var normalized = Username.Normalize(username);
        var recording = await db.SessionRecordings
            .Where(item =>
                item.Id == recordingId &&
                item.Conversation.Members.Any(member =>
                    member.LeftAt == null &&
                    member.User.NormalizedUsername == normalized))
            .SingleOrDefaultAsync(cancellationToken);
        if (recording is null)
        {
            return NotFound();
        }
        if (recording.Status == "completed")
        {
            return Conflict(new
            {
                message = "The recording has already completed."
            });
        }
        if (!callingProvider.ManagesRecording ||
            recording.Provider != callingProvider.Name ||
            string.IsNullOrWhiteSpace(recording.ProviderRecordingId))
        {
            return Conflict(new
            {
                message = "This recording does not have an Azure recording status to check."
            });
        }

        var providerStatus = await callingProvider.GetRecordingStatusAsync(
            recording.ProviderRecordingId,
            cancellationToken);
        if (providerStatus == "active" &&
            recording.Status == "requesting-consent")
        {
            recording.Status = "recording";
        }
        else if (providerStatus == "inactive" &&
                 recording.Status == "recording")
        {
            recording.Status = "processing";
        }
        await db.SaveChangesAsync(cancellationToken);

        return new RecordingProviderStatusDto(
            recording.Id,
            recording.Status,
            providerStatus,
            DateTimeOffset.UtcNow);
    }

    [HttpDelete("{recordingId:guid}")]
    public async Task<IActionResult> DeleteIncomplete(
        Guid recordingId,
        [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var user = await FindUser(username, cancellationToken);
        var recording = await db.SessionRecordings.SingleOrDefaultAsync(
            item => item.Id == recordingId,
            cancellationToken);
        if (user is null || recording is null)
        {
            return NotFound();
        }

        var isOwner = await db.ConversationMembers.AnyAsync(
            member =>
                member.ConversationId == recording.ConversationId &&
                member.UserId == user.Id &&
                member.LeftAt == null &&
                member.Role == "owner",
            cancellationToken);
        if (recording.StartedByUserId != user.Id && !isOwner)
        {
            return Forbid();
        }
        if (recording.Status == "completed")
        {
            return Conflict(new
            {
                message = "Completed recordings cannot be deleted here."
            });
        }

        if (callingProvider.ManagesRecording &&
            recording.Provider == callingProvider.Name &&
            !string.IsNullOrWhiteSpace(recording.ProviderRecordingId))
        {
            var providerStatus = await callingProvider.GetRecordingStatusAsync(
                recording.ProviderRecordingId,
                cancellationToken);
            if (providerStatus == "active")
            {
                await callingProvider.StopRecordingAsync(
                    recording.ProviderRecordingId,
                    cancellationToken);
            }
        }

        recordingStates.Stop(recording.Id);
        db.SessionRecordings.Remove(recording);
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    private async Task<bool> IsActiveParticipant(
        Guid userId,
        Guid conversationId,
        Guid sessionId,
        string sessionType,
        CancellationToken cancellationToken)
    {
        if (!await db.ConversationMembers.AnyAsync(
                member =>
                    member.ConversationId == conversationId &&
                    member.UserId == userId &&
                    member.LeftAt == null,
                cancellationToken))
        {
            return false;
        }

        if (sessionType == "direct")
        {
            var call = calls.Get(sessionId);
            return call is not null &&
                call.ConversationId == conversationId &&
                (call.InitiatorUserId == userId || call.PeerUserId == userId);
        }

        return meetings.HasParticipant(conversationId, sessionId, userId);
    }

    private Task<ChatUser?> FindUser(
        string username,
        CancellationToken cancellationToken)
    {
        if (!Username.IsValid(username))
        {
            return Task.FromResult<ChatUser?>(null);
        }
        var normalized = Username.Normalize(username);
        return db.Users.SingleOrDefaultAsync(
            user =>
                user.NormalizedUsername == normalized &&
                user.Status == "active",
            cancellationToken);
    }

    private async Task SendSystemMessage(
        Guid conversationId,
        string content,
        CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);
        var conversation = await db.Conversations.SingleAsync(
            item => item.Id == conversationId,
            cancellationToken);
        var sequence = await db.Messages
            .Where(message => message.ConversationId == conversationId)
            .Select(message => (long?)message.SequenceNumber)
            .MaxAsync(cancellationToken) ?? 0;
        var now = DateTimeOffset.UtcNow;
        var message = new ChatMessage
        {
            Conversation = conversation,
            ConversationId = conversationId,
            MessageType = "system",
            Content = content,
            SequenceNumber = sequence + 1,
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
                member.LeftAt == null)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(
                    member => member.UnreadCount,
                    member => member.UnreadCount + 1),
                cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        await hubContext.Clients
            .Group(ChatHub.ConversationGroup(conversationId))
            .SendAsync(
                "MessageReceived",
                new MessageDto(
                    message.Id,
                    conversationId,
                    null,
                    null,
                    null,
                    content,
                    "system",
                    null,
                    message.SequenceNumber,
                    null,
                    now,
                    null,
                    null),
                cancellationToken);
    }

    private async Task PublishFailed(SessionRecording recording, string message)
    {
        await hubContext.Clients
            .Group(ChatHub.ConversationGroup(recording.ConversationId))
            .SendAsync(
                "RecordingFailed",
                new
                {
                    recording = ToDto(
                        recording,
                        recording.StartedByUser.DisplayName),
                    message
                });
        await SendSystemMessage(
            recording.ConversationId,
            message,
            CancellationToken.None);
    }

    private static RecordingStateDto ToDto(
        SessionRecording recording,
        string displayName) =>
        new(
            recording.Id,
            recording.ConversationId,
            recording.SessionId,
            recording.StartedByUserId,
            displayName,
            recording.StartedAt,
            recording.Status);
}
