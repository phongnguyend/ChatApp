using ChatApp.Api.Data;
using ChatApp.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Controllers;

[ApiController]
[Route("api/calling")]
public sealed class CallingController(
    ChatDbContext db,
    ICallingProvider callingProvider) : ControllerBase
{
    [HttpGet("access")]
    public async Task<ActionResult<CallingAccessCredential>> GetAccess(
        [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        if (!Username.IsValid(username))
        {
            return NotFound();
        }
        var normalized = Username.Normalize(username);
        var user = await db.Users.SingleOrDefaultAsync(
            item =>
                item.NormalizedUsername == normalized &&
                item.Status == "active",
            cancellationToken);
        if (user is null)
        {
            return NotFound();
        }

        return Ok(await callingProvider.GetAccessCredentialAsync(
            user,
            cancellationToken));
    }
}
