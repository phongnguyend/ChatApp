using ChatApp.Api.Contracts;
using ChatApp.Api.Data;
using ChatApp.Api.Hubs;
using ChatApp.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Controllers;

[ApiController]
[Route("api/users")]
public sealed class UsersController(
    ChatDbContext db,
    AvatarStorage avatarStorage,
    PresenceTracker presence,
    IHubContext<ChatHub> hubContext) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<UserDto>>> Search(
        [FromQuery] string currentUsername,
        [FromQuery] string? query = null,
        [FromQuery] Guid? conversationId = null,
        CancellationToken cancellationToken = default)
    {
        var currentNormalized = Username.Normalize(currentUsername);
        var searchText = Username.Clean(query);
        var normalizedQuery = Username.Normalize(searchText);

        var users = await db.Users
            .AsNoTracking()
            .Where(x =>
                x.Status == "active" &&
                x.NormalizedUsername != currentNormalized &&
                (conversationId == null ||
                    !x.ConversationMemberships.Any(membership =>
                        membership.ConversationId == conversationId &&
                        membership.LeftAt == null)) &&
                (normalizedQuery == "" ||
                    x.NormalizedUsername.Contains(normalizedQuery) ||
                    x.DisplayName.Contains(searchText)))
            .OrderBy(x => x.DisplayName)
            .Take(12)
            .Select(x => new UserDto(
                x.Id,
                x.Username,
                x.DisplayName,
                x.AvatarUrl))
            .ToListAsync(cancellationToken);

        return Ok(users);
    }

    [HttpPost("avatar")]
    [RequestSizeLimit(6 * 1024 * 1024)]
    public async Task<ActionResult<UserDto>> UpdateAvatar(
        [FromQuery] string username,
        [FromForm] IFormFile image,
        CancellationToken cancellationToken)
    {
        var normalized = Username.Normalize(username);
        var user = await db.Users.SingleOrDefaultAsync(
            x => x.NormalizedUsername == normalized && x.Status == "active",
            cancellationToken);
        if (user is null)
        {
            return NotFound();
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

        user.AvatarUrl = avatarUrl;
        user.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        presence.UpdateAvatar(user.Id, avatarUrl);
        await hubContext.Clients.All.SendAsync(
            "UserAvatarUpdated",
            new UserAvatarUpdatedDto(user.Id, avatarUrl),
            cancellationToken);

        return Ok(new UserDto(
            user.Id,
            user.Username,
            user.DisplayName,
            user.AvatarUrl));
    }

    [HttpPatch("display-name")]
    public async Task<ActionResult<UserDto>> UpdateDisplayName(
        [FromQuery] string username,
        UpdateDisplayNameRequest request,
        CancellationToken cancellationToken)
    {
        var displayName = request.DisplayName?.Trim() ?? "";
        if (displayName.Length is < 2 or > 100)
        {
            return BadRequest(new
            {
                message = "Display name must be between 2 and 100 characters."
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

        user.DisplayName = displayName;
        user.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        await hubContext.Clients.All.SendAsync(
            "UserDisplayNameUpdated",
            new UserDisplayNameUpdatedDto(user.Id, displayName),
            cancellationToken);

        return Ok(new UserDto(
            user.Id,
            user.Username,
            user.DisplayName,
            user.AvatarUrl));
    }
}
