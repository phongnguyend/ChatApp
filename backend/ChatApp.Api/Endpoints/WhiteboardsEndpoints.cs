using System.Security.Claims;
using ChatApp.Api.Services;
using ChatApp.Application.Whiteboards;
using ChatApp.Domain.Models;
using ChatApp.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Endpoints;

public static partial class WhiteboardsEndpoints
{
    public sealed record Rename(string Title);

    public sealed record Share(string Username, bool CanEdit);

    public sealed record Restore(int ExpectedRevision);

    public static void Map(WebApplication app)
    {
        var group = app.MapGroup("/api/whiteboards").RequireAuthorization();

        group.AddEndpointFilter(async (context, next) =>
        {
            try
            {
                return await next(context);
            }
            catch (BoardFault error)
            {
                return Results.Json(new { error = error.Message }, statusCode: error.Status);
            }
            catch (DbUpdateConcurrencyException)
            {
                return Results.Conflict(new { error = "This whiteboard changed. Refresh and try again." });
            }
        });
        group.MapGet("/", async (ClaimsPrincipal user, ChatAppDbContext db, CancellationToken ct) =>
        {
            var id = WhiteboardService.UserId(user);
            return Results.Ok(await db.Whiteboards.Where(b => b.CreatedById == id || db.WhiteboardMembers.Any(m => m.WhiteboardId == b.Id && m.UserId == id))
                .OrderByDescending(b => b.UpdatedAt).Select(b => new { b.Id, b.Title, b.UpdatedAt, b.Revision, IsOwner = b.CreatedById == id }).ToListAsync(ct));
        });

        group.MapPost("/", async (ClaimsPrincipal user, ChatAppDbContext db, WhiteboardService boards, CancellationToken ct) =>
        {
            var board = new Whiteboard { CreatedById = WhiteboardService.UserId(user) };
            db.Whiteboards.Add(board);
            await db.SaveChangesAsync(ct);
            return Results.Ok(await boards.Detail(board.Id, board.CreatedById, ct));
        });

        group.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal user, WhiteboardService boards, CancellationToken ct) => Results.Ok(await boards.Detail(id, WhiteboardService.UserId(user), ct)));

        group.MapPost("/{id:guid}/commands", async (Guid id, BoardCommand command, ClaimsPrincipal user, WhiteboardService boards, CancellationToken ct) => Results.Ok(await boards.Apply(id, WhiteboardService.UserId(user), command, ct)))
            .WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(2100000));

        group.MapPut("/{id:guid}", async (Guid id, Rename request, ClaimsPrincipal user, ChatAppDbContext db, WhiteboardService boards, CancellationToken ct) =>
        {
            await boards.Owner(id, WhiteboardService.UserId(user), ct);
            if (string.IsNullOrWhiteSpace(request.Title) || request.Title.Length > 200)
            {
                return Results.BadRequest(new { error = "Use a title of 1–200 characters." });
            }
            var board = await db.Whiteboards.SingleAsync(x => x.Id == id, ct);
            board.Title = request.Title.Trim();
            board.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);
            await boards.Notify(id, await boards.Recipients(id, ct), ct);
            return Results.NoContent();
        });

        group.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal user, ChatAppDbContext db, WhiteboardService boards, CancellationToken ct) =>
        {
            await boards.Owner(id, WhiteboardService.UserId(user), ct);
            var recipients = await boards.Recipients(id, ct);
            db.Whiteboards.Remove(await db.Whiteboards.SingleAsync(x => x.Id == id, ct));
            await db.SaveChangesAsync(ct);
            await boards.Notify(id, recipients, ct);
            return Results.NoContent();
        });

        group.MapGet("/{id:guid}/members", async (Guid id, ClaimsPrincipal user, ChatAppDbContext db, WhiteboardService boards, CancellationToken ct) =>
        {
            await boards.Owner(id, WhiteboardService.UserId(user), ct);
            return Results.Ok(await db.WhiteboardMembers.Where(x => x.WhiteboardId == id).Join(db.Users, m => m.UserId, u => u.Id, (m, u) => new { m.UserId, Username = u.UserName, m.CanEdit }).ToListAsync(ct));
        });

        group.MapPost("/{id:guid}/members", async (Guid id, Share request, ClaimsPrincipal user, ChatAppDbContext db, WhiteboardService boards, CancellationToken ct) =>
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await db.Whiteboards.FromSqlInterpolated($"SELECT * FROM [Whiteboards] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = {id}").SingleOrDefaultAsync(ct);
            await boards.Owner(id, WhiteboardService.UserId(user), ct);
            var normalized = request.Username?.Trim().ToUpperInvariant();
            var target = await db.Users.SingleOrDefaultAsync(x => x.NormalizedUserName == normalized && x.IsEnabled, ct);
            if (target is null || target.Id == WhiteboardService.UserId(user))
            {
                return Results.BadRequest(new { error = "Choose another active account by username." });
            }
            var member = await db.WhiteboardMembers.SingleOrDefaultAsync(x => x.WhiteboardId == id && x.UserId == target.Id, ct);
            if (member is null)
            {
                member = new WhiteboardMember { WhiteboardId = id, UserId = target.Id };
                db.WhiteboardMembers.Add(member);
            }
            member.CanEdit = request.CanEdit;
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            await boards.Notify(id, [target.Id.ToString()], ct);
            return Results.NoContent();
        });

        group.MapDelete("/{id:guid}/members/{userId:guid}", async (Guid id, Guid userId, ClaimsPrincipal user, ChatAppDbContext db, WhiteboardService boards, CancellationToken ct) =>
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await db.Whiteboards.FromSqlInterpolated($"SELECT * FROM [Whiteboards] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = {id}").SingleOrDefaultAsync(ct);
            await boards.Owner(id, WhiteboardService.UserId(user), ct);
            await db.WhiteboardMembers.Where(x => x.WhiteboardId == id && x.UserId == userId).ExecuteDeleteAsync(ct);
            await transaction.CommitAsync(ct);
            await boards.Notify(id, [userId.ToString()], ct);
            return Results.NoContent();
        });

        group.MapGet("/{id:guid}/versions", async (Guid id, ClaimsPrincipal user, ChatAppDbContext db, WhiteboardService boards, CancellationToken ct) =>
        {
            await boards.Access(id, WhiteboardService.UserId(user), false, ct);
            return Results.Ok(await db.WhiteboardVersions.Where(x => x.WhiteboardId == id).OrderByDescending(x => x.Revision).Select(x => new { x.Revision, x.CreatedAt, x.CreatedById }).Take(50).ToListAsync(ct));
        });

        group.MapPost("/{id:guid}/versions/{revision:int}/restore", async (Guid id, int revision, Restore request, ClaimsPrincipal user, ChatAppDbContext db, WhiteboardService boards, CancellationToken ct) =>
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await db.Whiteboards.FromSqlInterpolated($"SELECT * FROM [Whiteboards] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = {id}").SingleOrDefaultAsync(ct);
            await boards.Owner(id, WhiteboardService.UserId(user), ct);
            var board = await db.Whiteboards.SingleAsync(x => x.Id == id, ct);
            if (board.Revision != request.ExpectedRevision)
            {
                return Results.Conflict(new { error = "The board changed. Reload before restoring a version." });
            }
            var version = await db.WhiteboardVersions.SingleOrDefaultAsync(x => x.WhiteboardId == id && x.Revision == revision, ct);
            if (version is null)
            {
                return Results.NotFound();
            }
            board.Revision++;
            var old = System.Text.Json.JsonSerializer.Deserialize<BoardObject[]>(version.DocumentJson, WhiteboardRules.Json)!;
            var restored = old.Select(x => x with { Version = board.Revision }).Concat(WhiteboardService.Objects(board).Where(x => old.All(y => y.Id != x.Id)).Select(x => x with { Deleted = true, Version = board.Revision })).ToArray();
            board.DocumentJson = System.Text.Json.JsonSerializer.Serialize(restored, WhiteboardRules.Json);
            if (System.Text.Encoding.UTF8.GetByteCount(board.DocumentJson) > 2000000)
            {
                return Results.BadRequest(new { error = "Restoring this version would exceed the 2 MB board document limit." });
            }
            board.UpdatedAt = DateTimeOffset.UtcNow;
            db.WhiteboardVersions.Add(new WhiteboardVersion { WhiteboardId = id, CreatedById = WhiteboardService.UserId(user), Revision = board.Revision, DocumentJson = board.DocumentJson });
            await db.SaveChangesAsync(ct);
            await db.WhiteboardVersions.Where(x => x.WhiteboardId == id && x.Revision < board.Revision - 49).ExecuteDeleteAsync(ct);
            await transaction.CommitAsync(ct);
            await boards.Notify(id, await boards.Recipients(id, ct), ct);
            return Results.Ok(await boards.Detail(id, WhiteboardService.UserId(user), ct));
        });

        MapImages(group);
    }
}
