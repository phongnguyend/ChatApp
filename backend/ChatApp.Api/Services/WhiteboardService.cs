using System.Security.Claims;
using System.Text.Json;
using ChatApp.Application.Whiteboards;
using ChatApp.Domain.Models;
using ChatApp.Persistence;
using ChatApp.Api.Hubs;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Services;

public sealed class BoardFault(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}

public sealed class WhiteboardService(ChatAppDbContext db, IHubContext<WhiteboardHub> hub)
{
    public static Guid UserId(ClaimsPrincipal user) => Guid.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!);

    public async Task<Whiteboard> Access(Guid id, Guid userId, bool edit, CancellationToken ct)
    {
        var board = await db.Whiteboards.SingleOrDefaultAsync(x => x.Id == id, ct);
        if (board is null)
        {
            throw new BoardFault(404, "Whiteboard not found.");
        }
        if (board.CreatedById != userId && !await db.WhiteboardMembers.AnyAsync(x => x.WhiteboardId == id && x.UserId == userId && (!edit || x.CanEdit), ct))
        {
            throw new BoardFault(403, "You do not have permission to access this whiteboard.");
        }
        return board;
    }

    public async Task Owner(Guid id, Guid userId, CancellationToken ct)
    {
        if ((await Access(id, userId, false, ct)).CreatedById != userId)
        {
            throw new BoardFault(403, "Only the owner can manage this whiteboard.");
        }
    }

    public static BoardObject[] Objects(Whiteboard board) => JsonSerializer.Deserialize<BoardObject[]>(board.DocumentJson, WhiteboardRules.Json)!;

    public async Task<object> Detail(Guid id, Guid userId, CancellationToken ct)
    {
        var board = await Access(id, userId, false, ct);
        var canEdit = board.CreatedById == userId || await db.WhiteboardMembers.AnyAsync(x => x.WhiteboardId == id && x.UserId == userId && x.CanEdit, ct);
        return new { board.Id, board.Title, board.CreatedById, board.Revision, board.UpdatedAt, CanEdit = canEdit, IsOwner = board.CreatedById == userId, Objects = Objects(board) };
    }

    public async Task<string[]> Recipients(Guid id, CancellationToken ct) =>
        (await db.WhiteboardMembers.Where(x => x.WhiteboardId == id).Select(x => x.UserId).ToListAsync(ct))
        .Concat(await db.Whiteboards.Where(x => x.Id == id).Select(x => x.CreatedById).ToListAsync(ct)).Distinct().Select(x => x.ToString()).ToArray();

    public Task Notify(Guid id, string[] recipients, CancellationToken ct) => hub.Clients.Users(recipients).SendAsync("WhiteboardAccessChanged", id, ct);

    public async Task<object> Apply(Guid id, Guid userId, BoardCommand command, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await db.Whiteboards.FromSqlInterpolated($"SELECT * FROM [Whiteboards] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = {id}").SingleOrDefaultAsync(ct);
        var board = await Access(id, userId, true, ct);
        var prior = await db.WhiteboardVersions.SingleOrDefaultAsync(x => x.WhiteboardId == id && x.OperationId == command.OperationId, ct);
        if (prior is not null)
        {
            if (prior.CreatedById != userId)
            {
                throw new BoardFault(409, "This operation identifier has already been used.");
            }
            return new { BoardId = id, board.Revision, Objects = Objects(board), Full = true };
        }
        BoardObject[] result;
        try
        {
            result = WhiteboardRules.Apply(Objects(board), command, board.Revision + 1);
        }
        catch (ArgumentException error)
        {
            throw new BoardFault(400, error.Message);
        }
        catch (InvalidOperationException error)
        {
            throw new BoardFault(409, error.Message);
        }
        var images = command.Edits.Where(x => x.Object.Kind == "image" && !x.Object.Deleted).Select(x => x.Object.ImageId!.Value).Distinct().ToArray();
        if (await db.WhiteboardImages.CountAsync(x => x.WhiteboardId == id && images.Contains(x.Id), ct) != images.Length)
        {
            throw new BoardFault(400, "Use images uploaded to this whiteboard.");
        }
        board.Revision++;
        board.UpdatedAt = DateTimeOffset.UtcNow;
        board.DocumentJson = JsonSerializer.Serialize(result, WhiteboardRules.Json);
        db.WhiteboardVersions.Add(new WhiteboardVersion { WhiteboardId = id, OperationId = command.OperationId, CreatedById = userId, Revision = board.Revision, DocumentJson = board.DocumentJson });
        await db.SaveChangesAsync(ct);
        await db.WhiteboardVersions.Where(x => x.WhiteboardId == id && x.Revision < board.Revision - 49).ExecuteDeleteAsync(ct);
        await transaction.CommitAsync(ct);
        var changed = result.Where(x => command.Edits.Any(edit => edit.Object.Id == x.Id)).ToArray();
        var update = new { BoardId = id, board.Revision, Objects = changed, Full = false };
        await hub.Clients.Users(await Recipients(id, ct)).SendAsync("WhiteboardChanged", update, ct);
        return update;
    }
}
