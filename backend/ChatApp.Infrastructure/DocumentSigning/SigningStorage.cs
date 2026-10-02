using ChatApp.Application.Abstractions;
using ChatApp.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace ChatApp.Infrastructure.DocumentSigning;

public sealed class SigningStorage(IUploadObjectStorage storage, ChatAppDbContext db, IConfiguration configuration,
    ILogger<SigningStorage> logger)
{
    public const int MaximumPdfBytes = 30 * 1024 * 1024;

    public async Task<byte[]> ReadAsync(string key, CancellationToken ct)
    {
        await using var stream = await storage.OpenReadAsync(key, ct)
            ?? throw new KeyNotFoundException("The document content could not be found.");
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await stream.ReadAsync(chunk, ct)) > 0)
        {
            if (buffer.Length + read > MaximumPdfBytes * 2L)
            {
                throw new ArgumentException("The PDF is too large for signing.");
            }
            buffer.Write(chunk, 0, read);
        }
        return buffer.ToArray();
    }

    public Task<byte[]> DownloadSignedDocumentAsync(string key, CancellationToken ct) => ReadAsync(key, ct);
    public async Task CleanupAsync(string key)
    {
        try
        {
            await storage.DeleteAsync(key, CancellationToken.None);
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Could not remove an unused signing object {StorageKey}.", key);
        }
    }

    public Task<string> StoreOriginalAsync(Guid id, byte[] pdf, CancellationToken ct) =>
        WriteAsync($"signed-documents/{id:N}/original.pdf", pdf, ct);

    public Task<string> StoreSignedDocumentAsync(Guid id, string hash, byte[] pdf, CancellationToken ct) =>
        WriteAsync($"signed-documents/{id:N}/{hash}.pdf", pdf, ct);

    private async Task<string> WriteAsync(string key, byte[] pdf, CancellationToken ct)
    {
        using var stream = new MemoryStream(pdf, writable: false);
        await storage.WriteAsync(key, stream, ct);
        return key;
    }

    public async Task ReserveAsync(Guid userId, long bytes, CancellationToken ct)
    {
        await using var command = db.Database.GetDbConnection().CreateCommand();
        command.Transaction = db.Database.CurrentTransaction!.GetDbTransaction();
        command.CommandText = "DECLARE @result int; EXEC @result = sp_getapplock @Resource = @resource, " +
            "@LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 15000; SELECT @result;";
        var parameter = command.CreateParameter();
        parameter.ParameterName = "@resource";
        parameter.Value = $"user-documents:{userId:N}";
        command.Parameters.Add(parameter);
        if (Convert.ToInt32(await command.ExecuteScalarAsync(ct)) < 0)
        {
            throw new InvalidOperationException("The document library is busy. Please try again.");
        }
        var used = (await db.StoredDocuments.Where(x => x.OwnerUserId == userId).SumAsync(x => (long?)x.SizeBytes, ct) ?? 0)
            + (await db.DocumentVersions.Where(x => x.Document.OwnerUserId == userId).SumAsync(x => (long?)x.SizeBytes, ct) ?? 0)
            + (await db.SignatureRequests.Where(x => x.CreatedById == userId).SumAsync(x => (long?)(x.OriginalSizeBytes + x.SignedSizeBytes), ct) ?? 0)
            + (await db.DocumentUploadSessions.Where(x => x.OwnerUserId == userId && x.CompletedAt == null && x.ExpiresAt > DateTimeOffset.UtcNow)
                .SumAsync(x => (long?)x.SizeBytes, ct) ?? 0);
        var limit = await db.Users.Where(x => x.Id == userId).Select(x => x.DocumentStorageLimitBytes).SingleAsync(ct)
            ?? configuration.GetValue<long?>("Documents:DefaultStorageLimitBytes") ?? 5L * 1024 * 1024 * 1024;
        if (bytes > 0 && used + bytes > limit)
        {
            throw new InvalidOperationException("There is not enough document storage available for this signing request.");
        }
    }
}
