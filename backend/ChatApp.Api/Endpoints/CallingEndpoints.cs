using ChatApp.Api.Authentication;
using static Microsoft.AspNetCore.Http.Results;
using ChatApp.Application.Abstractions;
using ChatApp.Persistence;
using ChatApp.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Endpoints;

public sealed class CallingEndpoints(
    ChatAppDbContext db,
    ICallingProvider callingProvider)
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/calling")
            .RequireAuthorization();
        group.AddEndpointFilterFactory(AuthenticatedActorFilter.Create);
        group.AddEndpointFilterFactory(RequestValidationFilter.Create);

        group.MapGet("access", (
            [FromServices] CallingEndpoints handler,
            [FromQuery] string username,
            CancellationToken cancellationToken) =>
            handler.GetAccess(username, cancellationToken))
            .WithName("CallingEndpoints.GetAccess");
    }

    public async Task<IResult> GetAccess(
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
                item.NormalizedUserName == normalized &&
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
