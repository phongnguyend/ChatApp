using ChatApp.Api.Authentication;
using static Microsoft.AspNetCore.Http.Results;
using ChatApp.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace ChatApp.Api.Endpoints;

public sealed class AvatarsEndpoints(IAvatarStorage storage)
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/uploads/avatars")
            .RequireAuthorization();
        group.AddEndpointFilterFactory(AuthenticatedActorFilter.Create);
        group.AddEndpointFilterFactory(RequestValidationFilter.Create);

        group.MapGet("{fileName}", (
            [FromServices] AvatarsEndpoints handler,
            string fileName,
            CancellationToken cancellationToken) =>
            handler.Get(fileName, cancellationToken))
            .WithName("AvatarsEndpoints.Get")
            .AllowAnonymous();
    }

    public async Task<IResult> Get(
        string fileName,
        CancellationToken cancellationToken)
    {
        Stream? stream;
        try
        {
            stream = await storage.OpenReadAsync(fileName, cancellationToken);
        }
        catch (InvalidDataException)
        {
            return NotFound();
        }
        if (stream is null)
        {
            return NotFound();
        }

        var contentType = Path.GetExtension(fileName).ToLowerInvariant() switch
        {
            ".jpg" => "image/jpeg",
            ".png" => "image/png",
            ".webp" => "image/webp",
            ".gif" => "image/gif",
            _ => "application/octet-stream"
        };

        return File(stream, contentType);
    }
}
