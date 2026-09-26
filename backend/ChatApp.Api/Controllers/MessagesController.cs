using ChatApp.Application.Contracts;
using ChatApp.Persistence;
using ChatApp.Api.Hubs;
using ChatApp.Domain.Models;
using ChatApp.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Controllers;

[ApiController]
[Route("api/messages")]
public sealed class MessagesController(
    ChatAppDbContext db,
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
                    x.MessageType != "poll" &&
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
        var wasPinned = message.PinnedAt is not null;
        message.PinnedAt = null;
        message.PinnedByUserId = null;
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
        if (wasPinned)
        {
            await hubContext.Clients.Group(ChatHub.ConversationGroup(message.ConversationId))
                .SendAsync(
                    "MessagePinChanged",
                    new MessagePinChangedDto(
                        message.ConversationId,
                        message.Id,
                        false,
                        null),
                    cancellationToken);
        }
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
            if (message.SenderUserId is Guid recipientId && recipientId != user.Id)
            {
                var preview = string.IsNullOrWhiteSpace(message.Content)
                    ? "Message"
                    : message.Content.Length > 120
                        ? $"{message.Content[..117]}..."
                        : message.Content;
                db.UserNotifications.Add(new UserNotification
                {
                    UserId = recipientId,
                    ActorUserId = user.Id,
                    Type = "message_reaction",
                    TargetId = message.Id,
                    ContextId = message.ConversationId,
                    TargetTitle = preview,
                    Details = request.Reaction,
                });
            }
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

    [HttpPost("{id:guid}/pin")]
    public async Task<ActionResult<MessagePinDto>> Pin(
        Guid id,
        [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var normalized = Username.Normalize(username);
        var user = await db.Users.SingleOrDefaultAsync(
            item => item.NormalizedUsername == normalized && item.Status == "active",
            cancellationToken);
        if (user is null) return NotFound();

        var message = await db.Messages
            .Include(item => item.Sender)
            .Include(item => item.PinnedByUser)
            .SingleOrDefaultAsync(
                item =>
                    item.Id == id &&
                    item.DeletedAt == null &&
                    item.Conversation.Members.Any(member =>
                        member.UserId == user.Id && member.LeftAt == null),
                cancellationToken);
        if (message is null) return NotFound();

        if (message.PinnedAt is not null) return Ok(ToPinDto(message));

        message.PinnedByUser = user;
        message.PinnedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        var result = ToPinDto(message);
        await hubContext.Clients.Group(ChatHub.ConversationGroup(message.ConversationId))
            .SendAsync(
                "MessagePinChanged",
                new MessagePinChangedDto(message.ConversationId, message.Id, true, result),
                cancellationToken);
        return Ok(result);
    }

    [HttpPost("{id:guid}/poll-vote")]
    public async Task<ActionResult<MessagePollVoteChangedDto>> VoteInPoll(
        Guid id,
        [FromQuery] string username,
        VoteMessagePollRequest request,
        CancellationToken cancellationToken)
    {
        var normalized = Username.Normalize(username);
        var user = await db.Users.SingleOrDefaultAsync(
            item => item.NormalizedUsername == normalized && item.Status == "active",
            cancellationToken);
        if (user is null) return NotFound();

        var message = await db.Messages
            .Include(item => item.Poll)
                .ThenInclude(poll => poll!.Options)
            .Include(item => item.Poll)
                .ThenInclude(poll => poll!.Votes)
            .SingleOrDefaultAsync(
                item =>
                    item.Id == id &&
                    item.MessageType == "poll" &&
                    item.DeletedAt == null &&
                    item.Conversation.Members.Any(member =>
                        member.UserId == user.Id && member.LeftAt == null),
                cancellationToken);
        if (message?.Poll is null)
        {
            return NotFound();
        }
        if (message.Poll.ExpiresAt <= DateTimeOffset.UtcNow)
        {
            return Conflict(new { message = "This poll has expired." });
        }

        var selectedOptionIds = (request.OptionIds ?? []).Distinct().ToArray();
        if ((!message.Poll.IsMultiple && selectedOptionIds.Length != 1) ||
            selectedOptionIds.Length > message.Poll.Options.Count ||
            selectedOptionIds.Any(optionId =>
                message.Poll.Options.All(option => option.Id != optionId)))
        {
            return BadRequest(new
            {
                message = message.Poll.IsMultiple
                    ? "Choose only options from this poll."
                    : "Single-choice polls require exactly one option."
            });
        }

        var existingVotes = message.Poll.Votes
            .Where(item => item.UserId == user.Id)
            .ToList();
        foreach (var vote in existingVotes.Where(vote =>
                     !selectedOptionIds.Contains(vote.OptionId)))
        {
            db.MessagePollVotes.Remove(vote);
        }
        foreach (var optionId in selectedOptionIds.Where(optionId =>
                     existingVotes.All(vote => vote.OptionId != optionId)))
        {
            db.MessagePollVotes.Add(new MessagePollVote
            {
                Poll = message.Poll,
                User = user,
                OptionId = optionId,
            });
        }
        await db.SaveChangesAsync(cancellationToken);

        var optionResults = await db.MessagePollOptions.AsNoTracking()
            .Where(option => option.PollMessageId == message.Id)
            .OrderBy(option => option.SortOrder)
            .Select(option => new MessagePollOptionResultDto(
                option.Id,
                option.Votes.Count))
            .ToListAsync(cancellationToken);
        var totalVoters = await db.MessagePollVotes.AsNoTracking()
            .Where(vote => vote.PollMessageId == message.Id)
            .Select(vote => vote.UserId)
            .Distinct()
            .CountAsync(cancellationToken);
        var changed = new MessagePollVoteChangedDto(
            message.Id,
            message.ConversationId,
            user.Id,
            selectedOptionIds,
            totalVoters,
            optionResults);
        await hubContext.Clients.Group(ChatHub.ConversationGroup(message.ConversationId))
            .SendAsync("MessagePollVoteChanged", changed, cancellationToken);
        return Ok(changed);
    }

    [HttpDelete("{id:guid}/pin")]
    public async Task<IActionResult> Unpin(
        Guid id,
        [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var normalized = Username.Normalize(username);
        var userId = await db.Users
            .Where(item => item.NormalizedUsername == normalized && item.Status == "active")
            .Select(item => (Guid?)item.Id)
            .SingleOrDefaultAsync(cancellationToken);
        if (userId is null) return NotFound();

        var message = await db.Messages.SingleOrDefaultAsync(
            item =>
                item.Id == id &&
                item.DeletedAt == null &&
                item.PinnedAt != null &&
                item.Conversation.Members.Any(member =>
                    member.UserId == userId && member.LeftAt == null),
            cancellationToken);
        if (message is null) return NoContent();

        var conversationId = message.ConversationId;
        message.PinnedAt = null;
        message.PinnedByUserId = null;
        await db.SaveChangesAsync(cancellationToken);
        await hubContext.Clients.Group(ChatHub.ConversationGroup(conversationId))
            .SendAsync(
                "MessagePinChanged",
                new MessagePinChangedDto(conversationId, id, false, null),
                cancellationToken);
        return NoContent();
    }

    private static MessageChangedDto ToChangedDto(ChatMessage message) =>
        new(
            message.Id,
            message.ConversationId,
            message.DeletedAt == null ? message.Content : null,
            message.EditedAt,
            message.DeletedAt);

    private static MessagePinDto ToPinDto(ChatMessage message) =>
        new(
            message.Id,
            message.ConversationId,
            message.SenderUserId,
            message.Sender?.Username,
            message.Content,
            message.MessageType,
            message.CreatedAt,
            message.PinnedByUserId!.Value,
            message.PinnedByUser!.DisplayName,
            message.PinnedAt!.Value);
}
