using ChatApp.Api.Contracts;
using ChatApp.Api.Data;
using ChatApp.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Controllers;

[ApiController]
[Route("api/users")]
public sealed class UsersController(ChatDbContext db) : ControllerBase
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
            .Select(x => new UserDto(x.Id, x.Username, x.DisplayName))
            .ToListAsync(cancellationToken);

        return Ok(users);
    }
}
