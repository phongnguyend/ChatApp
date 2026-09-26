using ChatApp.Persistence;
using ChatApp.Domain.Models;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Services;

public static class MessageMentionNotifications
{
    public static async Task AddAsync(
        ChatAppDbContext db,
        Guid conversationId,
        Guid senderUserId,
        Guid messageId,
        string? content,
        IEnumerable<Guid>? mentionedUserIds,
        bool mentionEveryone,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(content)) return;

        var requestedIds = (mentionedUserIds ?? []).Distinct()
            .Where(id => id != senderUserId)
            .Take(100)
            .ToArray();
        var mentionsEveryone = mentionEveryone && ContainsMention(content, "everyone");
        if (requestedIds.Length == 0 && !mentionsEveryone) return;

        var recipients = await db.ConversationMembers.AsNoTracking()
            .Where(member =>
                member.ConversationId == conversationId &&
                member.LeftAt == null &&
                member.UserId != senderUserId &&
                (mentionsEveryone || requestedIds.Contains(member.UserId)) &&
                member.User.Status == "active")
            .Select(member => new { member.UserId, member.User.Username })
            .ToArrayAsync(cancellationToken);
        var preview = content.Length > 120 ? $"{content[..117]}..." : content;

        foreach (var recipient in recipients.Where(recipient =>
                     mentionsEveryone ||
                     ContainsMention(content, recipient.Username)))
            db.UserNotifications.Add(new UserNotification
            {
                UserId = recipient.UserId,
                ActorUserId = senderUserId,
                Type = "message_mention",
                TargetId = messageId,
                ContextId = conversationId,
                TargetTitle = preview,
            });
    }

    private static bool ContainsMention(string content, string username)
    {
        var token = $"@{username}";
        var start = 0;
        while (start < content.Length)
        {
            var index = content.IndexOf(token, start,
                StringComparison.OrdinalIgnoreCase);
            if (index < 0) return false;
            var beforeIsBoundary = index == 0 ||
                !IsUnquotedUsernameCharacter(content[index - 1]);
            var after = index + token.Length;
            var afterIsBoundary = after == content.Length ||
                !IsUnquotedUsernameCharacter(content[after]);
            if (beforeIsBoundary && afterIsBoundary) return true;
            start = index + token.Length;
        }
        return false;
    }

    private static bool IsUnquotedUsernameCharacter(char value) =>
        char.IsLetterOrDigit(value) || value is '_' or '.' or '-';
}
