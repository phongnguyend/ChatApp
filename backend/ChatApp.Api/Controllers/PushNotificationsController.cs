using ChatApp.Api.Data;
using ChatApp.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Controllers;

[ApiController]
[Route("api/push")]
public sealed class PushNotificationsController(
    ChatDbContext db,
    AzurePushNotificationService notifications) : ControllerBase
{
    [HttpGet("config")]
    public ActionResult GetConfig() => Ok(new
    {
        enabled = notifications.IsConfigured,
        vapidPublicKey = notifications.VapidPublicKey
    });

    [HttpPost("subscriptions")]
    public async Task<ActionResult> Register(
        [FromQuery] string username,
        [FromBody] BrowserSubscriptionRequest request,
        CancellationToken cancellationToken)
    {
        if (!notifications.IsConfigured)
        {
            return Problem(
                "Azure browser notifications are not configured.",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }
        if (!IsValid(request))
        {
            return BadRequest(new { message = "The browser subscription is invalid." });
        }

        var normalized = Username.Normalize(username);
        var userId = await db.Users
            .Where(user =>
                user.NormalizedUsername == normalized &&
                user.Status == "active")
            .Select(user => (Guid?)user.Id)
            .SingleOrDefaultAsync(cancellationToken);
        if (userId is null)
        {
            return NotFound();
        }

        await notifications.RegisterAsync(
            userId.Value,
            request.InstallationId,
            request.Endpoint,
            request.P256dh,
            request.Auth,
            cancellationToken);
        return NoContent();
    }

    [HttpDelete("subscriptions/{installationId}")]
    public async Task<ActionResult> Unregister(
        string installationId,
        [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        if (!notifications.IsConfigured)
        {
            return NoContent();
        }
        if (!IsValidInstallationId(installationId))
        {
            return BadRequest(new { message = "The installation ID is invalid." });
        }

        var normalized = Username.Normalize(username);
        var exists = await db.Users.AnyAsync(
            user =>
                user.NormalizedUsername == normalized &&
                user.Status == "active",
            cancellationToken);
        if (!exists)
        {
            return NotFound();
        }

        await notifications.UnregisterAsync(installationId, cancellationToken);
        return NoContent();
    }

    private static bool IsValid(BrowserSubscriptionRequest request) =>
        IsValidInstallationId(request.InstallationId) &&
        Uri.TryCreate(request.Endpoint, UriKind.Absolute, out var endpoint) &&
        endpoint.Scheme == Uri.UriSchemeHttps &&
        request.Endpoint.Length <= 2048 &&
        request.P256dh.Length is >= 20 and <= 512 &&
        request.Auth.Length is >= 8 and <= 256;

    private static bool IsValidInstallationId(string value) =>
        value.Length is >= 8 and <= 100 &&
        value.All(character =>
            char.IsLetterOrDigit(character) || character is '-' or '_');

    public sealed record BrowserSubscriptionRequest(
        string InstallationId,
        string Endpoint,
        string P256dh,
        string Auth);
}
