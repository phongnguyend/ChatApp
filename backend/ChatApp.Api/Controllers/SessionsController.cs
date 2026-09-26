using ChatApp.Application.Contracts;
using ChatApp.Persistence;
using ChatApp.Domain.Models;
using ChatApp.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Controllers;

[ApiController]
[Route("api/session")]
public sealed class SessionsController(ChatAppDbContext db) : ControllerBase
{
    [HttpPost]
    public async Task<ActionResult<UserDto>> Login(
        CancellationToken cancellationToken)
    {
        var userId = Guid.Parse(User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)!.Value);
        var user = await db.Users.SingleAsync(x => x.Id == userId, cancellationToken);
        user.LastSeenAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        var generalConversationId = await db.Conversations
            .Where(x => x.Type == "group" && x.Title == DatabaseInitializer.GeneralConversationTitle)
            .Select(x => x.Id)
            .SingleAsync(cancellationToken);

        var membership = await db.ConversationMembers.FindAsync(
            [generalConversationId, user.Id],
            cancellationToken);

        if (membership is null)
        {
            db.ConversationMembers.Add(new ConversationMember
            {
                ConversationId = generalConversationId,
                Conversation = null!,
                UserId = user.Id,
                User = null!,
                Role = "member"
            });
            await db.SaveChangesAsync(cancellationToken);
        }
        else if (membership.LeftAt is not null)
        {
            membership.LeftAt = null;
            membership.Role = "member";
            membership.JoinedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
        }

        await EnsureSelfConversation(user, cancellationToken);

        return Ok(new UserDto(user.Id, user.UserName, user.DisplayName, user.AvatarUrl));
    }

    private async Task EnsureSelfConversation(
        ChatUser user,
        CancellationToken cancellationToken)
    {
        var existing = await db.DirectConversations
            .Include(x => x.Conversation)
            .ThenInclude(x => x.Members)
            .SingleOrDefaultAsync(
                x => x.UserLowId == user.Id && x.UserHighId == user.Id,
                cancellationToken);

        if (existing is null)
        {
            var conversation = new Conversation
            {
                Type = "direct",
                CreatedByUserId = user.Id,
                CreatedByUser = user
            };
            conversation.Members.Add(new ConversationMember
            {
                Conversation = conversation,
                User = user,
                Role = "member"
            });
            db.DirectConversations.Add(new DirectConversation
            {
                Conversation = conversation,
                UserLow = user,
                UserHigh = user
            });
        }
        else
        {
            var membership = existing.Conversation.Members
                .SingleOrDefault(x => x.UserId == user.Id);
            if (membership is null)
            {
                existing.Conversation.Members.Add(new ConversationMember
                {
                    Conversation = existing.Conversation,
                    User = user,
                    Role = "member"
                });
            }
            else
            {
                membership.LeftAt = null;
                membership.Role = "member";
                membership.IsArchived = false;
            }
        }

        await db.SaveChangesAsync(cancellationToken);
    }
}
