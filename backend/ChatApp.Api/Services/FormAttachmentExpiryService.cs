using System.Data;
using ChatApp.Application.Abstractions;
using ChatApp.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Services;

public sealed class FormAttachmentExpiryService(IServiceScopeFactory scopeFactory, ILogger<FormAttachmentExpiryService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(15));
        do
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<ChatAppDbContext>();
                var storage = scope.ServiceProvider.GetRequiredService<IUploadObjectStorage>();
                await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, stoppingToken);
                var now = DateTimeOffset.UtcNow;
                // Hold update locks until cleanup finishes, excluding simultaneous submissions and other workers.
                var uploads = await db.FormAttachmentUploads.FromSqlInterpolated($"SELECT TOP (100) * FROM [FormAttachmentUploads] WITH (UPDLOCK, READPAST, READCOMMITTEDLOCK) WHERE [ExpiresAt] <= {now} ORDER BY [ExpiresAt]").ToListAsync(stoppingToken);
                foreach (var upload in uploads)
                {
                    try
                    {
                        await storage.DeleteAsync(upload.StorageKey, stoppingToken);
                        db.FormAttachmentUploads.Remove(upload);
                    }
                    catch (Exception exception) when (exception is not OperationCanceledException)
                    {
                        logger.LogWarning(exception, "Could not remove expired form upload {StorageKey}", upload.StorageKey);
                    }
                }
                await db.SaveChangesAsync(stoppingToken);
                await transaction.CommitAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception)
            {
                logger.LogWarning(exception, "Could not clean expired form uploads");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
