using ChatApp.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Controllers;

public sealed partial class DocumentsController
{
    private const long MaximumStorageLimit = 100L * 1024 * 1024 * 1024 * 1024;

    [Microsoft.AspNetCore.Authorization.Authorize(Roles = ChatApp.Domain.Security.AppRoles.GlobalAdmin)]
    [HttpGet("storage-management")]
    public async Task<IActionResult> StorageManagement([FromQuery] string username,
        [FromQuery] string? query, [FromQuery] int offset,
        CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null) return NotFound();
        if (offset < 0 || query?.Length > 100)
            return BadRequest(new { message = "Choose a valid search and page." });

        var users = db.Users.AsNoTracking().AsQueryable();
        var term = query?.Trim();
        if (!string.IsNullOrEmpty(term))
        {
            var normalized = Username.Normalize(term);
            users = users.Where(x => x.NormalizedUserName.Contains(normalized) ||
                (((x.FirstName ?? "") + " " + (x.LastName ?? "")).Trim() == "" ? x.UserName : ((x.FirstName ?? "") + " " + (x.LastName ?? "")).Trim()).Contains(term));
        }

        const int pageSize = 100;
        var totalCount = await users.CountAsync(cancellationToken);
        var page = await users.OrderBy(x => x.NormalizedUserName)
            .Skip(offset).Take(pageSize).Select(x => new
            {
                x.Id, Username = x.UserName, DisplayName = (((x.FirstName ?? "") + " " + (x.LastName ?? "")).Trim() == "" ? x.UserName : ((x.FirstName ?? "") + " " + (x.LastName ?? "")).Trim()), x.Status,
                CustomLimitBytes = x.DocumentStorageLimitBytes,
            }).ToArrayAsync(cancellationToken);
        var ids = page.Select(x => x.Id).ToArray();
        var documentBytes = await db.StoredDocuments.AsNoTracking()
            .Where(x => ids.Contains(x.OwnerUserId))
            .GroupBy(x => x.OwnerUserId)
            .Select(x => new { UserId = x.Key, Bytes = x.Sum(file => file.SizeBytes) })
            .ToDictionaryAsync(x => x.UserId, x => x.Bytes, cancellationToken);
        var versionBytes = await db.DocumentVersions.AsNoTracking()
            .Where(x => ids.Contains(x.Document.OwnerUserId))
            .GroupBy(x => x.Document.OwnerUserId)
            .Select(x => new { UserId = x.Key, Bytes = x.Sum(version => version.SizeBytes) })
            .ToDictionaryAsync(x => x.UserId, x => x.Bytes, cancellationToken);
        var reservations = await db.DocumentUploadSessions.AsNoTracking()
            .Where(x => ids.Contains(x.OwnerUserId) && x.CompletedAt == null &&
                x.ExpiresAt > DateTimeOffset.UtcNow)
            .GroupBy(x => x.OwnerUserId)
            .Select(x => new { UserId = x.Key, Bytes = x.Sum(session => session.SizeBytes) })
            .ToDictionaryAsync(x => x.UserId, x => x.Bytes, cancellationToken);
        var defaultLimit = DefaultStorageLimitBytes();
        var items = page.Select(x => new StorageUserDto(x.Id, x.Username, x.DisplayName,
            x.Status, documentBytes.GetValueOrDefault(x.Id) + versionBytes.GetValueOrDefault(x.Id),
            reservations.GetValueOrDefault(x.Id), x.CustomLimitBytes ?? defaultLimit,
            x.CustomLimitBytes)).ToArray();

        var allDocumentBytes = await db.StoredDocuments.AsNoTracking()
            .SumAsync(x => (long?)x.SizeBytes, cancellationToken) ?? 0;
        var allVersionBytes = await db.DocumentVersions.AsNoTracking()
            .SumAsync(x => (long?)x.SizeBytes, cancellationToken) ?? 0;
        var userCount = await db.Users.CountAsync(cancellationToken);

        return Ok(new StorageUsersPageDto(items, totalCount, offset + items.Length < totalCount,
            defaultLimit, userCount, allDocumentBytes + allVersionBytes));
    }

    [Microsoft.AspNetCore.Authorization.Authorize(Roles = ChatApp.Domain.Security.AppRoles.GlobalAdmin)]
    [HttpPut("storage-management/{userId:guid}/limit")]
    public async Task<IActionResult> SetStorageLimit(Guid userId,
        [FromQuery] string username, SetStorageLimitRequest request,
        CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null) return NotFound();
        if (request.LimitBytes is <= 0 or > MaximumStorageLimit)
            return BadRequest(new { message = "Choose a limit between 1 byte and 100 TB, or use the default." });

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await LockLibrary(userId, cancellationToken);
        var target = await db.Users.SingleOrDefaultAsync(x => x.Id == userId,
            cancellationToken);
        if (target is null) return NotFound();
        target.DocumentStorageLimitBytes = request.LimitBytes;
        target.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Ok(new { target.Id, target.DocumentStorageLimitBytes,
            limitBytes = target.DocumentStorageLimitBytes ?? DefaultStorageLimitBytes() });
    }

}

public sealed record StorageUserDto(Guid Id, string Username, string DisplayName,
    string Status, long UsedBytes, long ReservedBytes, long LimitBytes,
    long? CustomLimitBytes);
public sealed record StorageUsersPageDto(IReadOnlyList<StorageUserDto> Items,
    int TotalCount, bool HasMore, long DefaultLimitBytes, int UserCount,
    long TotalUsedBytes);
public sealed record SetStorageLimitRequest(long? LimitBytes);
