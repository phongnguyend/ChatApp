using System.Collections.Concurrent;
using System.Security.Claims;
using ChatApp.Persistence;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Authentication;

public sealed class AuthenticatedHubFilter(IServiceScopeFactory scopes) : IHubFilter
{
    private readonly ConcurrentDictionary<string, HubCallerContext> connections = new();

    private async Task<bool> IsValid(HubCallerContext context)
    {
        if (!Guid.TryParse(context.User?.FindFirstValue(ClaimTypes.NameIdentifier), out var id)) return false;
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ChatAppDbContext>();
        var account = await db.Users.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id);
        return account is { IsEnabled: true } && account.SecurityStamp == context.User?.FindFirstValue("security_stamp");
    }

    public async ValueTask<object?> InvokeMethodAsync(HubInvocationContext context, Func<HubInvocationContext, ValueTask<object?>> next)
    {
        if (!await IsValid(context.Context)) { context.Context.Abort(); throw new HubException("Your session is no longer valid."); }
        return await next(context);
    }

    public async Task OnConnectedAsync(HubLifetimeContext context, Func<HubLifetimeContext, Task> next)
    {
        if (!await IsValid(context.Context)) { context.Context.Abort(); return; }
        connections[context.Context.ConnectionId] = context.Context;
        await next(context);
    }

    public async Task OnDisconnectedAsync(HubLifetimeContext context, Exception? exception, Func<HubLifetimeContext, Exception?, Task> next)
    {
        connections.TryRemove(context.Context.ConnectionId, out _);
        await next(context, exception);
    }

    public async Task RevokeInvalidConnectionsAsync()
    {
        foreach (var context in connections.Values)
            if (!await IsValid(context)) context.Abort();
    }
}

public sealed class SessionRevocationWorker(AuthenticatedHubFilter sessions, ILogger<SessionRevocationWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(10));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try { await sessions.RevokeInvalidConnectionsAsync(); }
            catch (Exception exception) when (!stoppingToken.IsCancellationRequested)
            { logger.LogError(exception, "Could not check connected sessions."); }
        }
    }
}
