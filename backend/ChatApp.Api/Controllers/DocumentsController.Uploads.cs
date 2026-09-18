using System.Security.Cryptography;
using ChatApp.Application.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Controllers;

public sealed partial class DocumentsController
{
    private const int UploadChunkSize = 8 * 1024 * 1024;
    private const int MaximumUploadChunks = 10000;
    private static readonly TimeSpan UploadSessionLifetime = TimeSpan.FromDays(1);

    [HttpPost("uploads")]
    public async Task<IActionResult> StartUpload([FromQuery] string username,
        StartDocumentUploadRequest request, CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null) return NotFound();
        if (request.SizeBytes <= 0 || request.SizeBytes > MaximumStorageLimit ||
            (request.SizeBytes + UploadChunkSize - 1) / UploadChunkSize > MaximumUploadChunks)
            return StatusCode(StatusCodes.Status413PayloadTooLarge,
                new { code = "storage_limit", message = "The file is larger than the available upload limit." });
        if (request.Fingerprint is null || request.Fingerprint.Length != 64 || !request.Fingerprint.All(Uri.IsHexDigit) ||
            request.Conflict is not ("ask" or "replace" or "keepBoth"))
            return BadRequest(new { message = "Invalid upload details." });
        await CleanupExpiredUploads(cancellationToken);

        StoredDocument? replaceTarget = null;
        DocumentFolder? destination = null;
        string name;
        Guid ownerId;
        Guid? folderId;
        if (request.ReplaceFileId is Guid replaceId)
        {
            replaceTarget = await db.StoredDocuments.AsNoTracking()
                .SingleOrDefaultAsync(x => x.Id == replaceId, cancellationToken);
            if (replaceTarget is null || await FilePermission(replaceTarget, actor.Id, cancellationToken)
                is not ("owner" or "editor")) return NotFound();
            ownerId = replaceTarget.OwnerUserId;
            folderId = replaceTarget.FolderId;
            name = replaceTarget.Name;
        }
        else
        {
            name = CleanName(request.Name?.Replace('\\', '/').Split('/').Last()) ?? "";
            if (name.Length == 0) return BadRequest(new { message = "Choose a file with a valid name." });
            destination = request.FolderId is Guid id
                ? await db.DocumentFolders.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, cancellationToken)
                : null;
            if (request.FolderId is not null && (destination is null ||
                await FolderPermission(destination, actor.Id, cancellationToken) is not ("owner" or "editor")))
                return NotFound();
            ownerId = destination?.OwnerUserId ?? actor.Id;
            folderId = request.FolderId;
        }

        if (request.SizeBytes > await StorageLimitBytes(ownerId, cancellationToken))
            return StatusCode(StatusCodes.Status413PayloadTooLarge,
                new { code = "storage_limit", message = "The file is larger than the owner's storage limit." });

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await LockLibrary(ownerId, cancellationToken);
        if (!await FolderExists(ownerId, folderId, cancellationToken)) return NotFound();
        if (replaceTarget is null)
        {
            var existing = await db.StoredDocuments.AsNoTracking().SingleOrDefaultAsync(x =>
                x.OwnerUserId == ownerId && x.FolderId == folderId && x.DeletedAt == null &&
                x.NormalizedName == Normalize(name), cancellationToken);
            if (existing is not null && request.Conflict == "ask")
                return Conflict(new { code = "name_conflict", message = "A file with this name already exists here." });
            if (existing is not null && request.Conflict == "replace" &&
                await FilePermission(existing, actor.Id, cancellationToken) is not ("owner" or "editor"))
                return Forbid();
        }
        var now = DateTimeOffset.UtcNow;
        var reserved = await db.DocumentUploadSessions.Where(x => x.OwnerUserId == ownerId &&
            x.CompletedAt == null && x.ExpiresAt > now)
            .SumAsync(x => (long?)x.SizeBytes, cancellationToken) ?? 0;
        if (await UsedStorage(ownerId, cancellationToken) + reserved + request.SizeBytes > await StorageLimitBytes(ownerId, cancellationToken))
            return StatusCode(StatusCodes.Status413PayloadTooLarge,
                new { code = "storage_limit", message = "This upload would exceed the owner's storage limit." });
        var session = new DocumentUploadSession
        {
            ActorUserId = actor.Id,
            OwnerUserId = ownerId,
            FolderId = folderId,
            ReplaceFileId = request.ReplaceFileId,
            Name = name,
            NormalizedName = Normalize(name),
            ContentType = CleanContentType(request.ContentType),
            Fingerprint = request.Fingerprint.ToLowerInvariant(),
            SizeBytes = request.SizeBytes,
            ChunkSize = UploadChunkSize,
            ChunkCount = checked((int)((request.SizeBytes + UploadChunkSize - 1) / UploadChunkSize)),
            ExpiresAt = now + UploadSessionLifetime,
        };
        db.DocumentUploadSessions.Add(session);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Ok(ToUploadStatus(session, []));
    }

    [HttpGet("uploads/{id:guid}")]
    public async Task<IActionResult> UploadStatus(Guid id, [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null) return NotFound();
        var session = await db.DocumentUploadSessions.AsNoTracking().Include(x => x.Chunks)
            .SingleOrDefaultAsync(x => x.Id == id && x.ActorUserId == actor.Id &&
                x.ExpiresAt > DateTimeOffset.UtcNow, cancellationToken);
        if (session is null) return NotFound();
        StoredDocumentDto? completedFile = null;
        if (session.CompletedFileId is Guid fileId)
        {
            var file = await db.StoredDocuments.AsNoTracking()
                .SingleOrDefaultAsync(x => x.Id == fileId, cancellationToken);
            if (file is not null) completedFile = ToDto(file);
        }
        return Ok(ToUploadStatus(session, session.Chunks.Select(x => x.Index).Order(), completedFile,
            session.Chunks.ToDictionary(x => x.Index, x => x.Sha256)));
    }

    [HttpPut("uploads/{id:guid}/chunks/{index:int}")]
    [RequestSizeLimit(UploadChunkSize + 1024)]
    public async Task<IActionResult> PutUploadChunk(Guid id, int index,
        [FromQuery] string username, CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null) return NotFound();
        var session = await db.DocumentUploadSessions.AsNoTracking().SingleOrDefaultAsync(x =>
            x.Id == id && x.ActorUserId == actor.Id && x.CompletedAt == null &&
            x.ExpiresAt > DateTimeOffset.UtcNow, cancellationToken);
        if (session is null || index < 0 || index >= session.ChunkCount) return NotFound();
        var expectedSize = (int)Math.Min(session.ChunkSize,
            session.SizeBytes - (long)index * session.ChunkSize);
        if (Request.ContentLength is long declared && declared != expectedSize)
            return BadRequest(new { message = "The chunk size is incorrect." });
        var expectedHash = Request.Headers["X-Chunk-SHA256"].ToString().ToLowerInvariant();
        if (expectedHash.Length != 64 || !expectedHash.All(Uri.IsHexDigit))
            return BadRequest(new { message = "A SHA-256 chunk checksum is required." });
        await using var buffer = new MemoryStream(expectedSize);
        await Request.Body.CopyToAsync(buffer, cancellationToken);
        if (buffer.Length != expectedSize ||
            !string.Equals(Convert.ToHexStringLower(SHA256.HashData(buffer.GetBuffer().AsSpan(0, expectedSize))),
                expectedHash, StringComparison.Ordinal))
            return BadRequest(new { message = "The chunk is incomplete or its checksum does not match." });
        var existing = await db.DocumentUploadChunks.AsNoTracking().SingleOrDefaultAsync(x =>
            x.SessionId == id && x.Index == index, cancellationToken);
        if (existing is not null)
            return existing.Sha256 == expectedHash ? NoContent() : Conflict(new { message = "This chunk has different content." });

        var key = $"document-upload-chunks/{session.OwnerUserId:N}/{id:N}/{Guid.NewGuid():N}";
        try
        {
            buffer.Position = 0;
            await storage.WriteAsync(key, buffer, cancellationToken);
            await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
            await LockLibrary(session.OwnerUserId, cancellationToken);
            var current = await db.DocumentUploadSessions.SingleOrDefaultAsync(x =>
                x.Id == id && x.ActorUserId == actor.Id && x.CompletedAt == null &&
                x.ExpiresAt > DateTimeOffset.UtcNow, cancellationToken);
            if (current is null) { await DeleteObjects([key]); return NotFound(); }
            existing = await db.DocumentUploadChunks.AsNoTracking().SingleOrDefaultAsync(x =>
                x.SessionId == id && x.Index == index, cancellationToken);
            if (existing is not null)
            {
                await DeleteObjects([key]);
                return existing.Sha256 == expectedHash ? NoContent() : Conflict(new { message = "This chunk has different content." });
            }
            db.DocumentUploadChunks.Add(new DocumentUploadChunk
            {
                SessionId = id, Index = index, StorageKey = key,
                Sha256 = expectedHash, SizeBytes = expectedSize,
            });
            current.ExpiresAt = DateTimeOffset.UtcNow + UploadSessionLifetime;
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return NoContent();
        }
        catch
        {
            await DeleteObjects([key]);
            throw;
        }
    }

    [HttpPost("uploads/{id:guid}/complete")]
    public async Task<IActionResult> CompleteUpload(Guid id, [FromQuery] string username,
        CompleteDocumentUploadRequest request, CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null) return NotFound();
        if (request.Conflict is not ("ask" or "replace" or "keepBoth"))
            return BadRequest(new { message = "Choose Replace or Keep both." });
        var ownerId = await db.DocumentUploadSessions.AsNoTracking().Where(x =>
            x.Id == id && x.ActorUserId == actor.Id && x.ExpiresAt > DateTimeOffset.UtcNow)
            .Select(x => (Guid?)x.OwnerUserId).SingleOrDefaultAsync(cancellationToken);
        if (ownerId is null) return NotFound();
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await LockLibrary(ownerId.Value, cancellationToken);
        var session = await db.DocumentUploadSessions.Include(x => x.Chunks).SingleOrDefaultAsync(x =>
            x.Id == id && x.ActorUserId == actor.Id && x.ExpiresAt > DateTimeOffset.UtcNow,
            cancellationToken);
        if (session is null) return NotFound();
        if (session.CompletedFileId is Guid completedId)
        {
            var completed = await db.StoredDocuments.AsNoTracking()
                .SingleOrDefaultAsync(x => x.Id == completedId, cancellationToken);
            return completed is null ? NotFound() : Ok(ToDto(completed));
        }
        var chunks = session.Chunks.OrderBy(x => x.Index).ToArray();
        if (chunks.Length != session.ChunkCount || chunks.Sum(x => (long)x.SizeBytes) != session.SizeBytes ||
            chunks.Where((chunk, index) => chunk.Index != index).Any())
            return Conflict(new { message = "Some upload chunks are missing. Resume the upload and try again." });
        var destination = session.FolderId is Guid folderId
            ? await db.DocumentFolders.AsNoTracking().SingleOrDefaultAsync(x => x.Id == folderId, cancellationToken)
            : null;
        if (session.ReplaceFileId is null && session.FolderId is not null &&
            (destination is null || await FolderPermission(destination, actor.Id, cancellationToken) is not ("owner" or "editor")))
            return NotFound();
        if (!await FolderExists(session.OwnerUserId, session.FolderId, cancellationToken)) return NotFound();
        StoredDocument? existing;
        if (session.ReplaceFileId is Guid replaceId)
        {
            existing = await db.StoredDocuments.SingleOrDefaultAsync(x => x.Id == replaceId, cancellationToken);
            if (existing is null || await FilePermission(existing, actor.Id, cancellationToken) is not ("owner" or "editor"))
                return NotFound();
        }
        else
        {
            existing = await db.StoredDocuments.SingleOrDefaultAsync(x =>
                x.OwnerUserId == session.OwnerUserId && x.FolderId == session.FolderId &&
                x.DeletedAt == null && x.NormalizedName == session.NormalizedName,
                cancellationToken);
            if (existing is not null && request.Conflict == "ask")
                return Conflict(new { code = "name_conflict", message = "A file with this name already exists here." });
            if (existing is not null && request.Conflict == "replace" &&
                await FilePermission(existing, actor.Id, cancellationToken) is not ("owner" or "editor"))
                return Forbid();
        }
        var reservedOther = await db.DocumentUploadSessions.Where(x => x.OwnerUserId == session.OwnerUserId &&
            x.Id != id && x.CompletedAt == null && x.ExpiresAt > DateTimeOffset.UtcNow)
            .SumAsync(x => (long?)x.SizeBytes, cancellationToken) ?? 0;
        if (await UsedStorage(session.OwnerUserId, cancellationToken) + reservedOther + session.SizeBytes > await StorageLimitBytes(session.OwnerUserId, cancellationToken))
            return StatusCode(StatusCodes.Status413PayloadTooLarge,
                new { code = "storage_limit", message = "This upload would exceed the owner's storage limit." });
        var key = $"documents/{session.OwnerUserId:N}/{Guid.NewGuid():N}";
        var chunkKeys = chunks.Select(x => x.StorageKey).ToArray();
        try
        {
            await storage.WriteFromPartsAsync(key, chunkKeys, cancellationToken);
            var now = DateTimeOffset.UtcNow;
            StoredDocument document;
            if ((existing is not null && request.Conflict == "replace") || session.ReplaceFileId is not null)
            {
                document = existing!;
                db.DocumentVersions.Add(PreviousVersion(document));
                document.StorageKey = key;
                document.ContentType = session.ContentType;
                document.SizeBytes = session.SizeBytes;
                document.UpdatedAt = now;
                document.CurrentVersionCreatedAt = now;
                document.CurrentVersionNumber++;
            }
            else
            {
                var name = existing is not null && request.Conflict == "keepBoth"
                    ? await NextAvailableName(session.OwnerUserId, session.FolderId, session.Name, cancellationToken)
                    : session.Name;
                document = new StoredDocument
                {
                    OwnerUserId = session.OwnerUserId,
                    FolderId = session.FolderId,
                    Name = name,
                    NormalizedName = Normalize(name),
                    ContentType = session.ContentType,
                    SizeBytes = session.SizeBytes,
                    StorageKey = key,
                    CurrentVersionCreatedAt = now,
                };
                db.StoredDocuments.Add(document);
            }
            session.CompletedAt = now;
            session.ExpiresAt = now + UploadSessionLifetime;
            db.DocumentUploadChunks.RemoveRange(chunks);
            await db.SaveChangesAsync(cancellationToken);
            session.CompletedFileId = document.Id;
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            await DeleteObjects(chunkKeys);
            return Ok(ToDto(document));
        }
        catch
        {
            await DeleteObjects([key]);
            throw;
        }
    }

    [HttpDelete("uploads/{id:guid}")]
    public async Task<IActionResult> CancelUpload(Guid id, [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null) return NotFound();
        var ownerId = await db.DocumentUploadSessions.AsNoTracking().Where(x =>
            x.Id == id && x.ActorUserId == actor.Id).Select(x => (Guid?)x.OwnerUserId)
            .SingleOrDefaultAsync(cancellationToken);
        if (ownerId is null) return NotFound();
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await LockLibrary(ownerId.Value, cancellationToken);
        var session = await db.DocumentUploadSessions.Include(x => x.Chunks).SingleOrDefaultAsync(x =>
            x.Id == id && x.ActorUserId == actor.Id, cancellationToken);
        if (session is null) return NotFound();
        var keys = session.Chunks.Select(x => x.StorageKey).ToArray();
        db.DocumentUploadSessions.Remove(session);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        await DeleteObjects(keys);
        return NoContent();
    }

    private async Task CleanupExpiredUploads(CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var expired = await db.DocumentUploadSessions.AsNoTracking()
            .Where(x => x.ExpiresAt <= now).OrderBy(x => x.ExpiresAt)
            .Select(x => new { x.Id, x.OwnerUserId }).Take(100).ToArrayAsync(ct);
        foreach (var item in expired)
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await LockLibrary(item.OwnerUserId, ct);
            var session = await db.DocumentUploadSessions.Include(x => x.Chunks)
                .SingleOrDefaultAsync(x => x.Id == item.Id && x.ExpiresAt <= DateTimeOffset.UtcNow, ct);
            if (session is null) continue;
            var keys = session.Chunks.Select(x => x.StorageKey).ToArray();
            db.DocumentUploadSessions.Remove(session);
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            await DeleteObjects(keys);
        }
    }

    private static DocumentUploadStatusDto ToUploadStatus(DocumentUploadSession session,
        IEnumerable<int> uploadedChunks, StoredDocumentDto? completedFile = null,
        IReadOnlyDictionary<int, string>? uploadedChunkHashes = null) =>
        new(session.Id, session.Name, session.Fingerprint, session.SizeBytes,
            session.ChunkSize, session.ChunkCount, uploadedChunks.ToArray(),
            session.ExpiresAt, completedFile, uploadedChunkHashes ?? new Dictionary<int, string>());
}

public sealed record StartDocumentUploadRequest(string? Name, Guid? FolderId,
    Guid? ReplaceFileId, string? ContentType, long SizeBytes, string Fingerprint,
    string Conflict);
public sealed record CompleteDocumentUploadRequest(string Conflict);
public sealed record DocumentUploadStatusDto(Guid Id, string Name, string Fingerprint,
    long SizeBytes, int ChunkSize, int ChunkCount, IReadOnlyList<int> UploadedChunks,
    DateTimeOffset ExpiresAt, StoredDocumentDto? CompletedFile,
    IReadOnlyDictionary<int, string> UploadedChunkHashes);
