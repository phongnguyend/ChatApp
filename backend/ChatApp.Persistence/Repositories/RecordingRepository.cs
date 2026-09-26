using System.Data;
using ChatApp.Application.Abstractions;
using ChatApp.Domain.Models;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Persistence.Repositories;

public sealed class RecordingRepository(ChatAppDbContext db) : IRecordingRepository
{
    public Task<SessionRecording?> FindByProviderIdAsync(string providerRecordingId, CancellationToken cancellationToken) =>
        db.SessionRecordings.SingleOrDefaultAsync(
            item => item.ProviderRecordingId == providerRecordingId, cancellationToken);

    public async Task SaveChangesAsync(CancellationToken cancellationToken) =>
        await db.SaveChangesAsync(cancellationToken);

    public async Task CompleteAsync(
        SessionRecording recording,
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

}
