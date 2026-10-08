using ChatApp.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Configuration;

namespace ChatApp.Infrastructure.Storage;

public static class FormStorageUsage
{
    public sealed class Allocation
    {
        public Guid OwnerId { get; init; }

        public long SizeBytes { get; init; }
    }

    public static IQueryable<Allocation> Allocations(ChatAppDbContext db) =>
        db.FormAttachmentUploads.Where(x => x.CreatedById != null || x.FormOwnerId != null).Select(x => new Allocation { OwnerId = (x.CreatedById ?? x.FormOwnerId)!.Value, SizeBytes = x.SizeBytes })
            .Concat(db.FormResponseAttachments.Where(x => x.CreatedById != null || x.FormOwnerId != null).Select(x => new Allocation { OwnerId = (x.CreatedById ?? x.FormOwnerId)!.Value, SizeBytes = x.SizeBytes }));

    public static async Task<long> UsedBytes(ChatAppDbContext db, Guid ownerId, CancellationToken ct) =>
        await Allocations(db).Where(x => x.OwnerId == ownerId).SumAsync(x => (long?)x.SizeBytes, ct) ?? 0;

    public static async Task<long> UnattributedBytes(ChatAppDbContext db, CancellationToken ct) =>
        (await db.FormAttachmentUploads.Where(x => x.CreatedById == null && x.FormOwnerId == null).SumAsync(x => (long?)x.SizeBytes, ct) ?? 0) +
        (await db.FormResponseAttachments.Where(x => x.CreatedById == null && x.FormOwnerId == null).SumAsync(x => (long?)x.SizeBytes, ct) ?? 0);

    public static async Task Lock(ChatAppDbContext db, Guid? uploaderId, CancellationToken ct)
    {
        await using var command = db.Database.GetDbConnection().CreateCommand();
        command.Transaction = db.Database.CurrentTransaction!.GetDbTransaction();
        command.CommandText = "DECLARE @result int; EXEC @result = sp_getapplock @Resource = @resource, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 15000; SELECT @result;";
        var parameter = command.CreateParameter();
        parameter.ParameterName = "@resource";
        parameter.Value = uploaderId is Guid id ? $"user-documents:{id:N}" : "unattributed-form-uploads";
        command.Parameters.Add(parameter);
        if (Convert.ToInt32(await command.ExecuteScalarAsync(ct)) < 0)
        {
            throw new TimeoutException("Could not lock attachment storage.");
        }
    }

    public static async Task<bool> HasCapacity(ChatAppDbContext db, IConfiguration configuration, Guid id, long bytes, CancellationToken ct)
    {
        var used = await UsedBytes(db, id, ct)
            + (await db.StoredDocuments.Where(x => x.OwnerUserId == id).SumAsync(x => (long?)x.SizeBytes, ct) ?? 0)
            + (await db.DocumentVersions.Where(x => x.Document.OwnerUserId == id).SumAsync(x => (long?)x.SizeBytes, ct) ?? 0)
            + (await db.SignatureRequests.Where(x => x.CreatedById == id).SumAsync(x => (long?)(x.OriginalSizeBytes + x.SignedSizeBytes), ct) ?? 0)
            + (await db.DocumentUploadSessions.Where(x => x.OwnerUserId == id && x.CompletedAt == null && x.ExpiresAt > DateTimeOffset.UtcNow).SumAsync(x => (long?)x.SizeBytes, ct) ?? 0);
        var configured = configuration.GetValue<long?>("Documents:DefaultStorageLimitBytes");
        var limit = await db.Users.Where(x => x.Id == id).Select(x => x.DocumentStorageLimitBytes).SingleAsync(ct)
            ?? (configured is > 0 ? configured.Value : 5L * 1024 * 1024 * 1024);
        return used + bytes <= limit;
    }
}
