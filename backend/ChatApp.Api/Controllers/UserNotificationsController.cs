using ChatApp.Api.Services;
using ChatApp.Application.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Controllers;

[ApiController]
[Route("api/user-notifications")]
public sealed class UserNotificationsController(ChatDbContext db) : ControllerBase
{
    [HttpGet("unread-count")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<IActionResult> UnreadCount([FromQuery] string username,
        CancellationToken ct)
    {
        var userId = await FindUserId(username, ct);
        if (userId is null) return NotFound();
        // A badge can tolerate a transient dirty count; avoid shared read locks
        // on the notification table during the frequent polling request.
        var count = await db.Database.SqlQuery<int>(
            $"SELECT COUNT(*) AS [Value] FROM [UserNotifications] WITH (NOLOCK) WHERE [UserId] = {userId.Value} AND [ReadAt] IS NULL")
            .SingleAsync(ct);
        return Ok(new { unreadCount = count });
    }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string username,
        [FromQuery] int page = 0, CancellationToken ct = default)
    {
        var userId = await FindUserId(username, ct);
        if (userId is null) return NotFound();
        if (page is < 0 or > 10000)
            return BadRequest(new { message = "Choose a valid page." });

        const int pageSize = 50;
        var query = db.UserNotifications.AsNoTracking()
            .Where(x => x.UserId == userId);
        var unreadCount = await query.CountAsync(x => x.ReadAt == null, ct);
        var items = await query.OrderByDescending(x => x.CreatedAt)
            .ThenByDescending(x => x.Id)
            .Skip(page * pageSize).Take(pageSize + 1)
            .Select(x => new UserNotificationDto(x.Id, x.Type, x.TargetId, x.ContextId,
                x.TargetTitle, x.Details, x.ActorUser.DisplayName, x.ActorUser.Username,
                x.CreatedAt, x.ReadAt))
            .ToArrayAsync(ct);
        return Ok(new UserNotificationPageDto(items.Take(pageSize).ToArray(),
            items.Length > pageSize, unreadCount));
    }

    [HttpPost("{id:guid}/read")]
    public async Task<IActionResult> MarkRead(Guid id, [FromQuery] string username,
        CancellationToken ct)
    {
        var userId = await FindUserId(username, ct);
        if (userId is null) return NotFound();
        var notification = await db.UserNotifications.SingleOrDefaultAsync(
            x => x.Id == id && x.UserId == userId, ct);
        if (notification is null) return NotFound();
        if (notification.ReadAt is null)
        {
            notification.ReadAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);
        }
        return NoContent();
    }

    [HttpPost("read-all")]
    public async Task<IActionResult> MarkAllRead([FromQuery] string username,
        CancellationToken ct)
    {
        var userId = await FindUserId(username, ct);
        if (userId is null) return NotFound();
        await db.UserNotifications.Where(x => x.UserId == userId && x.ReadAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.ReadAt,
                DateTimeOffset.UtcNow), ct);
        return NoContent();
    }

    private async Task<Guid?> FindUserId(string? username, CancellationToken ct) =>
        await db.Users.Where(x => x.NormalizedUsername == Username.Normalize(username) &&
                x.Status == "active")
            .Select(x => (Guid?)x.Id).SingleOrDefaultAsync(ct);
}

public sealed record UserNotificationDto(Guid Id, string Type, Guid TargetId, Guid? ContextId,
    string TargetTitle, string? Details, string ActorDisplayName, string ActorUsername,
    DateTimeOffset CreatedAt, DateTimeOffset? ReadAt);

public sealed record UserNotificationPageDto(UserNotificationDto[] Items,
    bool HasMore, int UnreadCount);
