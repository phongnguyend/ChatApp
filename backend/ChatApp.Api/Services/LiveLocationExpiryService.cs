using ChatApp.Application.Contracts;
using ChatApp.Application.Data;
using ChatApp.Api.Hubs;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Services;

public sealed class LiveLocationExpiryService(
    IServiceScopeFactory scopeFactory,
    IHubContext<ChatHub> hubContext,
    ILogger<LiveLocationExpiryService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(15));
        do
        {
            try
            {
                await ExpireShares(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogError(
                    exception,
                    "Could not expire live location shares.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task ExpireShares(CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ChatDbContext>();
        var now = DateTimeOffset.UtcNow;
        var shares = await db.LiveLocationShares
            .Where(x => x.IsActive && x.ExpiresAt <= now)
            .ToListAsync(cancellationToken);
        if (shares.Count == 0) return;

        foreach (var share in shares)
        {
            share.IsActive = false;
            share.StoppedAt = share.ExpiresAt;
        }
        await db.SaveChangesAsync(cancellationToken);

        foreach (var share in shares)
        {
            await hubContext.Clients
                .Group(ChatHub.ConversationGroup(share.ConversationId))
                .SendAsync(
                    "LiveLocationStopped",
                    new LiveLocationStoppedDto(
                        share.MessageId,
                        share.ConversationId,
                        share.StoppedAt!.Value),
                    cancellationToken);
        }
    }
}
