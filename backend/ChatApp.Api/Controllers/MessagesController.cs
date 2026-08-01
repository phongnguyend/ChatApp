using ChatApp.Application.Contracts;
using ChatApp.Application.Data;
using ChatApp.Api.Hubs;
using ChatApp.Application.Models;
using ChatApp.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Controllers;

[ApiController]
[Route("api/messages")]
public sealed class MessagesController(
    ChatDbContext db,
    IHubContext<ChatHub> hubContext) : ControllerBase
{
    private static readonly HashSet<string> AllowedReactions =
    [
        "👍",
        "❤️",
        "😂",
        "😮",
        "😢",
        "🎉"
    ];

    [HttpPatch("{id:guid}")]
    public async Task<ActionResult<MessageChangedDto>> Edit(
        Guid id,
        [FromQuery] string username,
        UpdateMessageRequest request,
        CancellationToken cancellationToken)
    {
        var content = request.Content?.Trim() ?? "";
        if (content.Length is < 1 or > 2000)
        {
            return BadRequest(new
            {
                message = "Messages must contain 1–2,000 characters."
            });
        }

        var normalized = Username.Normalize(username);
        var user = await db.Users.SingleOrDefaultAsync(
            x => x.NormalizedUsername == normalized && x.Status == "active",
            cancellationToken);
        if (user is null)
        {
            return NotFound();
        }

        var message = await db.Messages
            .Include(x => x.Conversation)
            .SingleOrDefaultAsync(
                x =>
                    x.Id == id &&
                    x.SenderUserId == user.Id &&
                    x.MessageType != "system" &&
                    x.MessageType != "location" &&
                    x.MessageType != "live_location" &&
                    x.DeletedAt == null,
                cancellationToken);
        if (message is null)
        {
            return NotFound();
        }

        if (message.Content == content)
        {
            return Ok(ToChangedDto(message));
        }

        db.MessageVersions.Add(new MessageVersion
        {
            Message = message,
            Content = message.Content,
            EditedBy = user.Id,
            Editor = user
        });
        message.Content = content;
        message.EditedAt = DateTimeOffset.UtcNow;
        message.Conversation.UpdatedAt = message.EditedAt.Value;
        await db.SaveChangesAsync(cancellationToken);

        var changed = ToChangedDto(message);
        await hubContext.Clients.Group(ChatHub.ConversationGroup(message.ConversationId))
            .SendAsync("MessageChanged", changed, cancellationToken);
        return Ok(changed);
    }

    [HttpDelete("{id:guid}")]
    public async Task<ActionResult<MessageChangedDto>> Delete(
        Guid id,
        [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var normalized = Username.Normalize(username);
        var userId = await db.Users
            .Where(x => x.NormalizedUsername == normalized && x.Status == "active")
            .Select(x => (Guid?)x.Id)
            .SingleOrDefaultAsync(cancellationToken);
        if (userId is null)
        {
            return NotFound();
        }

        var message = await db.Messages
            .Include(x => x.Conversation)
            .Include(x => x.LiveLocationShare)
            .SingleOrDefaultAsync(
                x =>
                    x.Id == id &&
                    x.SenderUserId == userId &&
                    x.MessageType != "system" &&
                    x.DeletedAt == null,
                cancellationToken);
        if (message is null)
        {
            return NotFound();
        }

        message.DeletedAt = DateTimeOffset.UtcNow;
        if (message.LiveLocationShare?.IsActive == true)
        {
            message.LiveLocationShare.IsActive = false;
            message.LiveLocationShare.StoppedAt = message.DeletedAt;
        }
        message.Conversation.UpdatedAt = message.DeletedAt.Value;
        await db.SaveChangesAsync(cancellationToken);

        if (message.LiveLocationShare?.StoppedAt is not null)
        {
            await hubContext.Clients
                .Group(ChatHub.ConversationGroup(message.ConversationId))
                .SendAsync(
                    "LiveLocationStopped",
                    new LiveLocationStoppedDto(
                        message.Id,
                        message.ConversationId,
                        message.LiveLocationShare.StoppedAt.Value),
                    cancellationToken);
        }
        var changed = ToChangedDto(message);
        await hubContext.Clients.Group(ChatHub.ConversationGroup(message.ConversationId))
            .SendAsync("MessageChanged", changed, cancellationToken);
        return Ok(changed);
    }

    [HttpPost("{id:guid}/reactions")]
    public async Task<ActionResult<MessageReactionChangedDto>> ToggleReaction(
        Guid id,
        [FromQuery] string username,
        ToggleMessageReactionRequest request,
        CancellationToken cancellationToken)
    {
        if (!AllowedReactions.Contains(request.Reaction))
        {
            return BadRequest(new { message = "Choose a supported reaction." });
        }

        var normalized = Username.Normalize(username);
        var user = await db.Users.SingleOrDefaultAsync(
            x => x.NormalizedUsername == normalized && x.Status == "active",
            cancellationToken);
        if (user is null)
        {
            return NotFound();
        }

        var message = await db.Messages
            .SingleOrDefaultAsync(
                x =>
                    x.Id == id &&
                    x.DeletedAt == null &&
                    x.Conversation.Members.Any(member =>
                        member.UserId == user.Id && member.LeftAt == null),
                cancellationToken);
        if (message is null)
        {
            return NotFound();
        }

        var existing = await db.MessageReactions.FindAsync(
            [message.Id, user.Id, request.Reaction],
            cancellationToken);
        var isAdded = existing is null;
        if (existing is null)
        {
            db.MessageReactions.Add(new MessageReaction
            {
                Message = message,
                User = user,
                Reaction = request.Reaction
            });
        }
        else
        {
            db.MessageReactions.Remove(existing);
        }
        await db.SaveChangesAsync(cancellationToken);

        var changed = new MessageReactionChangedDto(
            message.Id,
            message.ConversationId,
            user.Id,
            user.DisplayName,
            user.AvatarUrl,
            request.Reaction,
            isAdded);
        await hubContext.Clients.Group(ChatHub.ConversationGroup(message.ConversationId))
            .SendAsync("MessageReactionChanged", changed, cancellationToken);
        return Ok(changed);
    }

    private static MessageChangedDto ToChangedDto(ChatMessage message) =>
        new(
            message.Id,
            message.ConversationId,
            message.DeletedAt == null ? message.Content : null,
            message.EditedAt,
            message.DeletedAt);
}
