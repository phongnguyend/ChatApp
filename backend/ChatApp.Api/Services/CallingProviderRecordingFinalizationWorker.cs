using System.Data;
using System.Text.Json;
using ChatApp.Api.Contracts;
using ChatApp.Api.Data;
using ChatApp.Api.Hubs;
using ChatApp.Api.Models;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Services;

public sealed class CallingProviderRecordingFinalizationWorker(
    IServiceScopeFactory scopeFactory,
    IUploadObjectStorage storage,
    CallingProviderRecordingFinalizationQueue queue,
    RecordingStateTracker recordingStates,
    IHubContext<ChatHub> hubContext,
    ILogger<CallingProviderRecordingFinalizationWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await ResumePendingAsync(stoppingToken);
        await foreach (var file in queue.ReadAllAsync(stoppingToken))
        {
            try
            {
                await FinalizeAsync(file, stoppingToken);
            }
            catch (OperationCanceledException) when (
                stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception)
            {
                logger.LogError(
                    exception,
                    "Provider recording {ProviderRecordingId} could not be finalized.",
                    file.ProviderRecordingId);
            }
        }
    }

    private async Task ResumePendingAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ChatDbContext>();
        var pending = await db.SessionRecordings
            .Where(item =>
                item.Status == "processing" &&
                item.ProviderRecordingId != null &&
                item.ProviderContentLocationsJson != null)
            .Select(item => new
            {
                item.ProviderRecordingId,
                item.ProviderContentLocationsJson,
                item.DurationMilliseconds
            })
            .ToListAsync(cancellationToken);
        foreach (var item in pending)
        {
            var locations = JsonSerializer.Deserialize<string[]>(
                item.ProviderContentLocationsJson!) ?? [];
            var uris = locations
                .Where(location => Uri.TryCreate(
                    location,
                    UriKind.Absolute,
                    out _))
                .Select(location => new Uri(location))
                .ToArray();
            if (uris.Length == 0)
            {
                continue;
            }
            await queue.EnqueueAsync(
                new CallingProviderRecordingFile(
                    item.ProviderRecordingId!,
                    uris,
                    item.DurationMilliseconds ?? 0),
                cancellationToken);
        }
    }

    private async Task FinalizeAsync(
        CallingProviderRecordingFile providerFile,
        CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ChatDbContext>();
        var callingProvider =
            scope.ServiceProvider.GetRequiredService<ICallingProvider>();
        var recording = await db.SessionRecordings
            .Include(item => item.StartedByUser)
            .SingleOrDefaultAsync(
                item =>
                    item.Provider == callingProvider.Name &&
                    item.ProviderRecordingId ==
                        providerFile.ProviderRecordingId,
                cancellationToken);
        if (recording is null || recording.Status == "completed")
        {
            return;
        }
        if (recording.Status != "processing")
        {
            throw new InvalidOperationException(
                "The provider recording is not awaiting finalization.");
        }

        var messageId = Guid.NewGuid();
        var storedObjects = new List<string>();
        var temporaryFiles = new List<string>();
        var attachments = new List<MessageAttachment>();
        try
        {
            for (var index = 0;
                 index < providerFile.ContentLocations.Count;
                 index++)
            {
                var temporaryPath = Path.Combine(
                    Path.GetTempPath(),
                    $"provider-recording-{recording.Id:N}-{index}-{Guid.NewGuid():N}.mp4");
                temporaryFiles.Add(temporaryPath);
                await using (var download = new FileStream(
                    temporaryPath,
                    FileMode.CreateNew,
                    FileAccess.Write,
                    FileShare.None,
                    81920,
                    useAsync: true))
                {
                    await callingProvider.DownloadRecordingAsync(
                        providerFile.ContentLocations[index],
                        download,
                        cancellationToken);
                }
                var suffix = providerFile.ContentLocations.Count == 1
                    ? ""
                    : $"-part-{index + 1}";
                var relativeKey =
                    $"{recording.ConversationId:N}/{messageId:N}/{recording.Id:N}{suffix}.mp4";
                var storageObject = $"attachments/{relativeKey}";
                await using (var upload = new FileStream(
                    temporaryPath,
                    FileMode.Open,
                    FileAccess.Read,
                    FileShare.Read,
                    81920,
                    useAsync: true))
                {
                    await storage.WriteAsync(
                        storageObject,
                        upload,
                        cancellationToken);
                }
                storedObjects.Add(storageObject);
                attachments.Add(new MessageAttachment
                {
                    Message = null!,
                    MessageId = messageId,
                    StorageKey = relativeKey,
                    FileName =
                        $"recording-{recording.StartedAt:yyyyMMdd-HHmmss}{suffix}.mp4",
                    ContentType = "video/mp4",
                    FileSize = new FileInfo(temporaryPath).Length,
                    DurationMs = providerFile.DurationMilliseconds > 0
                        ? providerFile.DurationMilliseconds
                        : null
                });
            }

            var message = await SaveMessageAsync(
                db,
                recording,
                messageId,
                attachments,
                providerFile.DurationMilliseconds,
                cancellationToken);
            recordingStates.Stop(recording.Id);
            var attachmentDtos = attachments.Select(ToDto).ToArray();
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
                        attachmentDtos),
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
                        attachments = attachmentDtos
                    },
                    cancellationToken);
        }
        catch
        {
            foreach (var storageObject in storedObjects)
            {
                await storage.DeleteAsync(
                    storageObject,
                    CancellationToken.None).ConfigureAwait(false);
            }
            recording.Status = "failed";
            recording.CompletedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(CancellationToken.None);
            recordingStates.Stop(recording.Id);
            throw;
        }
        finally
        {
            foreach (var temporaryFile in temporaryFiles)
            {
                File.Delete(temporaryFile);
            }
        }
    }

    private static async Task<ChatMessage> SaveMessageAsync(
        ChatDbContext db,
        SessionRecording recording,
        Guid messageId,
        IReadOnlyCollection<MessageAttachment> attachments,
        long durationMilliseconds,
        CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);
        var conversation = await db.Conversations.SingleAsync(
            item => item.Id == recording.ConversationId,
            cancellationToken);
        var sequence = await db.Messages
            .Where(message => message.ConversationId == conversation.Id)
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
        foreach (var attachment in attachments)
        {
            attachment.Message = message;
            message.Attachments.Add(attachment);
        }
        db.Messages.Add(message);
        recording.StorageObjectName =
            $"attachments/{attachments.First().StorageKey}";
        recording.ProviderContentLocationsJson = null;
        recording.DurationMilliseconds = durationMilliseconds > 0
            ? durationMilliseconds
            : null;
        recording.Status = "completed";
        recording.CompletedAt = now;
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
        return message;
    }

    private static MessageAttachmentDto ToDto(MessageAttachment attachment) =>
        new(
            attachment.Id,
            attachment.FileName,
            attachment.ContentType,
            attachment.FileSize,
            null,
            null,
            attachment.DurationMs);
}
