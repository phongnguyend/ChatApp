using ChatApp.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace ChatApp.Api.Controllers;

[ApiController]
[Route("uploads/avatars")]
public sealed class AvatarsController(IAvatarStorage storage) : ControllerBase
{
    [HttpGet("{fileName}")]
    public async Task<IActionResult> Get(
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
