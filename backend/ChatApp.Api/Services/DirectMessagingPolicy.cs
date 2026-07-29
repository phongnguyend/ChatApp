using ChatApp.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Services;

public static class DirectMessagingPolicy
{
    public static async Task<bool> IsBlockedAsync(
        ChatDbContext db,
        Guid userId,
        Guid conversationId,
        CancellationToken cancellationToken = default)
    {
        var peerIds = db.ConversationMembers
            .Where(member =>
                member.ConversationId == conversationId &&
                member.Conversation.Type == "direct" &&
                member.UserId != userId &&
                member.LeftAt == null)
            .Select(member => member.UserId);

        return await db.UserBlocks.AnyAsync(
            block =>
                (block.BlockerUserId == userId &&
                 peerIds.Contains(block.BlockedUserId)) ||
                (block.BlockedUserId == userId &&
                 peerIds.Contains(block.BlockerUserId)),
            cancellationToken);
    }
}
