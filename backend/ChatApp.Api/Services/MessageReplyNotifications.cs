using ChatApp.Application.Data;
using ChatApp.Application.Models;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Services;

public static class MessageReplyNotifications
{
    public static async Task AddAsync(
        ChatDbContext db,
        Guid conversationId,
        Guid senderUserId,
        Guid messageId,
        Guid? replyToMessageId,
        string? preview,
        CancellationToken cancellationToken = default)
    {
        if (replyToMessageId is null) return;

        var recipientId = await db.Messages.AsNoTracking()
            .Where(message =>
                message.Id == replyToMessageId &&
                message.ConversationId == conversationId &&
                message.SenderUserId != null &&
                message.SenderUserId != senderUserId &&
                message.Sender != null &&
                message.Sender.Status == "active" &&
                message.Conversation.Members.Any(member =>
                    member.UserId == message.SenderUserId && member.LeftAt == null))
            .Select(message => message.SenderUserId)
            .SingleOrDefaultAsync(cancellationToken);
        if (recipientId is null) return;

        var title = string.IsNullOrWhiteSpace(preview)
            ? "Replied to your message"
            : preview.Trim();
        if (title.Length > 120) title = $"{title[..117]}...";

        db.UserNotifications.Add(new UserNotification
        {
            UserId = recipientId.Value,
            ActorUserId = senderUserId,
            Type = "message_reply",
            TargetId = messageId,
            ContextId = conversationId,
            TargetTitle = title,
        });
    }
}
