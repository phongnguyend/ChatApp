using ChatApp.Infrastructure.Caching;
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
[Route("api/users")]
public sealed class UsersController(
    ChatAppDbContext db,
    IAvatarStorage avatarStorage,
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
                x.NormalizedUserName != currentNormalized &&
                (conversationId == null ||
                    !x.ConversationMemberships.Any(membership =>
                        membership.ConversationId == conversationId &&
                        membership.LeftAt == null)) &&
                (normalizedQuery == "" ||
                    x.NormalizedUserName.Contains(normalizedQuery) ||
                    (((x.FirstName ?? "") + " " + (x.LastName ?? "")).Trim() == "" ? x.UserName : ((x.FirstName ?? "") + " " + (x.LastName ?? "")).Trim()).Contains(searchText)))
            .OrderBy(x => (((x.FirstName ?? "") + " " + (x.LastName ?? "")).Trim() == "" ? x.UserName : ((x.FirstName ?? "") + " " + (x.LastName ?? "")).Trim()))
            .Take(12)
            .Select(x => new UserDto(
                x.Id,
                x.UserName,
                (((x.FirstName ?? "") + " " + (x.LastName ?? "")).Trim() == "" ? x.UserName : ((x.FirstName ?? "") + " " + (x.LastName ?? "")).Trim()),
                x.AvatarUrl))
            .ToListAsync(cancellationToken);

        return Ok(users);
    }

    [HttpGet("blocked")]
    public async Task<ActionResult<IReadOnlyList<string>>> GetBlockedUsers(
        [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var normalized = Username.Normalize(username);
        var blockerId = await db.Users
            .Where(x => x.NormalizedUserName == normalized && x.Status == "active")
            .Select(x => (Guid?)x.Id)
            .SingleOrDefaultAsync(cancellationToken);
        if (blockerId is null)
        {
            return NotFound();
        }

        var blockedUsernames = await db.UserBlocks
            .AsNoTracking()
            .Where(x => x.BlockerUserId == blockerId)
            .OrderBy(x => x.BlockedUser.UserName)
            .Select(x => x.BlockedUser.UserName)
            .ToListAsync(cancellationToken);
        return Ok(blockedUsernames);
    }

    [HttpPut("blocked/{targetUsername}")]
    public async Task<ActionResult<UserBlockChangedDto>> BlockUser(
        string targetUsername,
        [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var blockerNormalized = Username.Normalize(username);
        var targetNormalized = Username.Normalize(targetUsername);
        var users = await db.Users
            .Where(x =>
                x.Status == "active" &&
                (x.NormalizedUserName == blockerNormalized ||
                 x.NormalizedUserName == targetNormalized))
            .ToListAsync(cancellationToken);
        var blocker = users.SingleOrDefault(x =>
            x.NormalizedUserName == blockerNormalized);
        var target = users.SingleOrDefault(x =>
            x.NormalizedUserName == targetNormalized);
        if (blocker is null || target is null)
        {
            return NotFound();
        }
        if (blocker.Id == target.Id)
        {
            return BadRequest(new { message = "You cannot block yourself." });
        }

        var existing = await db.UserBlocks.FindAsync(
            [blocker.Id, target.Id],
            cancellationToken);
        if (existing is null)
        {
            db.UserBlocks.Add(new UserBlock
            {
                BlockerUser = blocker,
                BlockedUser = target
            });
            await db.SaveChangesAsync(cancellationToken);
        }

        var changed = new UserBlockChangedDto(target.UserName, true);
        await NotifyBlocker(blocker.Id, changed, cancellationToken);
        return Ok(changed);
    }

    [HttpDelete("blocked/{targetUsername}")]
    public async Task<ActionResult<UserBlockChangedDto>> UnblockUser(
        string targetUsername,
        [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var blockerNormalized = Username.Normalize(username);
        var targetNormalized = Username.Normalize(targetUsername);
        var blocker = await db.Users.SingleOrDefaultAsync(
            x => x.NormalizedUserName == blockerNormalized && x.Status == "active",
            cancellationToken);
        var target = await db.Users.SingleOrDefaultAsync(
            x => x.NormalizedUserName == targetNormalized && x.Status == "active",
            cancellationToken);
        if (blocker is null || target is null)
        {
            return NotFound();
        }

        var existing = await db.UserBlocks.FindAsync(
            [blocker.Id, target.Id],
            cancellationToken);
        if (existing is not null)
        {
            db.UserBlocks.Remove(existing);
            await db.SaveChangesAsync(cancellationToken);
        }

        var changed = new UserBlockChangedDto(target.UserName, false);
        await NotifyBlocker(blocker.Id, changed, cancellationToken);
        return Ok(changed);
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
            x => x.NormalizedUserName == normalized && x.Status == "active",
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
            user.UserName,
            user.DisplayName,
            user.AvatarUrl));
    }

    private async Task NotifyBlocker(
        Guid blockerId,
        UserBlockChangedDto changed,
        CancellationToken cancellationToken)
    {
        var connectionIds = presence.ConnectionIdsForUser(blockerId);
        if (connectionIds.Count > 0)
        {
            await hubContext.Clients.Clients(connectionIds)
                .SendAsync("UserBlockChanged", changed, cancellationToken);
        }
    }
}
