using System.Data;
using System.Net.Http.Json;
using System.Text.Json;
using ChatApp.Application.Contracts;
using ChatApp.Application.Data;
using ChatApp.Application.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace ChatApp.Application.Handlers;

public sealed class RecordingFileStatusUpdatedHandler(
    ChatDbContext db,
    HttpClient apiClient,
    ILogger<RecordingFileStatusUpdatedHandler> logger)
{
    public async Task<bool> HandleAsync(
        JsonElement eventGridEvent,
        CancellationToken cancellationToken = default)
    {
        var eventType = eventGridEvent.TryGetProperty(
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

        var subject = eventGridEvent.TryGetProperty(
            "subject",
            out var subjectElement)
            ? subjectElement.GetString() ?? ""
            : "";
        var providerRecordingId = RecordingIdFromSubject(subject);
        if (string.IsNullOrWhiteSpace(providerRecordingId) ||
            !eventGridEvent.TryGetProperty("data", out var data) ||
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

        var recording = await db.SessionRecordings.SingleOrDefaultAsync(
            item => item.ProviderRecordingId == providerRecordingId,
            cancellationToken);
        if (recording is null)
        {
            logger.LogInformation(
                "Ignoring ACS recording event {ProviderRecordingId} because no recording exists.",
                providerRecordingId);
            return true;
        }
        if (recording.Status == "completed")
        {
            await NotifyApiAsync(recording.Id, cancellationToken);
            return true;
        }

        if (duration > 0)
        {
            recording.DurationMilliseconds = duration;
        }
        await db.SaveChangesAsync(cancellationToken);
        await FinalizeRecordingAsync(
            recording,
            locations,
            duration,
            cancellationToken);
        return true;
    }

    private async Task FinalizeRecordingAsync(
        SessionRecording recording,
        IReadOnlyList<Uri> contentLocations,
        long durationMilliseconds,
        CancellationToken cancellationToken)
    {
        var messageId = Guid.NewGuid();
        var attachments = contentLocations
            .Select((location, index) =>
            {
                var suffix = contentLocations.Count == 1
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
                    DurationMs = durationMilliseconds > 0
                        ? durationMilliseconds
                        : null
                };
            })
            .ToArray();
        try
        {
            await SaveRecordingMessageAsync(
                recording,
                messageId,
                attachments,
                durationMilliseconds,
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

    private async Task SaveRecordingMessageAsync(
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
}
