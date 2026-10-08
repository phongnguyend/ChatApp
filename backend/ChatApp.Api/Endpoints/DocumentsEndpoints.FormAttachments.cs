using Microsoft.EntityFrameworkCore;
using static Microsoft.AspNetCore.Http.Results;

namespace ChatApp.Api.Endpoints;

public sealed partial class DocumentsEndpoints
{
    public async Task<IResult> OrphanAttachments(string username, int? page, bool unattributed, bool admin, CancellationToken ct)
    {
        if (unattributed && !admin)
        {
            return Forbid();
        }
        var user = await FindOwner(username, ct);
        if (user is null)
        {
            return NotFound();
        }
        var currentPage = Math.Clamp(page ?? 1, 1, 1000000);
        Guid? uploaderId = unattributed ? null : user.Id;
        var query = db.FormAttachmentUploads.AsNoTracking().Where(x => (x.CreatedById ?? x.FormOwnerId) == uploaderId);
        var total = await query.CountAsync(ct);
        var totalBytes = await query.SumAsync(x => (long?)x.SizeBytes, ct) ?? 0;
        var now = DateTimeOffset.UtcNow;
        var items = await query.OrderByDescending(x => x.ExpiresAt).ThenBy(x => x.Id).Skip((currentPage - 1) * 50).Take(50)
            .Select(x => new
            {
                x.Id, x.FileName, x.SizeBytes, x.ExpiresAt, x.Ready,
                FormTitle = db.Forms.Where(f => f.Id == x.FormId).Select(f => f.Title).FirstOrDefault(),
                CanDelete = x.ExpiresAt <= now
            }).ToListAsync(ct);
        return Ok(new { items, total, totalBytes, page = currentPage, pageSize = 50, canManageUnattributed = admin });
    }

    public async Task<IResult> DeleteOrphanAttachment(string username, Guid id, bool unattributed, bool admin, CancellationToken ct)
    {
        if (unattributed && !admin)
        {
            return Forbid();
        }
        var user = await FindOwner(username, ct);
        if (user is null)
        {
            return NotFound();
        }
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        Guid? uploaderId = unattributed ? null : user.Id;
        await ChatApp.Infrastructure.Storage.FormStorageUsage.Lock(db, uploaderId, ct);
        // Serialize against submission claiming this upload; committed attachments are never deleted here.
        var upload = await db.FormAttachmentUploads.FromSqlInterpolated($"SELECT * FROM [FormAttachmentUploads] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = {id}").Where(x => (x.CreatedById ?? x.FormOwnerId) == uploaderId).SingleOrDefaultAsync(ct);
        if (upload is null)
        {
            return NotFound();
        }
        if (upload.ExpiresAt > DateTimeOffset.UtcNow)
        {
            return Conflict(new { message = "Attachments can only be deleted after they expire." });
        }
        // Retain the record and its storage charge when object deletion fails, allowing the user to retry.
        await storage.DeleteAsync(upload.StorageKey, ct);
        db.FormAttachmentUploads.Remove(upload);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return NoContent();
    }
}
