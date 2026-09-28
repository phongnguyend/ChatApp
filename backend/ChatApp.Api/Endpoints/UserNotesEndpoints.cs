using ChatApp.Api.Authentication;
using static Microsoft.AspNetCore.Http.Results;
using System.Data;
using ChatApp.Api.Services;
using ChatApp.Persistence;
using ChatApp.Domain.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Endpoints;

public sealed class UserNotesEndpoints(ChatAppDbContext db)
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/user-notes")
            .RequireAuthorization();
        group.AddEndpointFilterFactory(AuthenticatedActorFilter.Create);
        group.AddEndpointFilterFactory(RequestValidationFilter.Create);

        group.MapGet("", (
            [FromServices] UserNotesEndpoints handler,
            [FromQuery] string username,
            CancellationToken ct) =>
            handler.List(username, ct))
            .WithName("UserNotesEndpoints.List");

        group.MapGet("{id:guid}", (
            [FromServices] UserNotesEndpoints handler,
            Guid id,
            [FromQuery] string username,
            CancellationToken ct) =>
            handler.GetById(id, username, ct))
            .WithName("UserNotesEndpoints.GetById");

        group.MapPost("", (
            [FromServices] UserNotesEndpoints handler,
            [FromQuery] string username,
            [FromBody] SaveUserNoteRequest request,
            CancellationToken ct) =>
            handler.Create(username, request, ct))
            .WithName("UserNotesEndpoints.Create");

        group.MapPut("{id:guid}", (
            [FromServices] UserNotesEndpoints handler,
            Guid id,
            [FromQuery] string username,
            [FromBody] SaveUserNoteRequest request,
            CancellationToken ct) =>
            handler.Update(id, username, request, ct))
            .WithName("UserNotesEndpoints.Update");

        group.MapPatch("{id:guid}/pin", (
            [FromServices] UserNotesEndpoints handler,
            Guid id,
            [FromQuery] string username,
            [FromBody] SetUserNotePinRequest request,
            CancellationToken ct) =>
            handler.SetPin(id, username, request, ct))
            .WithName("UserNotesEndpoints.SetPin");

        group.MapDelete("{id:guid}", (
            [FromServices] UserNotesEndpoints handler,
            Guid id,
            [FromQuery] string username,
            CancellationToken ct) =>
            handler.Delete(id, username, ct))
            .WithName("UserNotesEndpoints.Delete");

        group.MapGet("{id:guid}/shares", (
            [FromServices] UserNotesEndpoints handler,
            Guid id,
            [FromQuery] string username,
            CancellationToken ct) =>
            handler.GetShares(id, username, ct))
            .WithName("UserNotesEndpoints.GetShares");

        group.MapPut("{id:guid}/shares", (
            [FromServices] UserNotesEndpoints handler,
            Guid id,
            [FromQuery] string username,
            [FromBody] SaveUserNoteShareRequest request,
            CancellationToken ct) =>
            handler.PutShare(id, username, request, ct))
            .WithName("UserNotesEndpoints.PutShare");

        group.MapDelete("{id:guid}/shares/{shareId:guid}", (
            [FromServices] UserNotesEndpoints handler,
            Guid id,
            Guid shareId,
            [FromQuery] string username,
            CancellationToken ct) =>
            handler.RemoveShare(id, shareId, username, ct))
            .WithName("UserNotesEndpoints.RemoveShare");
    }

    public async Task<IResult> List([FromQuery] string username, CancellationToken ct)
    {
        var user = await FindUser(username, ct);
        if (user is null)
        {
            return NotFound();
        }

        var notes = await ReadQuery()
            .Where(x => x.UserId == user.Id ||
                x.Shares.Any(share => share.GranteeUserId == user.Id))
            .OrderByDescending(x => x.IsPinned)
            .ThenByDescending(x => x.UpdatedAt)
            .ThenByDescending(x => x.Id)
            .ToListAsync(ct);
        return Ok(notes.Select(x => ToDto(x, user.Id)).ToArray());
    }

    public async Task<IResult> GetById(Guid id, [FromQuery] string username,
        CancellationToken ct)
    {
        var user = await FindUser(username, ct);
        if (user is null)
        {
            return NotFound();
        }

        var note = await ReadQuery().SingleOrDefaultAsync(
            x => x.Id == id && (x.UserId == user.Id ||
                x.Shares.Any(share => share.GranteeUserId == user.Id)), ct);
        return note is null ? NotFound() : Ok(ToDto(note, user.Id));
    }

    public async Task<IResult> Create([FromQuery] string username,
        SaveUserNoteRequest request, CancellationToken ct)
    {
        var user = await FindUser(username, ct);
        if (user is null)
        {
            return NotFound();
        }

        var error = Validate(request);
        if (error is not null)
        {
            return BadRequest(new { message = error });
        }

        var note = new UserNote
        {
            UserId = user.Id,
            User = user,
            Title = request.Title!.Trim(),
            Content = request.Content?.Trim() ?? "",
        };
        db.UserNotes.Add(note);
        await db.SaveChangesAsync(ct);
        return CreatedAtRoute("UserNotesEndpoints.GetById",
            new { id = note.Id, username }, ToDto(note, user.Id));
    }

    public async Task<IResult> Update(Guid id, [FromQuery] string username,
        SaveUserNoteRequest request, CancellationToken ct)
    {
        var user = await FindUser(username, ct);
        if (user is null)
        {
            return NotFound();
        }

        var error = Validate(request);
        if (error is not null)
        {
            return BadRequest(new { message = error });
        }

        var note = await db.UserNotes.Include(x => x.User).Include(x => x.Shares)
            .SingleOrDefaultAsync(x => x.Id == id && (x.UserId == user.Id ||
                x.Shares.Any(share => share.GranteeUserId == user.Id &&
                    share.Permission == "editor")), ct);
        if (note is null)
        {
            return NotFound();
        }

        note.Title = request.Title!.Trim();
        note.Content = request.Content?.Trim() ?? "";
        note.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return Ok(ToDto(note, user.Id));
    }

    public async Task<IResult> SetPin(Guid id, [FromQuery] string username,
        SetUserNotePinRequest request, CancellationToken ct)
    {
        var user = await FindUser(username, ct);
        if (user is null)
        {
            return NotFound();
        }

        var note = await db.UserNotes.Include(x => x.User).Include(x => x.Shares)
            .SingleOrDefaultAsync(x => x.Id == id && x.UserId == user.Id, ct);
        if (note is null)
        {
            return NotFound();
        }

        note.IsPinned = request.IsPinned;
        note.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return Ok(ToDto(note, user.Id));
    }

    public async Task<IResult> Delete(Guid id, [FromQuery] string username,
        CancellationToken ct)
    {
        var user = await FindUser(username, ct);
        if (user is null)
        {
            return NotFound();
        }

        var note = await db.UserNotes.SingleOrDefaultAsync(
            x => x.Id == id && x.UserId == user.Id, ct);
        if (note is null)
        {
            return NotFound();
        }

        db.UserNotes.Remove(note);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    public async Task<IResult> GetShares(Guid id, [FromQuery] string username,
        CancellationToken ct)
    {
        var user = await FindUser(username, ct);
        if (user is null || !await db.UserNotes.AnyAsync(
                x => x.Id == id && x.UserId == user.Id, ct))
        {
            return NotFound();
        }

        var shares = await db.UserNoteShares.AsNoTracking()
            .Where(x => x.NoteId == id)
            .OrderBy(x => (((x.GranteeUser.FirstName ?? "") + " " + (x.GranteeUser.LastName ?? "")).Trim() == "" ? x.GranteeUser.UserName : ((x.GranteeUser.FirstName ?? "") + " " + (x.GranteeUser.LastName ?? "")).Trim()))
            .Select(x => new UserNoteShareDto(x.Id, x.GranteeUser.UserName,
                (((x.GranteeUser.FirstName ?? "") + " " + (x.GranteeUser.LastName ?? "")).Trim() == "" ? x.GranteeUser.UserName : ((x.GranteeUser.FirstName ?? "") + " " + (x.GranteeUser.LastName ?? "")).Trim()), x.Permission))
            .ToListAsync(ct);
        return Ok(shares);
    }

    public async Task<IResult> PutShare(Guid id, [FromQuery] string username,
        SaveUserNoteShareRequest request, CancellationToken ct)
    {
        var user = await FindUser(username, ct);
        if (user is null)
        {
            return NotFound();
        }

        if (request.Permission is not ("viewer" or "editor"))
        {
            return BadRequest(new { message = "Choose Viewer or Editor." });
        }

        if (!await db.UserNotes.AnyAsync(x => x.Id == id && x.UserId == user.Id, ct))
        {
            return NotFound();
        }

        var grantee = await FindUser(request.RecipientUsername, ct);
        if (grantee is null)
        {
            return BadRequest(new { message = "Choose an active person." });
        }

        if (grantee.Id == user.Id)
        {
            return BadRequest(new { message = "You already own this note." });
        }

        await using var transaction = await db.Database.BeginTransactionAsync(
            IsolationLevel.Serializable, ct);
        var share = await db.UserNoteShares.SingleOrDefaultAsync(x =>
            x.NoteId == id && x.GranteeUserId == grantee.Id, ct);
        if (share is null)
        {
            share = new UserNoteShare
            {
                NoteId = id,
                GranteeUserId = grantee.Id,
                Permission = request.Permission,
            };
            db.UserNoteShares.Add(share);
            var noteTitle = await db.UserNotes.Where(x => x.Id == id)
                .Select(x => x.Title).SingleAsync(ct);
            db.UserNotifications.Add(new UserNotification
            {
                UserId = grantee.Id,
                ActorUserId = user.Id,
                Type = "note_share",
                TargetId = id,
                TargetTitle = noteTitle,
            });
        }
        else
        {
            share.Permission = request.Permission;
        }

        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return Ok(new UserNoteShareDto(share.Id, grantee.UserName,
            grantee.DisplayName, share.Permission));
    }

    public async Task<IResult> RemoveShare(Guid id, Guid shareId,
        [FromQuery] string username, CancellationToken ct)
    {
        var user = await FindUser(username, ct);
        if (user is null)
        {
            return NotFound();
        }

        var share = await db.UserNoteShares.SingleOrDefaultAsync(x =>
            x.Id == shareId && x.NoteId == id && x.Note.UserId == user.Id, ct);
        if (share is null)
        {
            return NotFound();
        }

        db.UserNoteShares.Remove(share);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    private async Task<ChatUser?> FindUser(string? username, CancellationToken ct) =>
        await db.Users.SingleOrDefaultAsync(x =>
            x.NormalizedUserName == Username.Normalize(username) &&
            x.Status == "active", ct);

    private IQueryable<UserNote> ReadQuery() => db.UserNotes.AsNoTracking()
        .Include(x => x.User).Include(x => x.Shares);

    private static string? Validate(SaveUserNoteRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Title) || request.Title.Trim().Length > 200)
        {
            return "Enter a title of at most 200 characters.";
        }

        if (request.Content?.Length > 20000)
        {
            return "Note content must be at most 20,000 characters.";
        }

        return null;
    }

    private static UserNoteDto ToDto(UserNote note, Guid userId) => new(
        note.Id, note.Title, note.Content, note.IsPinned,
        note.CreatedAt, note.UpdatedAt,
        note.User.UserName, note.User.DisplayName,
        note.UserId == userId ? "owner" :
            note.Shares.Single(x => x.GranteeUserId == userId).Permission,
        note.UserId == userId ? note.Shares.Count : 0);
}

public sealed record SaveUserNoteRequest(string? Title, string? Content);
public sealed record SetUserNotePinRequest(bool IsPinned);
public sealed record SaveUserNoteShareRequest(string RecipientUsername,
    string Permission);
public sealed record UserNoteShareDto(Guid Id, string Username,
    string DisplayName, string Permission);
public sealed record UserNoteDto(Guid Id, string Title, string Content,
    bool IsPinned, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
    string OwnerUsername, string OwnerDisplayName, string Permission,
    int ShareCount);
