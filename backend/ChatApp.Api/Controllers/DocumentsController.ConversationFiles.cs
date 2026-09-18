using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Controllers;

public sealed partial class DocumentsController
{
    [HttpGet("conversation-files")]
    public async Task<IActionResult> ConversationFiles([FromQuery] string username,
        [FromQuery] string scope, [FromQuery] string? query, [FromQuery] int offset,
        CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null) return NotFound();
        if (scope is not ("mine" or "others") || offset < 0 || query?.Length > 100)
            return BadRequest(new { message = "Choose a valid conversation file view and search term." });

        var files = db.MessageAttachments.AsNoTracking().Where(x =>
            x.Message.DeletedAt == null && x.Message.SenderUserId != null &&
            !x.Message.Conversation.IsArchived &&
            x.Message.Conversation.Members.Any(member =>
                member.UserId == actor.Id && member.LeftAt == null && !member.IsArchived));
        files = scope == "mine"
            ? files.Where(x => x.Message.SenderUserId == actor.Id)
            : files.Where(x => x.Message.SenderUserId != actor.Id);
        var term = query?.Trim();
        if (!string.IsNullOrEmpty(term)) files = files.Where(x => x.FileName.Contains(term));

        const int pageSize = 100;
        var page = await files.OrderByDescending(x => x.Message.CreatedAt)
            .ThenByDescending(x => x.Id).Skip(offset).Take(pageSize + 1)
            .Select(x => new
            {
                x.Id,
                x.FileName,
                x.ContentType,
                x.FileSize,
                x.MessageId,
                x.Message.ConversationId,
                ConversationType = x.Message.Conversation.Type,
                ConversationTitle = x.Message.Conversation.Title,
                SenderUsername = x.Message.Sender!.Username,
                SenderDisplayName = x.Message.Sender.DisplayName,
                SharedAt = x.Message.CreatedAt,
            }).ToListAsync(cancellationToken);
        var hasMore = page.Count > pageSize;
        var visible = page.Take(pageSize).ToArray();
        var directIds = visible.Where(x => x.ConversationType == "direct")
            .Select(x => x.ConversationId).Distinct().ToArray();
        var directMembers = await db.ConversationMembers
            .AsNoTracking().Where(x => directIds.Contains(x.ConversationId) &&
                x.UserId != actor.Id && x.LeftAt == null)
            .Select(x => new { x.ConversationId, x.User.DisplayName })
            .ToArrayAsync(cancellationToken);
        var directNames = directMembers.GroupBy(x => x.ConversationId)
            .ToDictionary(x => x.Key, x => x.First().DisplayName);

        return Ok(new ConversationFilesPageDto(visible.Select(x => new ConversationFileDto(
            x.Id, x.FileName, x.ContentType, x.FileSize, x.MessageId,
            x.ConversationId,
            x.ConversationType == "direct"
                ? directNames.GetValueOrDefault(x.ConversationId, actor.DisplayName)
                : x.ConversationTitle ?? (x.ConversationType == "live_stream"
                    ? "Live stream" : "Group conversation"),
            x.SenderUsername, x.SenderDisplayName, x.SharedAt)).ToArray(), hasMore));
    }
}

public sealed record ConversationFileDto(Guid Id, string FileName, string ContentType,
    long FileSize, Guid MessageId, Guid ConversationId, string ConversationTitle,
    string SenderUsername, string SenderDisplayName, DateTimeOffset SharedAt);
public sealed record ConversationFilesPageDto(IReadOnlyList<ConversationFileDto> Items, bool HasMore);
