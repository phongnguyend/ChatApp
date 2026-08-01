using System.Data;
using System.Net.Http.Json;
using System.Text.Json;
using Azure.Messaging.ServiceBus;
using ChatApp.Application.Contracts;
using ChatApp.Application.Data;
using ChatApp.Application.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace ChatApp.Background;

public sealed record CallingProviderRecordingFile(
    string ProviderRecordingId,
    IReadOnlyList<Uri> ContentLocations,
    long DurationMilliseconds);

public sealed class ServiceBusRecordingWorker(
    ServiceBusClient client,
    HttpClient apiClient,
    IOptions<MessagingOptions> options,
    IServiceScopeFactory scopeFactory,
    ILogger<ServiceBusRecordingWorker> logger) : BackgroundService
{
    private ServiceBusProcessor? processor;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
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
            var handled = await HandleEventGridEventsAsync(args.Message);
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
            item => item.ProviderRecordingId == providerRecordingId,
            cancellationToken);
        if (recording is null)
        {
            logger.LogInformation(
                "Ignoring ACS recording event {ProviderRecordingId} because no pending recording exists.",
                providerRecordingId);
            return true;
        }
        if (recording.Status == "completed")
        {
            await NotifyApiAsync(recording.Id, cancellationToken);
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
        var recording = await db.SessionRecordings
            .Include(item => item.StartedByUser)
            .SingleOrDefaultAsync(
                item =>
                    item.ProviderRecordingId ==
                        providerFile.ProviderRecordingId,
                cancellationToken);
        if (recording is null)
        {
            return;
        }
        if (recording.Status == "completed")
        {
            await NotifyApiAsync(recording.Id, cancellationToken);
            return;
        }
        if (recording.Status != "processing")
        {
            throw new InvalidOperationException(
                "The provider recording is not awaiting finalization.");
        }

        var messageId = Guid.NewGuid();
        var attachments = providerFile.ContentLocations
            .Select((location, index) =>
            {
                var suffix = providerFile.ContentLocations.Count == 1
                    ? ""
                    : $"-part-{index + 1}";
                return new MessageAttachment
                {
                    Message = null!,
                    MessageId = messageId,
                    StorageKey = location.AbsoluteUri,
                    FileName =
                        $"recording-{recording.StartedAt:yyyyMMdd-HHmmss}{suffix}.mp4",
                    ContentType = "video/mp4",
                    FileSize = 0,
                    DurationMs = providerFile.DurationMilliseconds > 0
                        ? providerFile.DurationMilliseconds
                        : null
                };
            })
            .ToArray();
        try
        {
            await SaveProviderRecordingMessageAsync(
                db,
                recording,
                messageId,
                attachments,
                providerFile.DurationMilliseconds,
                cancellationToken);
        }
        catch
        {
            recording.Status = "failed";
            recording.CompletedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(CancellationToken.None);
            throw;
        }
        await NotifyApiAsync(recording.Id, cancellationToken);
    }

    private static async Task SaveProviderRecordingMessageAsync(
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
        recording.StorageObjectName = attachments.First().StorageKey;
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
    }

    private async Task NotifyApiAsync(
        Guid recordingId,
        CancellationToken cancellationToken)
    {
        using var response = await apiClient.PostAsJsonAsync(
            "api/recordings/internal/completed",
            new RecordingCompletedNotificationRequest(recordingId),
            cancellationToken);
        response.EnsureSuccessStatusCode();
    }

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
