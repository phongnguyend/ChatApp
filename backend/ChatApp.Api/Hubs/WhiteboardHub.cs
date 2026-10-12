using ChatApp.Api.Services;
using ChatApp.Application.Whiteboards;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace ChatApp.Api.Hubs;

[Authorize]
public sealed class WhiteboardHub(WhiteboardService boards) : Hub
{
    public async Task JoinBoard(Guid id)
    {
        try
        {
            await boards.Access(id, WhiteboardService.UserId(Context.User!), false, Context.ConnectionAborted);
            Context.Items["board"] = id;
        }
        catch (BoardFault error)
        {
            throw new HubException(error.Message);
        }
    }

    public async Task Cursor(Guid id, double x, double y, Guid sheetId)
    {
        if (!WhiteboardRules.Coordinate(x) || !WhiteboardRules.Coordinate(y) || !Context.Items.TryGetValue("board", out var joined) || !Equals(joined, id))
        {
            return;
        }
        var now = DateTimeOffset.UtcNow;
        if (Context.Items.TryGetValue("cursorAt", out var last) && now - (DateTimeOffset)last! < TimeSpan.FromMilliseconds(50))
        {
            return;
        }
        Context.Items["cursorAt"] = now;
        try
        {
            await boards.Access(id, WhiteboardService.UserId(Context.User!), false, Context.ConnectionAborted);
            await Clients.Users(await boards.Recipients(id, Context.ConnectionAborted)).SendAsync("WhiteboardCursor", new { BoardId = id, SheetId = sheetId, ConnectionId = Context.ConnectionId, Name = Context.User!.FindFirst("chat_username")?.Value ?? "Collaborator", X = x, Y = y });
        }
        catch (BoardFault)
        {
            Context.Items.Remove("board");
        }
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (Context.Items.TryGetValue("board", out var id) && id is Guid boardId)
        {
            await Clients.Users(await boards.Recipients(boardId, CancellationToken.None)).SendAsync("WhiteboardCursorLeft", Context.ConnectionId);
        }
        await base.OnDisconnectedAsync(exception);
    }
}
