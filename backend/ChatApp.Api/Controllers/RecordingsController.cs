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
[Route("api/recordings")]
public sealed class RecordingsController(
    ChatDbContext db,
    IUploadObjectStorage storage,
    RecordingChunkTempStorage chunkTempStorage,
    CallStateTracker calls,
    GroupMeetingStateTracker meetings,
    RecordingStateTracker recordingStates,
    RecordingFinalizationQueue finalizations,
    IServiceProvider services,
    IHubContext<ChatHub> hubContext,
    ILogger<RecordingsController> logger) : ControllerBase
{
    private const long MaximumChunkSize = 32 * 1024 * 1024;

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
        var callingProvider = services.GetService<ICallingProvider>();
        if (callingProvider?.ManagesRecording == true &&
            string.IsNullOrWhiteSpace(request.ProviderCallId))
        {
            return BadRequest(new
            {
                message = "The calling provider has not connected the media session yet."
            });
        }
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
            Provider = callingProvider?.Name ?? "",
            ProviderCallLocator = callingProvider?.ManagesRecording == true
                ? request.SessionId.ToString()
                : request.ProviderCallId?.Trim(),
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

    [HttpPut("{recordingId:guid}/chunks/{sequence:int}")]
    [RequestSizeLimit(MaximumChunkSize)]
    public async Task<IActionResult> UploadChunk(
        Guid recordingId,
        int sequence,
        [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        if (sequence is < 0 or > 1_000_000 ||
            Request.ContentLength is null or <= 0 or > MaximumChunkSize)
        {
            return BadRequest(new { message = "Choose a valid recording chunk." });
        }

        var user = await FindUser(username, cancellationToken);
        var recording = await db.SessionRecordings
            .SingleOrDefaultAsync(
                item => item.Id == recordingId,
                cancellationToken);
        if (user is null || recording is null)
        {
            return NotFound();
        }
        if (recording.StartedByUserId != user.Id)
        {
            return Forbid();
        }
        if (recording.Status != "recording")
        {
            return Conflict(new
            {
                message = "This recording is not accepting chunks."
            });
        }
        if (await db.SessionRecordingChunks.AnyAsync(
                chunk =>
                    chunk.RecordingId == recordingId &&
                    chunk.Sequence == sequence,
                cancellationToken))
        {
            return NoContent();
        }

        var storageReference = await chunkTempStorage.WriteAsync(
            recordingId,
            sequence,
            Request.Body,
            cancellationToken);
        try
        {
            db.SessionRecordingChunks.Add(new SessionRecordingChunk
            {
                Recording = recording,
                RecordingId = recordingId,
                Sequence = sequence,
                StorageObjectName = storageReference,
                FileSize = Request.ContentLength.Value
            });
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            if (!await db.SessionRecordingChunks.AnyAsync(
                    chunk =>
                        chunk.RecordingId == recordingId &&
                        chunk.Sequence == sequence,
                    cancellationToken))
            {
                throw;
            }
        }

        return NoContent();
    }

    [HttpPost("{recordingId:guid}/complete")]
    public async Task<ActionResult<RecordingStateDto>> Complete(
        Guid recordingId,
        [FromQuery] string username,
        CompleteRecordingRequest request,
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
        if (recording.StartedByUserId != user.Id)
        {
            return Forbid();
        }
        if (recording.Status != "recording")
        {
            return Conflict(new
            {
                message = "This recording cannot be completed."
            });
        }
        if (request.DurationMilliseconds is < 0 or > 86_400_000)
        {
            return BadRequest(new { message = "Choose a valid duration." });
        }

        var chunks = await db.SessionRecordingChunks
            .Where(chunk => chunk.RecordingId == recordingId)
            .OrderBy(chunk => chunk.Sequence)
            .ToListAsync(cancellationToken);
        if (chunks.Count == 0 ||
            chunks.Select((chunk, index) => chunk.Sequence == index)
                .Any(matches => !matches))
        {
            return BadRequest(new
            {
                message = "The recording has missing chunks."
            });
        }

        recording.Status = "processing";
        recording.DurationMilliseconds = request.DurationMilliseconds;
        await db.SaveChangesAsync(cancellationToken);
        recordingStates.Stop(recording.Id);
        await hubContext.Clients
            .Group(ChatHub.ConversationGroup(recording.ConversationId))
            .SendAsync(
                "RecordingStopped",
                ToDto(recording, recording.StartedByUser.DisplayName),
                cancellationToken);
        await SendSystemMessage(
            recording.ConversationId,
            $"{recording.StartedByUser.DisplayName} stopped the recording. Processing…",
            cancellationToken);

        await finalizations.EnqueueAsync(recording.Id, CancellationToken.None);
        return Accepted(ToDto(recording, recording.StartedByUser.DisplayName));
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
        var chunks = await db.SessionRecordingChunks
            .Where(chunk => chunk.RecordingId == recording.Id)
            .ToListAsync(cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        recordingStates.Stop(recording.Id);
        foreach (var chunk in chunks)
        {
            try
            {
                if (RecordingChunkTempStorage.IsTemporaryReference(
                        chunk.StorageObjectName))
                {
                    await chunkTempStorage.DeleteAsync(
                        chunk.RecordingId,
                        chunk.Sequence,
                        CancellationToken.None);
                }
                else
                {
                    await storage.DeleteAsync(
                        chunk.StorageObjectName,
                        CancellationToken.None);
                }
            }
            catch (Exception exception)
            {
                logger.LogWarning(
                    exception,
                    "Could not delete cancelled recording chunk {Chunk}.",
                    chunk.StorageObjectName);
            }
        }
        db.SessionRecordingChunks.RemoveRange(chunks);
        await db.SaveChangesAsync(CancellationToken.None);
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
