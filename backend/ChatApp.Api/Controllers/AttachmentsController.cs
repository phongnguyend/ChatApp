using ChatApp.Api.Data;
using ChatApp.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Controllers;

[ApiController]
[Route("api/attachments")]
public sealed class AttachmentsController(
    ChatDbContext db,
    MessageAttachmentStorage storage) : ControllerBase
{
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(
        Guid id,
        [FromQuery] string username,
        [FromQuery] bool download = false,
        CancellationToken cancellationToken = default)
    {
        var normalized = Username.Normalize(username);
        var attachment = await db.MessageAttachments
            .AsNoTracking()
            .Where(x =>
                x.Id == id &&
                x.Message.DeletedAt == null &&
                x.Message.Conversation.Members.Any(member =>
                    member.User.NormalizedUsername == normalized &&
                    member.LeftAt == null))
            .Select(x => new
            {
                x.StorageKey,
                x.FileName,
                x.ContentType
            })
            .SingleOrDefaultAsync(cancellationToken);
        if (attachment is null)
        {
            return NotFound();
        }

        FileStream stream;
        try
        {
            stream = storage.OpenRead(attachment.StorageKey);
        }
        catch (FileNotFoundException)
        {
            return NotFound();
        }

        if (!download && storage.IsDisplayableImage(attachment.ContentType))
        {
            return File(
                stream,
                attachment.ContentType,
                enableRangeProcessing: true);
        }

        return File(
            stream,
            "application/octet-stream",
            attachment.FileName,
            enableRangeProcessing: true);
    }
}
