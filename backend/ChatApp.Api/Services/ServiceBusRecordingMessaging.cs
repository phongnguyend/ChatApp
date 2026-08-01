using System.Data;
using System.Text.Json;
using Azure.Messaging.ServiceBus;
using ChatApp.Api.Contracts;
using ChatApp.Api.Data;
using ChatApp.Api.Hubs;
using ChatApp.Api.Models;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace ChatApp.Api.Services;

public sealed record BrowserRecordingFinalizationMessage(Guid RecordingId);

public sealed record CallingProviderRecordingFile(
    string ProviderRecordingId,
    IReadOnlyList<Uri> ContentLocations,
    long DurationMilliseconds);

public interface IRecordingFinalizationPublisher
{
    Task PublishAsync(Guid recordingId, CancellationToken cancellationToken);
}

public sealed class UnavailableRecordingFinalizationPublisher :
    IRecordingFinalizationPublisher
{
    public Task PublishAsync(
        Guid recordingId,
        CancellationToken cancellationToken) =>
        throw new InvalidOperationException(
            "Azure Service Bus messaging is not configured.");
}

public sealed class ServiceBusRecordingFinalizationPublisher(
    ServiceBusClient client,
    IOptions<MessagingOptions> options) :
    IRecordingFinalizationPublisher,
    IAsyncDisposable
{
    public const string BrowserRecordingSubject = "recording.finalize.browser";
    private readonly ServiceBusSender sender = client.CreateSender(
        options.Value.AzureServiceBus.TopicName);

    public Task PublishAsync(
        Guid recordingId,
        CancellationToken cancellationToken)
    {
        var message = new ServiceBusMessage(
            BinaryData.FromObjectAsJson(
                new BrowserRecordingFinalizationMessage(recordingId)))
        {
            ContentType = "application/json",
            MessageId = $"browser-recording-{recordingId:N}",
            Subject = BrowserRecordingSubject
        };
        return sender.SendMessageAsync(message, cancellationToken);
    }

    public ValueTask DisposeAsync() => sender.DisposeAsync();
}

public sealed class ServiceBusRecordingWorker(
    ServiceBusClient client,
    IOptions<MessagingOptions> options,
    IServiceScopeFactory scopeFactory,
    IUploadObjectStorage storage,
    RecordingChunkTempStorage chunkTempStorage,
    RecordingStateTracker recordingStates,
    IHubContext<ChatHub> hubContext,
    ILogger<ServiceBusRecordingWorker> logger) : BackgroundService
{
    private ServiceBusProcessor? processor;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await ResumeBrowserRecordingsAsync(stoppingToken);
        await ResumeProviderRecordingsAsync(stoppingToken);

        var serviceBus = options.Value.AzureServiceBus;
        processor = client.CreateProcessor(
            serviceBus.TopicName,
            serviceBus.SubscriptionName,
            new ServiceBusProcessorOptions
            {
                AutoCompleteMessages = false,
                MaxAutoLockRenewalDuration = TimeSpan.FromHours(1),
                MaxConcurrentCalls = 1
            });
        processor.ProcessMessageAsync += ProcessMessageAsync;
        processor.ProcessErrorAsync += ProcessErrorAsync;
        await processor.StartProcessingAsync(stoppingToken);
        try
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
        finally
        {
            await processor.StopProcessingAsync(CancellationToken.None);
            await processor.DisposeAsync();
            processor = null;
        }
    }

    private async Task ProcessMessageAsync(ProcessMessageEventArgs args)
    {
        try
        {
            var handled = args.Message.Subject ==
                ServiceBusRecordingFinalizationPublisher.BrowserRecordingSubject
                ? await HandleBrowserRecordingAsync(args.Message)
                : await HandleEventGridEventsAsync(args.Message);
            if (handled)
            {
                await args.CompleteMessageAsync(args.Message);
            }
            else
            {
                await args.DeadLetterMessageAsync(
                    args.Message,
                    "UnsupportedMessage",
                    "The Service Bus message is not a supported recording event.");
            }
        }
        catch (Exception exception)
        {
            logger.LogError(
                exception,
                "Service Bus recording message {MessageId} could not be processed.",
                args.Message.MessageId);
            await args.AbandonMessageAsync(args.Message);
        }
    }

    private async Task<bool> HandleBrowserRecordingAsync(
        ServiceBusReceivedMessage message)
    {
        var payload = JsonSerializer.Deserialize<BrowserRecordingFinalizationMessage>(
            message.Body.ToString())
            ?? throw new InvalidDataException(
                "The browser recording message has an invalid payload.");
        if (payload.RecordingId == Guid.Empty)
        {
            throw new InvalidDataException(
                "The browser recording identifier is missing.");
        }
        await FinalizeBrowserRecordingAsync(
            payload.RecordingId,
            CancellationToken.None);
        return true;
    }

    private async Task<bool> HandleEventGridEventsAsync(
        ServiceBusReceivedMessage message)
    {
        using var document = JsonDocument.Parse(message.Body.ToStream());
        if (document.RootElement.ValueKind == JsonValueKind.Array)
        {
            var handled = false;
            foreach (var cloudEvent in document.RootElement.EnumerateArray())
            {
                handled = await HandleProviderEventGridEventAsync(
                    cloudEvent,
                    CancellationToken.None) || handled;
            }
            return handled;
        }
        if (document.RootElement.ValueKind == JsonValueKind.Object)
        {
            return await HandleProviderEventGridEventAsync(
                document.RootElement,
                CancellationToken.None);
        }
        return false;
    }

    private async Task<bool> HandleProviderEventGridEventAsync(
        JsonElement cloudEvent,
        CancellationToken cancellationToken)
    {
        var eventType = cloudEvent.TryGetProperty(
            "eventType",
            out var eventTypeElement)
            ? eventTypeElement.GetString()
            : null;
        if (!string.Equals(
                eventType,
                "Microsoft.Communication.RecordingFileStatusUpdated",
                StringComparison.Ordinal))
        {
            return false;
        }

        var subject = cloudEvent.TryGetProperty("subject", out var subjectElement)
            ? subjectElement.GetString() ?? ""
            : "";
        var providerRecordingId = RecordingIdFromSubject(subject);
        if (string.IsNullOrWhiteSpace(providerRecordingId) ||
            !cloudEvent.TryGetProperty("data", out var data) ||
            !data.TryGetProperty("recordingStorageInfo", out var storageInfo) ||
            !storageInfo.TryGetProperty("recordingChunks", out var chunks) ||
            chunks.ValueKind != JsonValueKind.Array)
        {
            throw new InvalidDataException(
                "The ACS recording event has an invalid payload.");
        }

        var duration = data.TryGetProperty(
            "recordingDurationMs",
            out var durationElement)
            ? durationElement.GetInt64()
            : 0;
        var locations = chunks
            .EnumerateArray()
            .OrderBy(chunk => chunk.GetProperty("index").GetInt32())
            .Select(chunk => chunk.GetProperty("contentLocation").GetString())
            .Where(location => Uri.TryCreate(location, UriKind.Absolute, out _))
            .Select(location => new Uri(location!))
            .ToArray();
        if (locations.Length == 0)
        {
            throw new InvalidDataException(
                "The ACS recording event does not contain any recording files.");
        }

        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ChatDbContext>();
        var recording = await db.SessionRecordings.SingleOrDefaultAsync(
            item =>
                item.ProviderRecordingId == providerRecordingId &&
                item.Status != "completed",
            cancellationToken);
        if (recording is null)
        {
            logger.LogInformation(
                "Ignoring ACS recording event {ProviderRecordingId} because no pending recording exists.",
                providerRecordingId);
            return true;
        }

        recording.ProviderContentLocationsJson = JsonSerializer.Serialize(
            locations.Select(location => location.AbsoluteUri));
        if (duration > 0)
        {
            recording.DurationMilliseconds = duration;
        }
        await db.SaveChangesAsync(cancellationToken);
        await FinalizeProviderRecordingAsync(
            new CallingProviderRecordingFile(
                providerRecordingId,
                locations,
                duration),
            cancellationToken);
        return true;
    }

    private async Task ResumeProviderRecordingsAsync(
        CancellationToken cancellationToken)
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
            await FinalizeProviderRecordingAsync(
                new CallingProviderRecordingFile(
                    item.ProviderRecordingId!,
                    uris,
                    item.DurationMilliseconds ?? 0),
                cancellationToken);
        }
    }

    private async Task FinalizeProviderRecordingAsync(
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

            var message = await SaveProviderRecordingMessageAsync(
                db,
                recording,
                messageId,
                attachments,
                providerFile.DurationMilliseconds,
                cancellationToken);
            recordingStates.Stop(recording.Id);
            var attachmentDtos = attachments
                .Select(ToProviderAttachmentDto)
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

    private static async Task<ChatMessage> SaveProviderRecordingMessageAsync(
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

    private static MessageAttachmentDto ToProviderAttachmentDto(
        MessageAttachment attachment) =>
        new(
            attachment.Id,
            attachment.FileName,
            attachment.ContentType,
            attachment.FileSize,
            null,
            null,
            attachment.DurationMs);

    private static string? RecordingIdFromSubject(string subject)
    {
        const string segment = "/recordingId/";
        var start = subject.LastIndexOf(
            segment,
            StringComparison.OrdinalIgnoreCase);
        return start < 0
            ? null
            : subject[(start + segment.Length)..].Split('/')[0];
    }

    private async Task ResumeBrowserRecordingsAsync(
        CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ChatDbContext>();
        var pendingIds = await db.SessionRecordings
            .Where(recording =>
                recording.Status == "processing" &&
                recording.Provider == "")
            .Select(recording => recording.Id)
            .ToListAsync(cancellationToken);
        foreach (var recordingId in pendingIds)
        {
            await FinalizeBrowserRecordingAsync(
                recordingId,
                cancellationToken);
        }
    }

    private async Task FinalizeBrowserRecordingAsync(
        Guid recordingId,
        CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ChatDbContext>();
        var recording = await db.SessionRecordings
            .Include(item => item.StartedByUser)
            .SingleOrDefaultAsync(
                item => item.Id == recordingId && item.Provider == "",
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
                        await OpenBrowserChunkAsync(
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
            var attachmentDto = await SaveBrowserRecordingAttachmentAsync(
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
                            recording = ToBrowserRecordingDto(recording),
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
        catch (OperationCanceledException) when (
            cancellationToken.IsCancellationRequested)
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
                await PublishBrowserRecordingFailedAsync(
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

    private Task<Stream?> OpenBrowserChunkAsync(
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

    private async Task<MessageAttachmentDto> SaveBrowserRecordingAttachmentAsync(
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

    private async Task PublishBrowserRecordingFailedAsync(
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
                    recording = ToBrowserRecordingDto(recording),
                    message
                });
        await SendBrowserSystemMessageAsync(
            db,
            recording.ConversationId,
            message,
            CancellationToken.None);
    }

    private async Task SendBrowserSystemMessageAsync(
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

    private static RecordingStateDto ToBrowserRecordingDto(
        SessionRecording recording) =>
        new(
            recording.Id,
            recording.ConversationId,
            recording.SessionId,
            recording.StartedByUserId,
            recording.StartedByUser.DisplayName,
            recording.StartedAt,
            recording.Status);

    private Task ProcessErrorAsync(ProcessErrorEventArgs args)
    {
        logger.LogError(
            args.Exception,
            "Azure Service Bus recording processor failed in {ErrorSource} for {EntityPath}.",
            args.ErrorSource,
            args.EntityPath);
        return Task.CompletedTask;
    }
}
