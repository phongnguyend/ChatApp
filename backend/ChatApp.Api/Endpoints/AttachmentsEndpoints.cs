using ChatApp.Api.Authentication;
using static Microsoft.AspNetCore.Http.Results;
using ChatApp.Persistence;
using ChatApp.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Endpoints;

public sealed class AttachmentsEndpoints(
    ChatAppDbContext db,
    IMessageAttachmentStorage storage)
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/attachments")
            .RequireAuthorization();
        group.AddEndpointFilterFactory(AuthenticatedActorFilter.Create);
        group.AddEndpointFilterFactory(RequestValidationFilter.Create);

        group.MapGet("{id:guid}", (
            [FromServices] AttachmentsEndpoints handler,
            Guid id,
            [FromQuery] string username,
            [FromQuery] bool download = false,
            CancellationToken cancellationToken = default) =>
            handler.Get(id, username, download, cancellationToken))
            .WithName("AttachmentsEndpoints.Get");
    }

    public async Task<IResult> Get(
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
                    member.User.NormalizedUserName == normalized &&
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

        Stream? stream;
        try
        {
            stream = await storage.OpenReadAsync(
                attachment.StorageKey,
                cancellationToken);
        }
        catch (InvalidDataException)
        {
            return NotFound();
        }
        if (stream is null)
        {
            return NotFound();
        }

        if (!download &&
            (storage.IsDisplayableImage(attachment.ContentType) ||
             storage.IsDisplayableVideo(attachment.ContentType) ||
             storage.IsDisplayableAudio(attachment.ContentType)))
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
