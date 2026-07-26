using System.Data;
using System.Data.SqlTypes;
using ChatApp.Api.Contracts;
using ChatApp.Api.Data;
using ChatApp.Api.Hubs;
using ChatApp.Api.Models;
using ChatApp.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Controllers;

[ApiController]
[Route("api/conversations")]
public sealed class ConversationsController(
    ChatDbContext db,
    IHubContext<ChatHub> hubContext,
    PresenceTracker presence,
    IAvatarStorage avatarStorage,
    IMessageAttachmentStorage attachmentStorage,
    AzurePushNotificationService pushNotifications) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<ConversationDto>>> GetForUser(
        [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var normalized = Username.Normalize(username);
        var now = DateTimeOffset.UtcNow;
        var userId = await db.Users
            .Where(x => x.NormalizedUsername == normalized)
            .Select(x => (Guid?)x.Id)
            .SingleOrDefaultAsync(cancellationToken);

        if (userId is null)
        {
            return NotFound();
        }

        var conversations = await db.ConversationMembers
            .AsNoTracking()
            .Where(x =>
                x.UserId == userId &&
                x.LeftAt == null &&
                !x.IsArchived &&
                !x.Conversation.IsArchived)
            .OrderByDescending(x => x.Conversation.LastMessageAt ?? x.Conversation.CreatedAt)
            .Select(x => new ConversationDto(
                x.ConversationId,
                x.Conversation.Type,
                x.Conversation.Type == "direct"
                    ? x.Conversation.Members
                        .Where(member => member.UserId != userId && member.LeftAt == null)
                        .Select(member => member.User.DisplayName)
                        .FirstOrDefault() ?? x.User.DisplayName
                    : x.Conversation.Title,
                x.Conversation.Type == "direct"
                    ? x.Conversation.Members
                        .Where(member => member.UserId != userId && member.LeftAt == null)
                        .Select(member => member.User.AvatarUrl)
                        .FirstOrDefault() ?? x.User.AvatarUrl
                    : x.Conversation.AvatarUrl,
                x.Conversation.LastMessage == null || x.Conversation.LastMessage.DeletedAt != null
                    ? null
                    : x.Conversation.LastMessage.Content ??
                      (x.Conversation.LastMessage.MessageType == "image"
                          ? "Sent an image"
                          : x.Conversation.LastMessage.MessageType == "video"
                              ? "Sent a video"
                          : x.Conversation.LastMessage.MessageType == "audio"
                              ? "Sent a voice message"
                          : x.Conversation.LastMessage.MessageType == "file"
                              ? "Sent a file"
                              : null),
                x.Conversation.LastMessage == null || x.Conversation.LastMessage.DeletedAt != null
                    ? null
                    : x.Conversation.LastMessage.SenderUserId,
                x.Conversation.LastMessage == null ||
                x.Conversation.LastMessage.DeletedAt != null ||
                x.Conversation.LastMessage.Sender == null
                    ? null
                    : x.Conversation.LastMessage.Sender.DisplayName,
                x.Conversation.LastMessageAt,
                x.UnreadCount,
                x.Conversation.Members.Count(member => member.LeftAt == null),
                x.MutedUntil != null && x.MutedUntil > now))
            .ToListAsync(cancellationToken);

        return Ok(conversations);
    }

    [HttpPatch("{id:guid}/members/me/mute")]
    public async Task<ActionResult<ConversationMuteChangedDto>> UpdateMute(
        Guid id,
        [FromQuery] string username,
        UpdateConversationMuteRequest request,
        CancellationToken cancellationToken)
    {
        var normalized = Username.Normalize(username);
        var membership = await db.ConversationMembers
            .Include(x => x.User)
            .SingleOrDefaultAsync(
                x =>
                    x.ConversationId == id &&
                    x.User.NormalizedUsername == normalized &&
                    x.LeftAt == null,
                cancellationToken);
        if (membership is null)
        {
            return NotFound();
        }

        membership.MutedUntil = request.IsMuted
            ? DateTimeOffset.UtcNow.AddYears(10)
            : null;
        await db.SaveChangesAsync(cancellationToken);

        var changed = new ConversationMuteChangedDto(id, request.IsMuted);
        var connectionIds = presence.ConnectionIdsForUser(membership.UserId);
        if (connectionIds.Count > 0)
        {
            await hubContext.Clients.Clients(connectionIds)
                .SendAsync("ConversationMuteChanged", changed, cancellationToken);
        }

        return Ok(changed);
    }

    [HttpPost]
    public async Task<ActionResult<ConversationDto>> CreateGroup(
        [FromQuery] string username,
        CreateConversationRequest request,
        CancellationToken cancellationToken)
    {
        var title = request.Title?.Trim() ?? "";
        if (title.Length is < 2 or > 200)
        {
            return BadRequest(new
            {
                message = "Conversation names must contain 2–200 characters."
            });
        }

        var normalized = Username.Normalize(username);
        var selectedUsernames = NormalizeUsernames(request.Usernames)
            .Where(value => value != normalized)
            .ToArray();
        if (selectedUsernames.Length == 0)
        {
            return BadRequest(new { message = "Choose at least one person for the group." });
        }

        if (selectedUsernames.Length > 50)
        {
            return BadRequest(new { message = "A group can add up to 50 people at a time." });
        }

        var creator = await db.Users.SingleOrDefaultAsync(
            x => x.NormalizedUsername == normalized,
            cancellationToken);
        if (creator is null)
        {
            return NotFound();
        }

        var selectedUsers = await db.Users
            .Where(x =>
                x.Status == "active" &&
                selectedUsernames.Contains(x.NormalizedUsername))
            .ToListAsync(cancellationToken);
        if (selectedUsers.Count != selectedUsernames.Length)
        {
            return BadRequest(new
            {
                message = "One or more selected people are no longer available."
            });
        }

        var conversation = new Conversation
        {
            Type = "group",
            Title = title,
            CreatedByUserId = creator.Id,
            CreatedByUser = creator
        };
        conversation.Members.Add(new ConversationMember
        {
            Conversation = conversation,
            User = creator,
            Role = "owner"
        });
        foreach (var selectedUser in selectedUsers)
        {
            conversation.Members.Add(new ConversationMember
            {
                Conversation = conversation,
                User = selectedUser,
                Role = "member"
            });
        }

        db.Conversations.Add(conversation);
        await db.SaveChangesAsync(cancellationToken);

        var result = new ConversationDto(
            conversation.Id,
            conversation.Type,
            conversation.Title,
            conversation.AvatarUrl,
            null,
            null,
            null,
            null,
            0,
            conversation.Members.Count);

        await AddConnectedGroupMembers(
            conversation.Id,
            [creator, .. selectedUsers],
            result,
            cancellationToken);

        return CreatedAtAction(
            nameof(GetMessages),
            new { id = conversation.Id, username },
            result);
    }

    [HttpPost("direct")]
    public async Task<ActionResult<ConversationDto>> CreateDirect(
        [FromQuery] string username,
        CreateDirectConversationRequest request,
        CancellationToken cancellationToken)
    {
        var currentNormalized = Username.Normalize(username);
        var targetNormalized = Username.Normalize(request.Username);
        if (targetNormalized == "")
        {
            return BadRequest(new { message = "Choose a person to message." });
        }

        var users = await db.Users
            .Where(x =>
                x.NormalizedUsername == currentNormalized ||
                x.NormalizedUsername == targetNormalized)
            .ToListAsync(cancellationToken);
        var currentUser = users.SingleOrDefault(x => x.NormalizedUsername == currentNormalized);
        var targetUser = users.SingleOrDefault(x => x.NormalizedUsername == targetNormalized);

        if (currentUser is null)
        {
            return NotFound(new { message = "Your user could not be found." });
        }

        if (targetUser is null || targetUser.Status != "active")
        {
            return NotFound(new { message = "That person could not be found." });
        }

        if (currentUser.Id == targetUser.Id)
        {
            return BadRequest(new { message = "Choose someone other than yourself." });
        }

        var (userLow, userHigh) =
            new SqlGuid(currentUser.Id).CompareTo(new SqlGuid(targetUser.Id)) < 0
                ? (currentUser, targetUser)
                : (targetUser, currentUser);

        await using var transaction = await db.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);

        var existing = await db.DirectConversations
            .Include(x => x.Conversation)
            .ThenInclude(x => x.Members)
            .Include(x => x.Conversation)
            .ThenInclude(x => x.LastMessage)
            .ThenInclude(x => x!.Sender)
            .SingleOrDefaultAsync(
                x => x.UserLowId == userLow.Id && x.UserHighId == userHigh.Id,
                cancellationToken);

        if (existing is not null)
        {
            foreach (var membership in existing.Conversation.Members)
            {
                membership.LeftAt = null;
                membership.IsArchived = false;
            }

            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            var result = ToDirectDto(
                existing.Conversation,
                targetUser.DisplayName,
                targetUser.AvatarUrl,
                existing.Conversation.Members
                    .Single(x => x.UserId == currentUser.Id)
                    .UnreadCount);
            await AddConnectedUsersToDirectConversation(
                existing.ConversationId,
                currentUser,
                targetUser,
                result,
                existing.Conversation.Members
                    .Single(x => x.UserId == targetUser.Id)
                    .UnreadCount,
                cancellationToken);
            return Ok(result);
        }

        var conversation = new Conversation
        {
            Type = "direct",
            CreatedByUserId = currentUser.Id,
            CreatedByUser = currentUser
        };
        conversation.Members.Add(new ConversationMember
        {
            Conversation = conversation,
            User = currentUser,
            Role = "member"
        });
        conversation.Members.Add(new ConversationMember
        {
            Conversation = conversation,
            User = targetUser,
            Role = "member"
        });
        db.DirectConversations.Add(new DirectConversation
        {
            Conversation = conversation,
            UserLow = userLow,
            UserHigh = userHigh
        });

        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        var created = ToDirectDto(
            conversation,
            targetUser.DisplayName,
            targetUser.AvatarUrl);
        await AddConnectedUsersToDirectConversation(
            conversation.Id,
            currentUser,
            targetUser,
            created,
            0,
            cancellationToken);

        return CreatedAtAction(
            nameof(GetMessages),
            new { id = conversation.Id, username },
            created);
    }

    [HttpPost("{id:guid}/avatar")]
    [RequestSizeLimit(6 * 1024 * 1024)]
    public async Task<ActionResult<ConversationAvatarUpdatedDto>> UpdateGroupAvatar(
        Guid id,
        [FromQuery] string username,
        [FromForm] IFormFile image,
        CancellationToken cancellationToken)
    {
        var normalized = Username.Normalize(username);
        var requesterId = await db.Users
            .Where(x => x.NormalizedUsername == normalized)
            .Select(x => (Guid?)x.Id)
            .SingleOrDefaultAsync(cancellationToken);
        if (requesterId is null)
        {
            return NotFound();
        }

        var conversation = await db.Conversations.SingleOrDefaultAsync(
            x => x.Id == id && x.Type == "group" && !x.IsArchived,
            cancellationToken);
        if (conversation is null)
        {
            return NotFound();
        }

        if (!await db.ConversationMembers.AnyAsync(
                x =>
                    x.ConversationId == id &&
                    x.UserId == requesterId &&
                    x.LeftAt == null,
                cancellationToken))
        {
            return Forbid();
        }

        string avatarUrl;
        try
        {
            avatarUrl = await avatarStorage.SaveAsync(image, cancellationToken);
        }
        catch (InvalidDataException exception)
        {
            return BadRequest(new { message = exception.Message });
        }

        conversation.AvatarUrl = avatarUrl;
        conversation.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        var updated = new ConversationAvatarUpdatedDto(id, avatarUrl);
        await hubContext.Clients.Group(ChatHub.ConversationGroup(id))
            .SendAsync("ConversationAvatarUpdated", updated, cancellationToken);

        return Ok(updated);
    }

    [HttpPatch("{id:guid}/title")]
    public async Task<ActionResult<ConversationRenamedDto>> RenameGroup(
        Guid id,
        [FromQuery] string username,
        UpdateConversationTitleRequest request,
        CancellationToken cancellationToken)
    {
        var title = request.Title?.Trim() ?? "";
        if (title.Length is < 2 or > 200)
        {
            return BadRequest(new
            {
                message = "Conversation names must contain 2–200 characters."
            });
        }

        var normalized = Username.Normalize(username);
        var requester = await db.Users.SingleOrDefaultAsync(
            x => x.NormalizedUsername == normalized,
            cancellationToken);
        if (requester is null)
        {
            return NotFound();
        }

        await using var transaction = await db.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);

        var conversation = await db.Conversations.SingleOrDefaultAsync(
            x => x.Id == id && x.Type == "group" && !x.IsArchived,
            cancellationToken);
        if (conversation is null)
        {
            return NotFound();
        }

        var isMember = await db.ConversationMembers.AnyAsync(
            x =>
                x.ConversationId == id &&
                x.UserId == requester.Id &&
                x.LeftAt == null,
            cancellationToken);
        if (!isMember)
        {
            return Forbid();
        }

        if (conversation.Title == DatabaseInitializer.GeneralConversationTitle)
        {
            return BadRequest(new
            {
                message = "The General conversation keeps its default name."
            });
        }

        if (string.Equals(conversation.Title, title, StringComparison.Ordinal))
        {
            return Ok(new ConversationRenamedDto(conversation.Id, title));
        }

        var nextSequence = await db.Messages
            .Where(x => x.ConversationId == id)
            .Select(x => (long?)x.SequenceNumber)
            .MaxAsync(cancellationToken) ?? 0;
        var now = DateTimeOffset.UtcNow;
        var systemMessage = new ChatMessage
        {
            Conversation = conversation,
            MessageType = "system",
            Content = $"{requester.DisplayName} changed the group name to \"{title}\".",
            SequenceNumber = nextSequence + 1,
            CreatedAt = now
        };

        conversation.Title = title;
        conversation.UpdatedAt = now;
        conversation.LastMessage = systemMessage;
        conversation.LastMessageId = systemMessage.Id;
        conversation.LastMessageAt = now;
        db.Messages.Add(systemMessage);

        await db.ConversationMembers
            .Where(x =>
                x.ConversationId == id &&
                x.UserId != requester.Id &&
                x.LeftAt == null)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(
                    x => x.UnreadCount,
                    x => x.UnreadCount + 1),
                cancellationToken);

        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        var renamed = new ConversationRenamedDto(conversation.Id, title);
        var message = new MessageDto(
            systemMessage.Id,
            conversation.Id,
            null,
            null,
            null,
            systemMessage.Content,
            systemMessage.MessageType,
            null,
            systemMessage.SequenceNumber,
            null,
            systemMessage.CreatedAt,
            null,
            null);

        await hubContext.Clients.Group(ChatHub.ConversationGroup(id))
            .SendAsync("ConversationRenamed", renamed, cancellationToken);
        await hubContext.Clients.Group(ChatHub.ConversationGroup(id))
            .SendAsync("MessageReceived", message, cancellationToken);

        return Ok(renamed);
    }

    [HttpDelete("{id:guid}/members/me")]
    public async Task<IActionResult> LeaveGroup(
        Guid id,
        [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var normalized = Username.Normalize(username);
        var requester = await db.Users.SingleOrDefaultAsync(
            x => x.NormalizedUsername == normalized,
            cancellationToken);
        if (requester is null)
        {
            return NotFound();
        }

        await using var transaction = await db.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);

        var conversation = await db.Conversations
            .Include(x => x.Members)
            .SingleOrDefaultAsync(
                x => x.Id == id && x.Type == "group" && !x.IsArchived,
                cancellationToken);
        if (conversation is null)
        {
            return NotFound();
        }

        if (conversation.Title == DatabaseInitializer.GeneralConversationTitle)
        {
            return BadRequest(new
            {
                message = "You cannot leave the General conversation."
            });
        }

        var membership = conversation.Members.SingleOrDefault(
            x => x.UserId == requester.Id && x.LeftAt == null);
        if (membership is null)
        {
            return NotFound();
        }

        var nextSequence = await db.Messages
            .Where(x => x.ConversationId == id)
            .Select(x => (long?)x.SequenceNumber)
            .MaxAsync(cancellationToken) ?? 0;
        var now = DateTimeOffset.UtcNow;
        var systemMessage = new ChatMessage
        {
            Conversation = conversation,
            MessageType = "system",
            Content = $"{requester.DisplayName} left the group.",
            SequenceNumber = nextSequence + 1,
            CreatedAt = now
        };

        membership.LeftAt = now;
        membership.Role = "member";
        membership.IsArchived = true;
        membership.UnreadCount = 0;
        conversation.UpdatedAt = now;
        conversation.LastMessage = systemMessage;
        conversation.LastMessageId = systemMessage.Id;
        conversation.LastMessageAt = now;
        db.Messages.Add(systemMessage);

        await db.ConversationMembers
            .Where(x =>
                x.ConversationId == id &&
                x.UserId != requester.Id &&
                x.LeftAt == null)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(
                    x => x.UnreadCount,
                    x => x.UnreadCount + 1),
                cancellationToken);

        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        var groupName = ChatHub.ConversationGroup(id);
        var requesterConnections = presence.ConnectionIdsForUser(requester.Id);
        foreach (var connectionId in requesterConnections)
        {
            await hubContext.Groups.RemoveFromGroupAsync(
                connectionId,
                groupName,
                cancellationToken);
        }

        if (requesterConnections.Count > 0)
        {
            await hubContext.Clients.Clients(requesterConnections)
                .SendAsync(
                    "ConversationRemoved",
                    new ConversationRemovedDto(id),
                    cancellationToken);
        }

        var memberCount = conversation.Members.Count(x => x.LeftAt == null);
        await hubContext.Clients.Group(groupName)
            .SendAsync(
                "MembersChanged",
                new MembersChangedDto(id, memberCount),
                cancellationToken);

        var message = new MessageDto(
            systemMessage.Id,
            id,
            null,
            null,
            null,
            systemMessage.Content,
            systemMessage.MessageType,
            null,
            systemMessage.SequenceNumber,
            null,
            systemMessage.CreatedAt,
            null,
            null);
        await hubContext.Clients.Group(groupName)
            .SendAsync("MessageReceived", message, cancellationToken);

        return NoContent();
    }

    [HttpGet("{id:guid}/messages")]
    public async Task<ActionResult<IReadOnlyList<MessageDto>>> GetMessages(
        Guid id,
        [FromQuery] string username,
        [FromQuery] int limit = 80,
        CancellationToken cancellationToken = default)
    {
        if (!await IsActiveMember(id, username, cancellationToken))
        {
            return NotFound();
        }

        var normalizedUsername = Username.Normalize(username);
        limit = Math.Clamp(limit, 1, 100);
        var messageEntities = await db.Messages
            .AsNoTracking()
            .AsSplitQuery()
            .Include(x => x.Sender)
            .Include(x => x.Attachments)
            .Include(x => x.Reactions)
                .ThenInclude(reaction => reaction.User)
            .Where(x => x.ConversationId == id)
            .OrderByDescending(x => x.SequenceNumber)
            .Take(limit)
            .ToListAsync(cancellationToken);

        var messages = messageEntities
            .Select(x => new MessageDto(
                x.Id,
                x.ConversationId,
                x.SenderUserId,
                x.Sender == null ? null : x.Sender.Username,
                x.Sender == null ? null : x.Sender.AvatarUrl,
                x.DeletedAt == null ? x.Content : null,
                x.MessageType,
                x.ClientMessageId,
                x.SequenceNumber,
                x.ReplyToMessageId,
                x.CreatedAt,
                x.EditedAt,
                x.DeletedAt,
                x.DeletedAt == null
                    ? x.Attachments
                        .OrderBy(attachment => attachment.CreatedAt)
                        .Select(attachment => new MessageAttachmentDto(
                            attachment.Id,
                            attachment.FileName,
                            attachment.ContentType,
                            attachment.FileSize,
                            attachment.Width,
                            attachment.Height))
                        .ToList()
                    : new List<MessageAttachmentDto>(),
                x.DeletedAt == null
                    ? x.Reactions
                        .GroupBy(reaction => reaction.Reaction)
                        .Select(group => new MessageReactionDto(
                            group.Key,
                            group.Count(),
                            group.Any(reaction =>
                                reaction.User.NormalizedUsername == normalizedUsername),
                            group
                                .OrderBy(reaction => reaction.CreatedAt)
                                .Select(reaction => new MessageReactionUserDto(
                                    reaction.UserId,
                                    reaction.User.DisplayName,
                                    reaction.User.AvatarUrl))
                                .ToList()))
                        .ToList()
                    : new List<MessageReactionDto>()))
            .ToList();

        messages.Reverse();
        return Ok(messages);
    }

    [HttpPost("{id:guid}/messages/attachments")]
    [RequestSizeLimit(80 * 1024 * 1024)]
    public async Task<ActionResult<MessageDto>> SendAttachmentMessage(
        Guid id,
        [FromQuery] string username,
        [FromForm] List<IFormFile> files,
        [FromForm] string? content,
        [FromForm] string clientMessageId,
        CancellationToken cancellationToken)
    {
        var normalized = Username.Normalize(username);
        var sender = await db.Users.SingleOrDefaultAsync(
            x => x.NormalizedUsername == normalized && x.Status == "active",
            cancellationToken);
        if (sender is null)
        {
            return NotFound();
        }

        var isMember = await db.ConversationMembers.AnyAsync(
            x => x.ConversationId == id && x.UserId == sender.Id && x.LeftAt == null,
            cancellationToken);
        if (!isMember)
        {
            return NotFound();
        }

        var messageContent = content?.Trim();
        var cleanClientMessageId = clientMessageId?.Trim() ?? "";
        if (files.Count is < 1 ||
            files.Count > attachmentStorage.MaxFilesPerMessage)
        {
            return BadRequest(new { message = "Choose between 1 and 5 attachments." });
        }
        if (messageContent?.Length > 2000 || cleanClientMessageId.Length is < 1 or > 100)
        {
            return BadRequest(new
            {
                message = "Messages can contain up to 2,000 characters."
            });
        }

        var existing = await db.Messages
            .AsNoTracking()
            .Where(x =>
                x.SenderUserId == sender.Id &&
                x.ClientMessageId == cleanClientMessageId)
            .Select(x => new MessageDto(
                x.Id,
                x.ConversationId,
                x.SenderUserId,
                x.Sender == null ? null : x.Sender.Username,
                x.Sender == null ? null : x.Sender.AvatarUrl,
                x.DeletedAt == null ? x.Content : null,
                x.MessageType,
                x.ClientMessageId,
                x.SequenceNumber,
                x.ReplyToMessageId,
                x.CreatedAt,
                x.EditedAt,
                x.DeletedAt,
                x.Attachments
                    .OrderBy(attachment => attachment.CreatedAt)
                    .Select(attachment => new MessageAttachmentDto(
                        attachment.Id,
                        attachment.FileName,
                        attachment.ContentType,
                        attachment.FileSize,
                        attachment.Width,
                        attachment.Height))
                    .ToList()))
            .SingleOrDefaultAsync(cancellationToken);
        if (existing is not null)
        {
            return Ok(existing);
        }

        var messageId = Guid.NewGuid();
        var storedKeys = new List<string>();
        var attachments = new List<MessageAttachment>();
        try
        {
            foreach (var file in files)
            {
                var storageKey = await attachmentStorage.SaveAsync(
                    id,
                    messageId,
                    file,
                    cancellationToken);
                storedKeys.Add(storageKey);
                attachments.Add(new MessageAttachment
                {
                    MessageId = messageId,
                    Message = null!,
                    StorageKey = storageKey,
                    FileName = attachmentStorage.CleanFileName(file.FileName),
                    ContentType = file.ContentType,
                    FileSize = file.Length
                });
            }
        }
        catch (InvalidDataException exception)
        {
            foreach (var storageKey in storedKeys)
            {
                await attachmentStorage.DeleteAsync(
                    storageKey,
                    CancellationToken.None);
            }
            return BadRequest(new { message = exception.Message });
        }
        catch
        {
            foreach (var storageKey in storedKeys)
            {
                await attachmentStorage.DeleteAsync(
                    storageKey,
                    CancellationToken.None);
            }
            throw;
        }

        var committed = false;
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(
                IsolationLevel.Serializable,
                cancellationToken);
            var conversation = await db.Conversations.SingleAsync(
                x => x.Id == id,
                cancellationToken);
            var nextSequence = await db.Messages
                .Where(x => x.ConversationId == id)
                .Select(x => (long?)x.SequenceNumber)
                .MaxAsync(cancellationToken) ?? 0;
            var now = DateTimeOffset.UtcNow;
            var message = new ChatMessage
            {
                Id = messageId,
                Conversation = conversation,
                SenderUserId = sender.Id,
                Sender = sender,
                MessageType = attachments.All(attachment =>
                        attachmentStorage.IsDisplayableImage(attachment.ContentType))
                    ? "image"
                    : attachments.All(attachment =>
                        attachmentStorage.IsDisplayableVideo(attachment.ContentType))
                        ? "video"
                    : attachments.All(attachment =>
                        attachmentStorage.IsDisplayableAudio(attachment.ContentType))
                        ? "audio"
                        : "file",
                Content = string.IsNullOrWhiteSpace(messageContent) ? null : messageContent,
                ClientMessageId = cleanClientMessageId,
                SequenceNumber = nextSequence + 1,
                CreatedAt = now,
                Attachments = attachments
            };
            foreach (var attachment in attachments)
            {
                attachment.Message = message;
            }

            db.Messages.Add(message);
            conversation.LastMessage = message;
            conversation.LastMessageId = message.Id;
            conversation.LastMessageAt = now;
            conversation.UpdatedAt = now;
            await db.ConversationMembers
                .Where(x =>
                    x.ConversationId == id &&
                    x.UserId != sender.Id &&
                    x.LeftAt == null)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(
                        x => x.UnreadCount,
                        x => x.UnreadCount + 1),
                    cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            committed = true;

            var attachmentDtos = attachments.Select(attachment =>
                new MessageAttachmentDto(
                    attachment.Id,
                    attachment.FileName,
                    attachment.ContentType,
                    attachment.FileSize,
                    attachment.Width,
                    attachment.Height))
                .ToList();
            var result = new MessageDto(
                message.Id,
                message.ConversationId,
                sender.Id,
                sender.Username,
                sender.AvatarUrl,
                message.Content,
                message.MessageType,
                message.ClientMessageId,
                message.SequenceNumber,
                null,
                message.CreatedAt,
                null,
                null,
                attachmentDtos);

            await hubContext.Clients.Group(ChatHub.ConversationGroup(id))
                .SendAsync("MessageReceived", result, cancellationToken);
            var notificationPreview = result.Content ??
                (result.MessageType == "image"
                    ? "Sent an image"
                    : result.MessageType == "video"
                        ? "Sent a video"
                    : result.MessageType == "audio"
                        ? "Sent a voice message"
                        : "Sent a file");
            await pushNotifications.NotifyMessageAsync(
                id,
                sender.Id,
                sender.DisplayName,
                notificationPreview,
                cancellationToken);
            return Ok(result);
        }
        catch
        {
            if (!committed)
            {
                foreach (var storageKey in storedKeys)
                {
                    await attachmentStorage.DeleteAsync(
                        storageKey,
                        CancellationToken.None);
                }
            }
            throw;
        }
    }

    [HttpGet("{id:guid}/members")]
    public async Task<ActionResult<IReadOnlyList<ConversationMemberDto>>> GetMembers(
        Guid id,
        [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        if (!await IsActiveMember(id, username, cancellationToken))
        {
            return NotFound();
        }

        return Ok(await GetMemberDtos(id, cancellationToken));
    }

    [HttpPatch("{id:guid}/members/{memberUserId:guid}/role")]
    public async Task<ActionResult<IReadOnlyList<ConversationMemberDto>>> UpdateMemberRole(
        Guid id,
        Guid memberUserId,
        [FromQuery] string username,
        UpdateConversationMemberRoleRequest request,
        CancellationToken cancellationToken)
    {
        var role = request.Role?.Trim().ToLowerInvariant() ?? "";
        if (role is not ("owner" or "member"))
        {
            return BadRequest(new { message = "Choose either Owner or Member." });
        }

        var normalized = Username.Normalize(username);
        var requester = await db.Users.SingleOrDefaultAsync(
            x => x.NormalizedUsername == normalized && x.Status == "active",
            cancellationToken);
        if (requester is null)
        {
            return NotFound();
        }
        if (requester.Id == memberUserId && role == "member")
        {
            return BadRequest(new
            {
                message = "Another owner must remove your Owner role."
            });
        }

        await using var transaction = await db.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);
        var conversation = await db.Conversations
            .Include(x => x.Members)
                .ThenInclude(member => member.User)
            .SingleOrDefaultAsync(
                x => x.Id == id && x.Type == "group" && !x.IsArchived,
                cancellationToken);
        if (conversation is null)
        {
            return NotFound();
        }

        var requesterMembership = conversation.Members.SingleOrDefault(member =>
            member.UserId == requester.Id && member.LeftAt == null);
        if (requesterMembership?.Role != "owner")
        {
            return Forbid();
        }

        var targetMembership = conversation.Members.SingleOrDefault(member =>
            member.UserId == memberUserId && member.LeftAt == null);
        if (targetMembership is null)
        {
            return NotFound(new { message = "That person is no longer in the group." });
        }
        if (targetMembership.Role == role)
        {
            return Ok(await GetMemberDtos(id, cancellationToken));
        }

        var nextSequence = await db.Messages
            .Where(x => x.ConversationId == id)
            .Select(x => (long?)x.SequenceNumber)
            .MaxAsync(cancellationToken) ?? 0;
        var now = DateTimeOffset.UtcNow;
        var systemMessage = new ChatMessage
        {
            Conversation = conversation,
            MessageType = "system",
            Content = role == "owner"
                ? $"{requester.DisplayName} made {targetMembership.User.DisplayName} an owner."
                : $"{requester.DisplayName} removed {targetMembership.User.DisplayName} as an owner.",
            SequenceNumber = nextSequence + 1,
            CreatedAt = now
        };

        targetMembership.Role = role;
        conversation.UpdatedAt = now;
        conversation.LastMessage = systemMessage;
        conversation.LastMessageId = systemMessage.Id;
        conversation.LastMessageAt = now;
        db.Messages.Add(systemMessage);

        await db.ConversationMembers
            .Where(member =>
                member.ConversationId == id &&
                member.UserId != requester.Id &&
                member.LeftAt == null)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(
                    member => member.UnreadCount,
                    member => member.UnreadCount + 1),
                cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        var memberCount = conversation.Members.Count(member => member.LeftAt == null);
        var groupName = ChatHub.ConversationGroup(id);
        await hubContext.Clients.Group(groupName)
            .SendAsync(
                "MembersChanged",
                new MembersChangedDto(id, memberCount),
                cancellationToken);
        await hubContext.Clients.Group(groupName)
            .SendAsync(
                "MessageReceived",
                new MessageDto(
                    systemMessage.Id,
                    id,
                    null,
                    null,
                    null,
                    systemMessage.Content,
                    systemMessage.MessageType,
                    null,
                    systemMessage.SequenceNumber,
                    null,
                    systemMessage.CreatedAt,
                    null,
                    null),
                cancellationToken);

        return Ok(await GetMemberDtos(id, cancellationToken));
    }

    [HttpDelete("{id:guid}/members/{memberUserId:guid}")]
    public async Task<IActionResult> RemoveMember(
        Guid id,
        Guid memberUserId,
        [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var normalized = Username.Normalize(username);
        var requester = await db.Users.SingleOrDefaultAsync(
            x => x.NormalizedUsername == normalized && x.Status == "active",
            cancellationToken);
        if (requester is null)
        {
            return NotFound();
        }
        if (requester.Id == memberUserId)
        {
            return BadRequest(new { message = "Use Leave group to remove yourself." });
        }

        await using var transaction = await db.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);
        var conversation = await db.Conversations
            .Include(x => x.Members)
                .ThenInclude(member => member.User)
            .SingleOrDefaultAsync(
                x => x.Id == id && x.Type == "group" && !x.IsArchived,
                cancellationToken);
        if (conversation is null)
        {
            return NotFound();
        }
        if (conversation.Title == DatabaseInitializer.GeneralConversationTitle)
        {
            return BadRequest(new
            {
                message = "Members cannot be removed from the General conversation."
            });
        }

        var requesterMembership = conversation.Members.SingleOrDefault(member =>
            member.UserId == requester.Id && member.LeftAt == null);
        if (requesterMembership?.Role != "owner")
        {
            return Forbid();
        }

        var targetMembership = conversation.Members.SingleOrDefault(member =>
            member.UserId == memberUserId && member.LeftAt == null);
        if (targetMembership is null)
        {
            return NotFound(new { message = "That person is no longer in the group." });
        }

        var nextSequence = await db.Messages
            .Where(x => x.ConversationId == id)
            .Select(x => (long?)x.SequenceNumber)
            .MaxAsync(cancellationToken) ?? 0;
        var now = DateTimeOffset.UtcNow;
        var systemMessage = new ChatMessage
        {
            Conversation = conversation,
            MessageType = "system",
            Content =
                $"{requester.DisplayName} removed {targetMembership.User.DisplayName} from the group.",
            SequenceNumber = nextSequence + 1,
            CreatedAt = now
        };

        targetMembership.LeftAt = now;
        targetMembership.Role = "member";
        targetMembership.IsArchived = true;
        targetMembership.UnreadCount = 0;
        conversation.UpdatedAt = now;
        conversation.LastMessage = systemMessage;
        conversation.LastMessageId = systemMessage.Id;
        conversation.LastMessageAt = now;
        db.Messages.Add(systemMessage);

        await db.ConversationMembers
            .Where(member =>
                member.ConversationId == id &&
                member.UserId != requester.Id &&
                member.UserId != memberUserId &&
                member.LeftAt == null)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(
                    member => member.UnreadCount,
                    member => member.UnreadCount + 1),
                cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        var groupName = ChatHub.ConversationGroup(id);
        var targetConnections = presence.ConnectionIdsForUser(memberUserId);
        foreach (var connectionId in targetConnections)
        {
            await hubContext.Groups.RemoveFromGroupAsync(
                connectionId,
                groupName,
                cancellationToken);
        }
        if (targetConnections.Count > 0)
        {
            await hubContext.Clients.Clients(targetConnections)
                .SendAsync(
                    "ConversationRemoved",
                    new ConversationRemovedDto(id),
                    cancellationToken);
        }

        var memberCount = conversation.Members.Count(member => member.LeftAt == null);
        await hubContext.Clients.Group(groupName)
            .SendAsync(
                "MembersChanged",
                new MembersChangedDto(id, memberCount),
                cancellationToken);
        await hubContext.Clients.Group(groupName)
            .SendAsync(
                "MessageReceived",
                new MessageDto(
                    systemMessage.Id,
                    id,
                    null,
                    null,
                    null,
                    systemMessage.Content,
                    systemMessage.MessageType,
                    null,
                    systemMessage.SequenceNumber,
                    null,
                    systemMessage.CreatedAt,
                    null,
                    null),
                cancellationToken);

        return NoContent();
    }

    [HttpPost("{id:guid}/members")]
    public async Task<ActionResult<IReadOnlyList<ConversationMemberDto>>> AddMembers(
        Guid id,
        [FromQuery] string username,
        AddConversationMembersRequest request,
        CancellationToken cancellationToken)
    {
        var normalized = Username.Normalize(username);
        var requester = await db.Users.SingleOrDefaultAsync(
            x => x.NormalizedUsername == normalized,
            cancellationToken);
        if (requester is null)
        {
            return NotFound();
        }

        var conversation = await db.Conversations
            .Include(x => x.Members)
            .Include(x => x.LastMessage)
            .ThenInclude(x => x!.Sender)
            .SingleOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (conversation is null || conversation.Type != "group")
        {
            return NotFound();
        }

        if (!conversation.Members.Any(x =>
                x.UserId == requester.Id &&
                x.LeftAt == null))
        {
            return Forbid();
        }

        var selectedUsernames = NormalizeUsernames(request.Usernames).ToArray();
        if (selectedUsernames.Length == 0)
        {
            return BadRequest(new { message = "Choose at least one person to add." });
        }

        if (selectedUsernames.Length > 50)
        {
            return BadRequest(new { message = "You can add up to 50 people at a time." });
        }

        var selectedUsers = await db.Users
            .Where(x =>
                x.Status == "active" &&
                selectedUsernames.Contains(x.NormalizedUsername))
            .ToListAsync(cancellationToken);
        if (selectedUsers.Count != selectedUsernames.Length)
        {
            return BadRequest(new
            {
                message = "One or more selected people are no longer available."
            });
        }

        var addedUsers = new List<ChatUser>();
        foreach (var selectedUser in selectedUsers)
        {
            var membership = conversation.Members.SingleOrDefault(x =>
                x.UserId == selectedUser.Id);
            if (membership is not null && membership.LeftAt is null)
            {
                continue;
            }

            if (membership is null)
            {
                conversation.Members.Add(new ConversationMember
                {
                    Conversation = conversation,
                    User = selectedUser,
                    Role = "member",
                    UnreadCount = 1
                });
            }
            else
            {
                membership.LeftAt = null;
                membership.Role = "member";
                membership.IsArchived = false;
                membership.JoinedAt = DateTimeOffset.UtcNow;
                membership.UnreadCount += 1;
            }

            addedUsers.Add(selectedUser);
        }

        if (addedUsers.Count > 0)
        {
            await using var transaction = await db.Database.BeginTransactionAsync(
                IsolationLevel.Serializable,
                cancellationToken);

            var nextSequence = await db.Messages
                .Where(x => x.ConversationId == conversation.Id)
                .Select(x => (long?)x.SequenceNumber)
                .MaxAsync(cancellationToken) ?? 0;
            var addedNames = string.Join(
                ", ",
                addedUsers
                    .OrderBy(x => x.DisplayName)
                    .Select(x => x.DisplayName));
            var now = DateTimeOffset.UtcNow;
            var systemMessage = new ChatMessage
            {
                Conversation = conversation,
                MessageType = "system",
                Content = $"{requester.DisplayName} added {addedNames} to the group.",
                SequenceNumber = nextSequence + 1,
                CreatedAt = now
            };

            conversation.UpdatedAt = now;
            conversation.LastMessage = systemMessage;
            conversation.LastMessageId = systemMessage.Id;
            conversation.LastMessageAt = now;
            db.Messages.Add(systemMessage);

            await db.ConversationMembers
                .Where(x =>
                    x.ConversationId == conversation.Id &&
                    x.UserId != requester.Id &&
                    x.LeftAt == null)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(
                        x => x.UnreadCount,
                        x => x.UnreadCount + 1),
                    cancellationToken);

            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            var memberCount = conversation.Members.Count(x => x.LeftAt == null);
            var conversationDto = new ConversationDto(
                conversation.Id,
                conversation.Type,
                conversation.Title,
                conversation.AvatarUrl,
                systemMessage.Content,
                null,
                null,
                conversation.LastMessageAt,
                0,
                memberCount);
            await AddConnectedGroupMembers(
                conversation.Id,
                addedUsers,
                conversationDto,
                cancellationToken);

            var message = new MessageDto(
                systemMessage.Id,
                conversation.Id,
                null,
                null,
                null,
                systemMessage.Content,
                systemMessage.MessageType,
                null,
                systemMessage.SequenceNumber,
                null,
                systemMessage.CreatedAt,
                null,
                null);
            await hubContext.Clients
                .Group(ChatHub.ConversationGroup(conversation.Id))
                .SendAsync("MessageReceived", message, cancellationToken);
        }

        return Ok(await GetMemberDtos(id, cancellationToken));
    }

    private async Task AddConnectedUsersToDirectConversation(
        Guid conversationId,
        ChatUser currentUser,
        ChatUser targetUser,
        ConversationDto currentUserConversation,
        int targetUnreadCount,
        CancellationToken cancellationToken)
    {
        var groupName = ChatHub.ConversationGroup(conversationId);
        var currentConnections = presence.ConnectionIdsForUser(currentUser.Id);
        var targetConnections = presence.ConnectionIdsForUser(targetUser.Id);

        foreach (var connectionId in currentConnections.Concat(targetConnections))
        {
            await hubContext.Groups.AddToGroupAsync(
                connectionId,
                groupName,
                cancellationToken);
        }

        if (currentConnections.Count > 0)
        {
            await hubContext.Clients.Clients(currentConnections)
                .SendAsync(
                    "ConversationAdded",
                    currentUserConversation,
                    cancellationToken);
        }

        if (targetConnections.Count > 0)
        {
            var targetConversation = currentUserConversation with
            {
                Title = currentUser.DisplayName,
                AvatarUrl = currentUser.AvatarUrl,
                UnreadCount = targetUnreadCount
            };
            await hubContext.Clients.Clients(targetConnections)
                .SendAsync(
                    "ConversationAdded",
                    targetConversation,
                    cancellationToken);
        }
    }

    private async Task AddConnectedGroupMembers(
        Guid conversationId,
        IReadOnlyCollection<ChatUser> addedUsers,
        ConversationDto conversation,
        CancellationToken cancellationToken)
    {
        var groupName = ChatHub.ConversationGroup(conversationId);
        foreach (var addedUser in addedUsers)
        {
            var connectionIds = presence.ConnectionIdsForUser(addedUser.Id);
            foreach (var connectionId in connectionIds)
            {
                await hubContext.Groups.AddToGroupAsync(
                    connectionId,
                    groupName,
                    cancellationToken);
            }

            if (connectionIds.Count > 0)
            {
                await hubContext.Clients.Clients(connectionIds)
                    .SendAsync("ConversationAdded", conversation, cancellationToken);
            }
        }

        await hubContext.Clients.Group(groupName)
            .SendAsync(
                "MembersChanged",
                new MembersChangedDto(conversationId, conversation.MemberCount),
                cancellationToken);
    }

    private static ConversationDto ToDirectDto(
        Conversation conversation,
        string otherUserDisplayName,
        string? otherUserAvatarUrl,
        int unreadCount = 0) =>
        new(
            conversation.Id,
            conversation.Type,
            otherUserDisplayName,
            otherUserAvatarUrl,
            conversation.LastMessage?.DeletedAt is null
                ? conversation.LastMessage?.Content
                : null,
            conversation.LastMessage?.DeletedAt is null
                ? conversation.LastMessage?.SenderUserId
                : null,
            conversation.LastMessage?.DeletedAt is null
                ? conversation.LastMessage?.Sender?.DisplayName
                : null,
            conversation.LastMessageAt,
            unreadCount,
            2);

    private async Task<bool> IsActiveMember(
        Guid conversationId,
        string username,
        CancellationToken cancellationToken)
    {
        var normalized = Username.Normalize(username);
        return await db.ConversationMembers.AnyAsync(
            x =>
                x.ConversationId == conversationId &&
                x.User.NormalizedUsername == normalized &&
                x.LeftAt == null,
            cancellationToken);
    }

    private async Task<IReadOnlyList<ConversationMemberDto>> GetMemberDtos(
        Guid conversationId,
        CancellationToken cancellationToken)
    {
        var members = await db.ConversationMembers
            .AsNoTracking()
            .Where(x => x.ConversationId == conversationId && x.LeftAt == null)
            .OrderBy(x => x.Role == "owner" ? 0 : x.Role == "admin" ? 1 : 2)
            .ThenBy(x => x.User.DisplayName)
            .Select(x => new
            {
                x.User.Id,
                x.User.Username,
                x.User.DisplayName,
                x.User.AvatarUrl,
                x.Role
            })
            .ToListAsync(cancellationToken);
        var onlineUsernames = presence.OnlineUsernames()
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        return members
            .Select(x => new ConversationMemberDto(
                x.Id,
                x.Username,
                x.DisplayName,
                x.AvatarUrl,
                x.Role,
                onlineUsernames.Contains(x.Username)))
            .ToArray();
    }

    private static IEnumerable<string> NormalizeUsernames(
        IReadOnlyList<string>? usernames) =>
        (usernames ?? [])
            .Select(Username.Normalize)
            .Where(value => value != "")
            .Distinct(StringComparer.Ordinal);
}
