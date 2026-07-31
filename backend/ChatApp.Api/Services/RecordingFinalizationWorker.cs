using System.Data;
using ChatApp.Api.Contracts;
using ChatApp.Api.Data;
using ChatApp.Api.Hubs;
using ChatApp.Api.Models;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Services;

public sealed class RecordingFinalizationWorker(
    IServiceScopeFactory scopeFactory,
    IUploadObjectStorage storage,
    RecordingChunkTempStorage chunkTempStorage,
    RecordingFinalizationQueue queue,
    RecordingStateTracker recordingStates,
    IHubContext<ChatHub> hubContext,
    ILogger<RecordingFinalizationWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await ResumeInterruptedFinalizations(stoppingToken);
        await foreach (var recordingId in queue.ReadAllAsync(stoppingToken))
        {
            try
            {
                await FinalizeRecording(recordingId, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception)
            {
                logger.LogError(
                    exception,
                    "Unexpected finalization failure for recording {RecordingId}.",
                    recordingId);
            }
        }
    }

    private async Task ResumeInterruptedFinalizations(
        CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ChatDbContext>();
        var pendingIds = await db.SessionRecordings
            .Where(recording => recording.Status == "processing")
            .Select(recording => recording.Id)
            .ToListAsync(cancellationToken);
        foreach (var recordingId in pendingIds)
        {
            await FinalizeRecording(recordingId, cancellationToken);
        }
    }

    private async Task FinalizeRecording(
        Guid recordingId,
        CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ChatDbContext>();
        var recording = await db.SessionRecordings
            .Include(item => item.StartedByUser)
            .SingleOrDefaultAsync(
                item => item.Id == recordingId,
                cancellationToken);
        if (recording is null || recording.Status != "processing")
        {
            return;
        }

        var chunks = await db.SessionRecordingChunks
            .Where(chunk => chunk.RecordingId == recordingId)
            .OrderBy(chunk => chunk.Sequence)
            .ToListAsync(cancellationToken);
        var temporaryPath = Path.Combine(
            Path.GetTempPath(),
            $"chat-recording-{recordingId:N}-{Guid.NewGuid():N}.webm");
        var finalObjectName = "";
        try
        {
            if (chunks.Count == 0 ||
                chunks.Select((chunk, index) => chunk.Sequence == index)
                    .Any(matches => !matches))
            {
                throw new InvalidDataException(
                    "The recording has missing chunks.");
            }

            await using (var combined = new FileStream(
                temporaryPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                81920,
                useAsync: true))
            {
                foreach (var chunk in chunks)
                {
                    await using var source =
                        await OpenChunk(
                            chunk,
                            cancellationToken)
                        ?? throw new InvalidDataException(
                            $"Recording chunk {chunk.Sequence} was not found.");
                    await source.CopyToAsync(combined, cancellationToken);
                }
            }

            var messageId = Guid.NewGuid();
            var relativeStorageKey =
                $"{recording.ConversationId:N}/{messageId:N}/{recordingId:N}.webm";
            finalObjectName = $"attachments/{relativeStorageKey}";
            await using (var finalStream = new FileStream(
                temporaryPath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                81920,
                useAsync: true))
            {
                await storage.WriteAsync(
                    finalObjectName,
                    finalStream,
                    cancellationToken);
            }

            var encodedDuration =
                WebmDurationReader.TryReadDurationMilliseconds(temporaryPath);
            if (encodedDuration is > 0)
            {
                recording.DurationMilliseconds = encodedDuration;
            }

            recording.StorageObjectName = finalObjectName;
            recording.Status = "completed";
            recording.CompletedAt = DateTimeOffset.UtcNow;
            var attachmentDto = await SendRecordingAttachment(
                db,
                recording,
                messageId,
                relativeStorageKey,
                new FileInfo(temporaryPath).Length,
                cancellationToken);
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
                        "Could not delete recording chunk {Chunk}.",
                        chunk.StorageObjectName);
                }
            }
            try
            {
                db.SessionRecordingChunks.RemoveRange(chunks);
                await db.SaveChangesAsync(CancellationToken.None);
            }
            catch (Exception exception)
            {
                logger.LogWarning(
                    exception,
                    "Could not remove chunk metadata for completed recording {RecordingId}.",
                    recordingId);
            }

            try
            {
                await hubContext.Clients
                    .Group(ChatHub.ConversationGroup(recording.ConversationId))
                    .SendAsync(
                        "RecordingCompleted",
                        new
                        {
                            recording = ToDto(recording),
                            attachment = attachmentDto
                        },
                        cancellationToken);
            }
            catch (Exception exception)
            {
                logger.LogWarning(
                    exception,
                    "Could not signal completion for recording {RecordingId}.",
                    recordingId);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogError(
                exception,
                "Recording {RecordingId} could not be finalized.",
                recordingId);
            recording.Status = "failed";
            recording.CompletedAt = DateTimeOffset.UtcNow;
            try
            {
                await db.SaveChangesAsync(CancellationToken.None);
            }
            catch (Exception statusException)
            {
                logger.LogError(
                    statusException,
                    "Could not persist failure status for recording {RecordingId}.",
                    recordingId);
            }
            recordingStates.Stop(recording.Id);
            if (!string.IsNullOrWhiteSpace(finalObjectName))
            {
                try
                {
                    await storage.DeleteAsync(
                        finalObjectName,
                        CancellationToken.None);
                }
                catch (Exception deleteException)
                {
                    logger.LogWarning(
                        deleteException,
                        "Could not delete failed recording object {ObjectName}.",
                        finalObjectName);
                }
            }
            try
            {
                await PublishFailed(
                    db,
                    recording,
                    "The recording could not be processed.");
            }
            catch (Exception publishException)
            {
                logger.LogWarning(
                    publishException,
                    "Could not publish failure for recording {RecordingId}.",
                    recordingId);
            }
        }
        finally
        {
            File.Delete(temporaryPath);
        }
    }

    private Task<Stream?> OpenChunk(
        SessionRecordingChunk chunk,
        CancellationToken cancellationToken) =>
        RecordingChunkTempStorage.IsTemporaryReference(
            chunk.StorageObjectName)
            ? chunkTempStorage.OpenReadAsync(
                chunk.RecordingId,
                chunk.Sequence,
                cancellationToken)
            : storage.OpenReadAsync(
                chunk.StorageObjectName,
                cancellationToken);

    private async Task SendSystemMessage(
        ChatDbContext db,
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

    private async Task<MessageAttachmentDto> SendRecordingAttachment(
        ChatDbContext db,
        SessionRecording recording,
        Guid messageId,
        string storageKey,
        long fileSize,
        CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);
        var conversation = await db.Conversations.SingleAsync(
            item => item.Id == recording.ConversationId,
            cancellationToken);
        var sequence = await db.Messages
            .Where(message => message.ConversationId == recording.ConversationId)
            .Select(message => (long?)message.SequenceNumber)
            .MaxAsync(cancellationToken) ?? 0;
        var now = DateTimeOffset.UtcNow;
        var message = new ChatMessage
        {
            Id = messageId,
            Conversation = conversation,
            ConversationId = conversation.Id,
            MessageType = "system",
            Content = "Session recording completed.",
            SequenceNumber = sequence + 1,
            CreatedAt = now
        };
        var attachment = new MessageAttachment
        {
            Message = message,
            MessageId = message.Id,
            StorageKey = storageKey,
            FileName = $"recording-{recording.StartedAt:yyyyMMdd-HHmmss}.webm",
            ContentType = "video/webm",
            FileSize = fileSize,
            DurationMs = recording.DurationMilliseconds,
            CreatedAt = now
        };
        message.Attachments.Add(attachment);
        db.Messages.Add(message);
        conversation.LastMessage = message;
        conversation.LastMessageId = message.Id;
        conversation.LastMessageAt = now;
        conversation.UpdatedAt = now;
        await db.ConversationMembers
            .Where(member =>
                member.ConversationId == conversation.Id &&
                member.LeftAt == null)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(
                    member => member.UnreadCount,
                    member => member.UnreadCount + 1),
                cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        var attachmentDto = new MessageAttachmentDto(
            attachment.Id,
            attachment.FileName,
            attachment.ContentType,
            attachment.FileSize,
            null,
            null,
            attachment.DurationMs);
        try
        {
            await hubContext.Clients
                .Group(ChatHub.ConversationGroup(conversation.Id))
                .SendAsync(
                    "MessageReceived",
                    new MessageDto(
                        message.Id,
                        conversation.Id,
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
                        [attachmentDto]),
                    cancellationToken);
        }
        catch (Exception exception)
        {
            logger.LogWarning(
                exception,
                "Could not signal attachment creation for recording {RecordingId}.",
                recording.Id);
        }
        return attachmentDto;
    }

    private async Task PublishFailed(
        ChatDbContext db,
        SessionRecording recording,
        string message)
    {
        await hubContext.Clients
            .Group(ChatHub.ConversationGroup(recording.ConversationId))
            .SendAsync(
                "RecordingFailed",
                new
                {
                    recording = ToDto(recording),
                    message
                });
        await SendSystemMessage(
            db,
            recording.ConversationId,
            message,
            CancellationToken.None);
    }

    private static RecordingStateDto ToDto(SessionRecording recording) =>
        new(
            recording.Id,
            recording.ConversationId,
            recording.SessionId,
            recording.StartedByUserId,
            recording.StartedByUser.DisplayName,
            recording.StartedAt,
            recording.Status);
}
