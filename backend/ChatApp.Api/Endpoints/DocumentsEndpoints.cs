using ChatApp.Api.Authentication;
using static Microsoft.AspNetCore.Http.Results;
using ChatApp.Application.Abstractions;
using System.Data;
using System.Security.Cryptography;
using ChatApp.Api.Services;
using ChatApp.Persistence;
using ChatApp.Domain.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using QRCoder;

namespace ChatApp.Api.Endpoints;

public sealed partial class DocumentsEndpoints(
    ChatAppDbContext db,
    IUploadObjectStorage storage,
    IConfiguration configuration,
    ILogger<DocumentsEndpoints> logger)
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/documents")
            .RequireAuthorization();
        group.AddEndpointFilterFactory(AuthenticatedActorFilter.Create);
        group.AddEndpointFilterFactory(RequestValidationFilter.Create);

        group.MapPost("uploads", (
            [FromServices] DocumentsEndpoints handler,
            [FromQuery] string username,
            [FromBody] StartDocumentUploadRequest request,
            CancellationToken cancellationToken) =>
            handler.StartUpload(username, request, cancellationToken))
            .WithName("DocumentsEndpoints.StartUpload");

        group.MapGet("uploads/{id:guid}", (
            [FromServices] DocumentsEndpoints handler,
            Guid id,
            [FromQuery] string username,
            CancellationToken cancellationToken) =>
            handler.UploadStatus(id, username, cancellationToken))
            .WithName("DocumentsEndpoints.UploadStatus");

        group.MapPut("uploads/{id:guid}/chunks/{index:int}", (
            [FromServices] DocumentsEndpoints handler,
            HttpContext httpContext,
            Guid id,
            int index,
            [FromQuery] string username,
            CancellationToken cancellationToken) =>
            handler.PutUploadChunk(httpContext, id, index, username, cancellationToken))
            .WithName("DocumentsEndpoints.PutUploadChunk")
            .WithMetadata(new RequestSizeLimitAttribute(UploadChunkSize + 1024));

        group.MapPost("uploads/{id:guid}/complete", (
            [FromServices] DocumentsEndpoints handler,
            Guid id,
            [FromQuery] string username,
            [FromBody] CompleteDocumentUploadRequest request,
            CancellationToken cancellationToken) =>
            handler.CompleteUpload(id, username, request, cancellationToken))
            .WithName("DocumentsEndpoints.CompleteUpload");

        group.MapDelete("uploads/{id:guid}", (
            [FromServices] DocumentsEndpoints handler,
            Guid id,
            [FromQuery] string username,
            CancellationToken cancellationToken) =>
            handler.CancelUpload(id, username, cancellationToken))
            .WithName("DocumentsEndpoints.CancelUpload");

        group.MapGet("storage-management", (
            [FromServices] DocumentsEndpoints handler,
            [FromQuery] string username,
            [FromQuery] string? query,
            CancellationToken cancellationToken,
            [FromQuery] int offset = default) =>
            handler.StorageManagement(username, query, offset, cancellationToken))
            .WithName("DocumentsEndpoints.StorageManagement")
            .RequireAuthorization(ChatApp.Domain.Security.AppRoles.ManageUsers);

        group.MapPut("storage-management/{userId:guid}/limit", (
            [FromServices] DocumentsEndpoints handler,
            Guid userId,
            [FromQuery] string username,
            [FromBody] SetStorageLimitRequest request,
            CancellationToken cancellationToken) =>
            handler.SetStorageLimit(userId, username, request, cancellationToken))
            .WithName("DocumentsEndpoints.SetStorageLimit")
            .RequireAuthorization(ChatApp.Domain.Security.AppRoles.ManageUsers);

        group.MapGet("search", (
            [FromServices] DocumentsEndpoints handler,
            [FromQuery] string username,
            [FromQuery] string query,
            CancellationToken cancellationToken) =>
            handler.Search(username, query, cancellationToken))
            .WithName("DocumentsEndpoints.Search");

        group.MapPost("bulk", (
            [FromServices] DocumentsEndpoints handler,
            [FromQuery] string username,
            [FromBody] DocumentBulkRequest request,
            CancellationToken cancellationToken) =>
            handler.Bulk(username, request, cancellationToken))
            .WithName("DocumentsEndpoints.Bulk");

        group.MapGet("storage", (
            [FromServices] DocumentsEndpoints handler,
            [FromQuery] string username,
            CancellationToken cancellationToken) =>
            handler.StorageUsage(username, cancellationToken))
            .WithName("DocumentsEndpoints.StorageUsage");

        group.MapGet("orphan-attachments", ([FromServices] DocumentsEndpoints handler, [FromQuery] string username, int? page, bool? unattributed, HttpContext context, CancellationToken ct) =>
            handler.OrphanAttachments(username, page, unattributed ?? false, context.User.IsInRole(ChatApp.Domain.Security.AppRoles.GlobalAdmin), ct));

        group.MapDelete("orphan-attachments/{id:guid}", ([FromServices] DocumentsEndpoints handler, [FromQuery] string username, Guid id, bool? unattributed, HttpContext context, CancellationToken ct) =>
            handler.DeleteOrphanAttachment(username, id, unattributed ?? false, context.User.IsInRole(ChatApp.Domain.Security.AppRoles.GlobalAdmin), ct));

        group.MapGet("", (
            [FromServices] DocumentsEndpoints handler,
            [FromQuery] string username,
            [FromQuery] Guid? folderId,
            CancellationToken cancellationToken) =>
            handler.List(username, folderId, cancellationToken))
            .WithName("DocumentsEndpoints.List");

        group.MapPost("folders", (
            [FromServices] DocumentsEndpoints handler,
            [FromQuery] string username,
            [FromBody] FolderRequest request,
            CancellationToken cancellationToken) =>
            handler.CreateFolder(username, request, cancellationToken))
            .WithName("DocumentsEndpoints.CreateFolder");

        group.MapPatch("folders/{id:guid}", (
            [FromServices] DocumentsEndpoints handler,
            Guid id,
            [FromQuery] string username,
            [FromBody] RenameDocumentRequest request,
            CancellationToken cancellationToken) =>
            handler.RenameFolder(id, username, request, cancellationToken))
            .WithName("DocumentsEndpoints.RenameFolder");

        group.MapDelete("folders/{id:guid}", (
            [FromServices] DocumentsEndpoints handler,
            Guid id,
            [FromQuery] string username,
            CancellationToken cancellationToken) =>
            handler.DeleteFolder(id, username, cancellationToken))
            .WithName("DocumentsEndpoints.DeleteFolder");

        group.MapPost("files", (
            [FromServices] DocumentsEndpoints handler,
            [FromQuery] string username,
            [FromForm] IFormFile file,
            [FromForm] Guid? folderId,
            [FromForm] string? conflict,
            CancellationToken cancellationToken) =>
            handler.Upload(username, file, folderId, conflict, cancellationToken))
            .WithName("DocumentsEndpoints.Upload")
            .WithMetadata(new RequestSizeLimitAttribute(55 * 1024 * 1024))
            .DisableAntiforgery();

        group.MapPatch("files/{id:guid}", (
            [FromServices] DocumentsEndpoints handler,
            Guid id,
            [FromQuery] string username,
            [FromBody] RenameDocumentRequest request,
            CancellationToken cancellationToken) =>
            handler.RenameFile(id, username, request, cancellationToken))
            .WithName("DocumentsEndpoints.RenameFile");

        group.MapPut("files/{id:guid}/content", (
            [FromServices] DocumentsEndpoints handler,
            Guid id,
            [FromQuery] string username,
            [FromForm] IFormFile file,
            CancellationToken cancellationToken) =>
            handler.ReplaceContent(id, username, file, cancellationToken))
            .WithName("DocumentsEndpoints.ReplaceContent")
            .WithMetadata(new RequestSizeLimitAttribute(55 * 1024 * 1024))
            .DisableAntiforgery();

        group.MapDelete("files/{id:guid}", (
            [FromServices] DocumentsEndpoints handler,
            Guid id,
            [FromQuery] string username,
            CancellationToken cancellationToken) =>
            handler.DeleteFile(id, username, cancellationToken))
            .WithName("DocumentsEndpoints.DeleteFile");

        group.MapGet("files/{id:guid}/content", (
            [FromServices] DocumentsEndpoints handler,
            HttpContext httpContext,
            Guid id,
            [FromQuery] string username,
            [FromQuery] bool download = false,
            CancellationToken cancellationToken = default) =>
            handler.Download(httpContext, id, username, download, cancellationToken))
            .WithName("DocumentsEndpoints.Download");

        group.MapGet("files/{id:guid}/versions", (
            [FromServices] DocumentsEndpoints handler,
            Guid id,
            [FromQuery] string username,
            CancellationToken cancellationToken) =>
            handler.FileVersions(id, username, cancellationToken))
            .WithName("DocumentsEndpoints.FileVersions");

        group.MapGet("files/{id:guid}/versions/{versionId:guid}/content", (
            [FromServices] DocumentsEndpoints handler,
            HttpContext httpContext,
            Guid id,
            Guid versionId,
            [FromQuery] string username,
            [FromQuery] bool download = false,
            CancellationToken cancellationToken = default) =>
            handler.VersionContent(httpContext, id, versionId, username, download, cancellationToken))
            .WithName("DocumentsEndpoints.VersionContent");

        group.MapPost("files/{id:guid}/versions/{versionId:guid}/restore", (
            [FromServices] DocumentsEndpoints handler,
            Guid id,
            Guid versionId,
            [FromQuery] string username,
            CancellationToken cancellationToken) =>
            handler.RestoreVersion(id, versionId, username, cancellationToken))
            .WithName("DocumentsEndpoints.RestoreVersion");

        group.MapDelete("files/{id:guid}/versions/{versionId:guid}", (
            [FromServices] DocumentsEndpoints handler,
            Guid id,
            Guid versionId,
            [FromQuery] string username,
            CancellationToken cancellationToken) =>
            handler.DeleteVersion(id, versionId, username, cancellationToken))
            .WithName("DocumentsEndpoints.DeleteVersion");

        group.MapGet("folders/{id:guid}/properties", (
            [FromServices] DocumentsEndpoints handler,
            Guid id,
            [FromQuery] string username,
            CancellationToken cancellationToken) =>
            handler.FolderProperties(id, username, cancellationToken))
            .WithName("DocumentsEndpoints.FolderProperties");

        group.MapGet("files/{id:guid}/properties", (
            [FromServices] DocumentsEndpoints handler,
            Guid id,
            [FromQuery] string username,
            CancellationToken cancellationToken) =>
            handler.FileProperties(id, username, cancellationToken))
            .WithName("DocumentsEndpoints.FileProperties");

        group.MapGet("trash", (
            [FromServices] DocumentsEndpoints handler,
            [FromQuery] string username,
            CancellationToken cancellationToken) =>
            handler.Trash(username, cancellationToken))
            .WithName("DocumentsEndpoints.Trash");

        group.MapPatch("folders/{id:guid}/restore", (
            [FromServices] DocumentsEndpoints handler,
            Guid id,
            [FromQuery] string username,
            CancellationToken cancellationToken) =>
            handler.RestoreFolder(id, username, cancellationToken))
            .WithName("DocumentsEndpoints.RestoreFolder");

        group.MapPatch("files/{id:guid}/restore", (
            [FromServices] DocumentsEndpoints handler,
            Guid id,
            [FromQuery] string username,
            CancellationToken cancellationToken) =>
            handler.RestoreFile(id, username, cancellationToken))
            .WithName("DocumentsEndpoints.RestoreFile");

        group.MapDelete("trash/files/{id:guid}", (
            [FromServices] DocumentsEndpoints handler,
            Guid id,
            [FromQuery] string username,
            CancellationToken cancellationToken) =>
            handler.PurgeFile(id, username, cancellationToken))
            .WithName("DocumentsEndpoints.PurgeFile");

        group.MapDelete("trash/folders/{id:guid}", (
            [FromServices] DocumentsEndpoints handler,
            Guid id,
            [FromQuery] string username,
            CancellationToken cancellationToken) =>
            handler.PurgeFolder(id, username, cancellationToken))
            .WithName("DocumentsEndpoints.PurgeFolder");

        group.MapGet("shared", (
            [FromServices] DocumentsEndpoints handler,
            [FromQuery] string username,
            CancellationToken cancellationToken) =>
            handler.Shared(username, cancellationToken))
            .WithName("DocumentsEndpoints.Shared");

        group.MapGet("shared-by-me", (
            [FromServices] DocumentsEndpoints handler,
            [FromQuery] string username,
            CancellationToken cancellationToken) =>
            handler.SharedByMe(username, cancellationToken))
            .WithName("DocumentsEndpoints.SharedByMe");

        group.MapGet("shares", (
            [FromServices] DocumentsEndpoints handler,
            [FromQuery] string username,
            [FromQuery] string kind,
            CancellationToken cancellationToken,
            [FromQuery] Guid? id = null) =>
            handler.GetShares(username, kind, id ?? Guid.Empty, cancellationToken))
            .WithName("DocumentsEndpoints.GetShares");

        group.MapPut("shares", (
            [FromServices] DocumentsEndpoints handler,
            [FromQuery] string username,
            [FromBody] DocumentShareRequest request,
            CancellationToken cancellationToken) =>
            handler.PutShare(username, request, cancellationToken))
            .WithName("DocumentsEndpoints.PutShare");

        group.MapDelete("shares/{id:guid}", (
            [FromServices] DocumentsEndpoints handler,
            Guid id,
            [FromQuery] string username,
            CancellationToken cancellationToken) =>
            handler.RemoveShare(id, username, cancellationToken))
            .WithName("DocumentsEndpoints.RemoveShare");

        group.MapGet("public-links", (
            [FromServices] DocumentsEndpoints handler,
            [FromQuery] string username,
            [FromQuery] string kind,
            CancellationToken cancellationToken,
            [FromQuery] Guid? id = null) =>
            handler.GetPublicLink(username, kind, id ?? Guid.Empty, cancellationToken))
            .WithName("DocumentsEndpoints.GetPublicLink");

        group.MapPut("public-links", (
            [FromServices] DocumentsEndpoints handler,
            [FromQuery] string username,
            [FromBody] DocumentPublicLinkRequest request,
            CancellationToken cancellationToken) =>
            handler.PutPublicLink(username, request, cancellationToken))
            .WithName("DocumentsEndpoints.PutPublicLink");

        group.MapDelete("public-links", (
            [FromServices] DocumentsEndpoints handler,
            [FromQuery] string username,
            [FromQuery] string kind,
            CancellationToken cancellationToken,
            [FromQuery] Guid? id = null) =>
            handler.RemovePublicLink(username, kind, id ?? Guid.Empty, cancellationToken))
            .WithName("DocumentsEndpoints.RemovePublicLink");

        group.MapGet("public/{token}", (
            [FromServices] DocumentsEndpoints handler,
            HttpContext httpContext,
            string token,
            [FromQuery] Guid? folderId,
            CancellationToken cancellationToken) =>
            handler.PublicListing(httpContext, token, folderId, cancellationToken))
            .WithName("DocumentsEndpoints.PublicListing")
            .AllowAnonymous();

        group.MapGet("public/{token}/qr-code", (
            [FromServices] DocumentsEndpoints handler,
            HttpContext httpContext,
            string token,
            [FromQuery] string origin,
            CancellationToken cancellationToken) =>
            handler.PublicQrCode(httpContext, token, origin, cancellationToken))
            .WithName("DocumentsEndpoints.PublicQrCode")
            .AllowAnonymous();

        group.MapGet("public/{token}/files/{id:guid}/content", (
            [FromServices] DocumentsEndpoints handler,
            HttpContext httpContext,
            string token,
            Guid id,
            [FromQuery] bool download = false,
            CancellationToken cancellationToken = default) =>
            handler.PublicContent(httpContext, token, id, download, cancellationToken))
            .WithName("DocumentsEndpoints.PublicContent")
            .AllowAnonymous();

        group.MapGet("conversation-files", (
            [FromServices] DocumentsEndpoints handler,
            [FromQuery] string username,
            [FromQuery] string scope,
            [FromQuery] string? query,
            CancellationToken cancellationToken,
            [FromQuery] int offset = default) =>
            handler.ConversationFiles(username, scope, query, offset, cancellationToken))
            .WithName("DocumentsEndpoints.ConversationFiles");
    }

    private const long MaxFileSize = 50 * 1024 * 1024;
    private const long DefaultStorageLimit = 5L * 1024 * 1024 * 1024;

    public async Task<IResult> StorageUsage([FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null)
        {
            return NotFound();
        }

        var usedBytes = await UsedStorage(actor.Id, cancellationToken);
        return Ok(new { usedBytes, limitBytes = actor.DocumentStorageLimitBytes ?? DefaultStorageLimitBytes() });
    }

    public async Task<IResult> List(
        [FromQuery] string username,
        [FromQuery] Guid? folderId,
        CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null)
        {
            return NotFound();
        }

        var current = folderId is null ? null : await db.DocumentFolders.AsNoTracking()
            .SingleOrDefaultAsync(x => x.Id == folderId, cancellationToken);
        if (folderId is not null && (current is null ||
            await FolderPermission(current, actor.Id, cancellationToken) is null))
        {
            return NotFound();
        }

        var ownerId = current?.OwnerUserId ?? actor.Id;
        var allFolders = await db.DocumentFolders.AsNoTracking()
            .Where(x => x.OwnerUserId == ownerId && x.DeletedAt == null)
            .ToListAsync(cancellationToken);
        current = folderId is null ? null : allFolders.SingleOrDefault(x => x.Id == folderId);
        var byId = allFolders.ToDictionary(x => x.Id);
        var breadcrumbs = new List<DocumentFolderDto>();
        for (var folder = current; folder is not null; folder =
            folder.ParentFolderId is Guid parentId && byId.TryGetValue(parentId, out var parent)
                ? parent : null)
        {
            breadcrumbs.Add(ToDto(folder));
        }
        breadcrumbs.Reverse();
        if (ownerId != actor.Id)
        {
            var firstAccessible = 0;
            while (firstAccessible < breadcrumbs.Count - 1 &&
                await FolderPermission(allFolders.Single(x => x.Id == breadcrumbs[firstAccessible].Id),
                    actor.Id, cancellationToken) is null)
            {
                firstAccessible++;
            }

            breadcrumbs = breadcrumbs.Skip(firstAccessible).ToList();
        }

        var folders = new List<DocumentFolderDto>();
        foreach (var folder in allFolders.Where(x => x.ParentFolderId == folderId).OrderBy(x => x.Name))
        {
            folders.Add(ToDto(folder, await FolderPermission(folder, actor.Id, cancellationToken) ?? "viewer"));
        }

        var files = await db.StoredDocuments.AsNoTracking()
            .Where(x => x.OwnerUserId == ownerId && x.FolderId == folderId && x.DeletedAt == null)
            .OrderBy(x => x.Name)
            .ToArrayAsync(cancellationToken);
        var fileDtos = new List<StoredDocumentDto>();
        foreach (var file in files)
        {
            fileDtos.Add(ToDto(file, await FilePermission(file, actor.Id, cancellationToken) ?? "viewer"));
        }

        return Ok(new DocumentListingDto(current is null ? null : ToDto(current,
                await FolderPermission(current, actor.Id, cancellationToken) ?? "viewer"),
            breadcrumbs, folders, fileDtos));
    }

    public async Task<IResult> CreateFolder(
        [FromQuery] string username,
        FolderRequest request,
        CancellationToken cancellationToken)
    {
        var owner = await FindOwner(username, cancellationToken);
        if (owner is null)
        {
            return NotFound();
        }

        var name = CleanName(request.Name);
        if (name is null)
        {
            return BadRequest(new { message = "Use a folder name of 1–255 valid characters." });
        }

        var parent = request.ParentFolderId is null ? null : await db.DocumentFolders
            .SingleOrDefaultAsync(x => x.Id == request.ParentFolderId, cancellationToken);
        if (request.ParentFolderId is not null && (parent is null ||
            await FolderPermission(parent, owner.Id, cancellationToken) is not ("owner" or "editor")))
        {
            return NotFound();
        }

        var libraryOwnerId = parent?.OwnerUserId ?? owner.Id;
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await LockLibrary(libraryOwnerId, cancellationToken);
        if (!await FolderExists(libraryOwnerId, request.ParentFolderId, cancellationToken))
        {
            return NotFound(new { message = "The parent folder was not found." });
        }

        if (await HasFolderName(libraryOwnerId, request.ParentFolderId, name, null, cancellationToken))
        {
            return Conflict(new { message = "A folder with this name already exists here." });
        }

        var folder = new DocumentFolder
        {
            OwnerUserId = libraryOwnerId,
            ParentFolderId = request.ParentFolderId,
            Name = name,
            NormalizedName = Normalize(name),
        };
        db.DocumentFolders.Add(folder);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Ok(ToDto(folder));
    }

    public async Task<IResult> RenameFolder(Guid id,
        [FromQuery] string username, RenameDocumentRequest request,
        CancellationToken cancellationToken)
    {
        var owner = await FindOwner(username, cancellationToken);
        if (owner is null)
        {
            return NotFound();
        }

        var name = CleanName(request.Name);
        if (name is null)
        {
            return BadRequest(new { message = "Use a folder name of 1–255 valid characters." });
        }

        var folder = await db.DocumentFolders.SingleOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (folder is null || await FolderPermission(folder, owner.Id, cancellationToken) is not ("owner" or "editor"))
        {
            return NotFound();
        }

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await LockLibrary(folder.OwnerUserId, cancellationToken);
        if (await HasFolderName(folder.OwnerUserId, folder.ParentFolderId, name, id, cancellationToken))
        {
            return Conflict(new { message = "A folder with this name already exists here." });
        }

        folder.Name = name;
        folder.NormalizedName = Normalize(name);
        folder.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Ok(ToDto(folder));
    }

    public async Task<IResult> DeleteFolder(Guid id,
        [FromQuery] string username, CancellationToken cancellationToken)
    {
        var owner = await FindOwner(username, cancellationToken);
        if (owner is null)
        {
            return NotFound();
        }

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await LockLibrary(owner.Id, cancellationToken);
        var folder = await db.DocumentFolders.SingleOrDefaultAsync(x =>
            x.Id == id && x.OwnerUserId == owner.Id && x.DeletedAt == null, cancellationToken);
        if (folder is null || await FolderPermission(folder, owner.Id, cancellationToken) is null)
        {
            return NotFound();
        }

        folder.DeletedAt = DateTimeOffset.UtcNow;
        folder.UpdatedAt = folder.DeletedAt.Value;
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return NoContent();
    }

    public async Task<IResult> Upload(
        [FromQuery] string username,
        [FromForm] IFormFile file,
        [FromForm] Guid? folderId,
        [FromForm] string? conflict,
        CancellationToken cancellationToken)
    {
        var owner = await FindOwner(username, cancellationToken);
        if (owner is null)
        {
            return NotFound();
        }

        var name = CleanName(file.FileName.Replace('\\', '/').Split('/').Last());
        if (name is null)
        {
            return BadRequest(new { message = "Choose a file with a valid name." });
        }

        if (file.Length > MaxFileSize)
        {
            return BadRequest(new { message = "Files must be 50 MB or smaller." });
        }

        if (conflict is not (null or "ask" or "replace" or "keepBoth"))
        {
            return BadRequest(new { message = "Choose Replace or Keep both." });
        }

        var folder = folderId is null ? null : await db.DocumentFolders.AsNoTracking()
            .SingleOrDefaultAsync(x => x.Id == folderId, cancellationToken);
        if (folderId is not null && (folder is null ||
            await FolderPermission(folder, owner.Id, cancellationToken) is not ("owner" or "editor")))
        {
            return NotFound();
        }

        var libraryOwnerId = folder?.OwnerUserId ?? owner.Id;

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await LockLibrary(libraryOwnerId, cancellationToken);
        if (!await FolderExists(libraryOwnerId, folderId, cancellationToken))
        {
            return NotFound(new { message = "The destination folder was not found." });
        }

        var existing = await db.StoredDocuments.SingleOrDefaultAsync(x =>
            x.OwnerUserId == libraryOwnerId && x.FolderId == folderId &&
            x.DeletedAt == null && x.NormalizedName == Normalize(name), cancellationToken);
        if (existing is not null && conflict == "replace" &&
            await FilePermission(existing, owner.Id, cancellationToken) is not ("owner" or "editor"))
        {
            return Forbid();
        }

        if (existing is not null && conflict is null or "ask")
        {
            return Conflict(new { code = "name_conflict", message = "A file with this name already exists here.", existingId = existing.Id, name });
        }

        if (existing is not null && conflict == "keepBoth")
        {
            name = await NextAvailableName(libraryOwnerId, folderId, name, cancellationToken);
        }

        var usedBytes = await UsedStorage(libraryOwnerId, cancellationToken);
        if (usedBytes + await ReservedStorage(libraryOwnerId, cancellationToken) + file.Length > await StorageLimitBytes(libraryOwnerId, cancellationToken))
        {
            return Json(new { code = "storage_limit", message = "This upload would exceed the owner's storage limit." }, statusCode: StatusCodes.Status413PayloadTooLarge);
        }

        var key = $"documents/{libraryOwnerId:N}/{Guid.NewGuid():N}";
        var contentType = CleanContentType(file.ContentType);
        try
        {
            await using (var stream = file.OpenReadStream())
            {
                await storage.WriteAsync(key, stream, cancellationToken);
            }

            StoredDocument document;
            if (existing is not null && conflict == "replace")
            {
                document = existing;
                db.DocumentVersions.Add(PreviousVersion(document));
                document.StorageKey = key;
                document.ContentType = contentType;
                document.SizeBytes = file.Length;
                document.UpdatedAt = DateTimeOffset.UtcNow;
                document.CurrentVersionCreatedAt = document.UpdatedAt;
                document.CurrentVersionNumber++;
            }
            else
            {
                document = new StoredDocument
                {
                    OwnerUserId = libraryOwnerId,
                    FolderId = folderId,
                    Name = name,
                    NormalizedName = Normalize(name),
                    StorageKey = key,
                    ContentType = contentType,
                    SizeBytes = file.Length,
                    CurrentVersionCreatedAt = DateTimeOffset.UtcNow,
                };
                db.StoredDocuments.Add(document);
            }
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return Ok(ToDto(document));
        }
        catch
        {
            try
            {
                await storage.DeleteAsync(key, CancellationToken.None);
            }
            catch (Exception cleanupError)
            {
                logger.LogWarning(cleanupError,
                    "Could not clean up failed document upload {StorageKey}", key);
            }
            throw;
        }
    }

    public async Task<IResult> RenameFile(Guid id,
        [FromQuery] string username, RenameDocumentRequest request,
        CancellationToken cancellationToken)
    {
        var owner = await FindOwner(username, cancellationToken);
        if (owner is null)
        {
            return NotFound();
        }

        var name = CleanName(request.Name);
        if (name is null)
        {
            return BadRequest(new { message = "Use a file name of 1–255 valid characters." });
        }

        var file = await db.StoredDocuments.SingleOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (file is null || await FilePermission(file, owner.Id, cancellationToken) is not ("owner" or "editor"))
        {
            return NotFound();
        }

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await LockLibrary(file.OwnerUserId, cancellationToken);
        if (await db.StoredDocuments.AnyAsync(x => x.OwnerUserId == file.OwnerUserId &&
            x.FolderId == file.FolderId && x.NormalizedName == Normalize(name) &&
            x.DeletedAt == null && x.Id != id, cancellationToken))
        {
            return Conflict(new { message = "A file with this name already exists here." });
        }

        file.Name = name;
        file.NormalizedName = Normalize(name);
        file.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Ok(ToDto(file));
    }

    public async Task<IResult> ReplaceContent(Guid id, [FromQuery] string username,
        [FromForm] IFormFile file, CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null)
        {
            return NotFound();
        }

        if (file.Length > MaxFileSize)
        {
            return BadRequest(new { message = "Files must be 50 MB or smaller." });
        }

        var document = await db.StoredDocuments.SingleOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (document is null || await FilePermission(document, actor.Id, cancellationToken) is not ("owner" or "editor"))
        {
            return NotFound();
        }

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await LockLibrary(document.OwnerUserId, cancellationToken);
        var usedBytes = await UsedStorage(document.OwnerUserId, cancellationToken);
        if (usedBytes + await ReservedStorage(document.OwnerUserId, cancellationToken) + file.Length > await StorageLimitBytes(document.OwnerUserId, cancellationToken))
        {
            return Json(new { code = "storage_limit", message = "This upload would exceed the owner's storage limit." }, statusCode: StatusCodes.Status413PayloadTooLarge);
        }

        var key = $"documents/{document.OwnerUserId:N}/{Guid.NewGuid():N}";
        try
        {
            await using (var stream = file.OpenReadStream())
            {
                await storage.WriteAsync(key, stream, cancellationToken);
            }

            db.DocumentVersions.Add(PreviousVersion(document));
            document.StorageKey = key;
            document.ContentType = CleanContentType(file.ContentType);
            document.SizeBytes = file.Length;
            document.UpdatedAt = DateTimeOffset.UtcNow;
            document.CurrentVersionCreatedAt = document.UpdatedAt;
            document.CurrentVersionNumber++;
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return Ok(ToDto(document));
        }
        catch
        {
            try
            {
                await storage.DeleteAsync(key, CancellationToken.None);
            }
            catch (Exception cleanupError)
            {
                logger.LogWarning(cleanupError, "Could not clean up failed document upload {StorageKey}", key);
            }
            throw;
        }
    }

    public async Task<IResult> DeleteFile(Guid id,
        [FromQuery] string username, CancellationToken cancellationToken)
    {
        var owner = await FindOwner(username, cancellationToken);
        if (owner is null)
        {
            return NotFound();
        }

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await LockLibrary(owner.Id, cancellationToken);
        var file = await db.StoredDocuments.SingleOrDefaultAsync(x =>
            x.Id == id && x.OwnerUserId == owner.Id && x.DeletedAt == null, cancellationToken);
        if (file is null || await FilePermission(file, owner.Id, cancellationToken) is null)
        {
            return NotFound();
        }

        file.DeletedAt = DateTimeOffset.UtcNow;
        file.UpdatedAt = file.DeletedAt.Value;
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return NoContent();
    }

    public async Task<IResult> Download(HttpContext httpContext, Guid id,
        [FromQuery] string username,
        [FromQuery] bool download = false,
        CancellationToken cancellationToken = default)
    {
        var owner = await FindOwner(username, cancellationToken);
        if (owner is null)
        {
            return NotFound();
        }

        var file = await db.StoredDocuments.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (file is null || await FilePermission(file, owner.Id, cancellationToken) is null)
        {
            return NotFound();
        }

        var stream = await storage.OpenReadAsync(file.StorageKey, cancellationToken);
        if (stream is null)
        {
            return NotFound();
        }

        httpContext.Response.Headers["X-Content-Type-Options"] = "nosniff";
        if (!download && IsPreviewable(file.ContentType))
        {
            return File(stream, file.ContentType, enableRangeProcessing: true);
        }

        return File(stream, "application/octet-stream", file.Name,
            enableRangeProcessing: true);
    }

    public async Task<IResult> FileVersions(Guid id, [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null)
        {
            return NotFound();
        }

        var file = await db.StoredDocuments.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (file is null || await FilePermission(file, actor.Id, cancellationToken) is null)
        {
            return NotFound();
        }

        var versions = await db.DocumentVersions.AsNoTracking().Where(x => x.DocumentId == id)
            .OrderByDescending(x => x.Number)
            .Select(x => new DocumentVersionDto(x.Id, x.Number, x.ContentType, x.SizeBytes,
                x.CreatedAt, false)).ToListAsync(cancellationToken);
        versions.Insert(0, new DocumentVersionDto(null, file.CurrentVersionNumber,
            file.ContentType, file.SizeBytes, file.CurrentVersionCreatedAt ?? file.UpdatedAt, true));
        return Ok(versions);
    }

    public async Task<IResult> VersionContent(HttpContext httpContext, Guid id, Guid versionId,
        [FromQuery] string username, [FromQuery] bool download = false,
        CancellationToken cancellationToken = default)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null)
        {
            return NotFound();
        }

        var file = await db.StoredDocuments.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (file is null || await FilePermission(file, actor.Id, cancellationToken) is null)
        {
            return NotFound();
        }

        var version = await db.DocumentVersions.AsNoTracking().SingleOrDefaultAsync(x =>
            x.Id == versionId && x.DocumentId == id, cancellationToken);
        if (version is null)
        {
            return NotFound();
        }

        var stream = await storage.OpenReadAsync(version.StorageKey, cancellationToken);
        if (stream is null)
        {
            return NotFound();
        }

        httpContext.Response.Headers["X-Content-Type-Options"] = "nosniff";
        if (!download && IsPreviewable(version.ContentType))
        {
            return File(stream, version.ContentType, enableRangeProcessing: true);
        }

        return File(stream, "application/octet-stream", file.Name,
            enableRangeProcessing: true);
    }

    public async Task<IResult> RestoreVersion(Guid id, Guid versionId,
        [FromQuery] string username, CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null)
        {
            return NotFound();
        }

        var document = await db.StoredDocuments.SingleOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (document is null || await FilePermission(document, actor.Id, cancellationToken) is not ("owner" or "editor"))
        {
            return NotFound();
        }

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await LockLibrary(document.OwnerUserId, cancellationToken);
        var version = await db.DocumentVersions.AsNoTracking().SingleOrDefaultAsync(x =>
            x.Id == versionId && x.DocumentId == id, cancellationToken);
        if (version is null)
        {
            return NotFound();
        }

        if (await UsedStorage(document.OwnerUserId, cancellationToken) +
            await ReservedStorage(document.OwnerUserId, cancellationToken) + version.SizeBytes >
            await StorageLimitBytes(document.OwnerUserId, cancellationToken))
        {
            return Json(new { code = "storage_limit", message = "Restoring this version would exceed the owner's storage limit. Delete an older version first." }, statusCode: StatusCodes.Status413PayloadTooLarge);
        }

        var source = await storage.OpenReadAsync(version.StorageKey, cancellationToken);
        if (source is null)
        {
            return NotFound();
        }

        var key = $"documents/{document.OwnerUserId:N}/{Guid.NewGuid():N}";
        try
        {
            await using (source)
            {
                await storage.WriteAsync(key, source, cancellationToken);
            }

            db.DocumentVersions.Add(PreviousVersion(document));
            document.StorageKey = key;
            document.ContentType = version.ContentType;
            document.SizeBytes = version.SizeBytes;
            document.UpdatedAt = DateTimeOffset.UtcNow;
            document.CurrentVersionCreatedAt = document.UpdatedAt;
            document.CurrentVersionNumber++;
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return Ok(ToDto(document));
        }
        catch
        {
            try
            {
                await storage.DeleteAsync(key, CancellationToken.None);
            }
            catch (Exception cleanupError)
            {
                logger.LogWarning(cleanupError, "Could not clean up failed version restore {StorageKey}", key);
            }
            throw;
        }
    }

    public async Task<IResult> DeleteVersion(Guid id, Guid versionId,
        [FromQuery] string username, CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null)
        {
            return NotFound();
        }

        var file = await db.StoredDocuments.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (file is null || await FilePermission(file, actor.Id, cancellationToken) is not ("owner" or "editor"))
        {
            return NotFound();
        }

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await LockLibrary(file.OwnerUserId, cancellationToken);
        var version = await db.DocumentVersions.SingleOrDefaultAsync(x =>
            x.Id == versionId && x.DocumentId == id, cancellationToken);
        if (version is null)
        {
            return NotFound();
        }

        var key = version.StorageKey;
        db.DocumentVersions.Remove(version);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        await DeleteObjects([key]);
        return NoContent();
    }

    public async Task<IResult> FolderProperties(Guid id, [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null)
        {
            return NotFound();
        }

        var folder = await db.DocumentFolders.AsNoTracking().Include(x => x.OwnerUser)
            .SingleOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (folder is null)
        {
            return NotFound();
        }

        var permission = folder.DeletedAt is not null && folder.OwnerUserId == actor.Id
            ? "owner" : await FolderPermission(folder, actor.Id, cancellationToken);
        if (permission is null)
        {
            return NotFound();
        }

        var allFolders = await db.DocumentFolders.AsNoTracking()
            .Where(x => x.OwnerUserId == folder.OwnerUserId && x.DeletedAt == null)
            .Select(x => new { x.Id, x.ParentFolderId }).ToListAsync(cancellationToken);
        var descendantIds = new List<Guid> { id };
        for (var index = 0; index < descendantIds.Count; index++)
        {
            descendantIds.AddRange(allFolders.Where(x => x.ParentFolderId == descendantIds[index])
                .Select(x => x.Id));
        }

        var fileSummary = await db.StoredDocuments.AsNoTracking()
            .Where(x => x.OwnerUserId == folder.OwnerUserId && x.DeletedAt == null &&
                x.FolderId != null && descendantIds.Contains(x.FolderId.Value))
            .GroupBy(x => 1)
            .Select(group => new { Count = group.Count(), Bytes = group.Sum(x => x.SizeBytes) })
            .SingleOrDefaultAsync(cancellationToken);
        return Ok(new DocumentPropertiesDto("folder", folder.Id, folder.Name,
            await FolderLocation(folder.ParentFolderId, actor.Id, folder.OwnerUserId, cancellationToken),
            folder.OwnerUser.UserName, folder.OwnerUser.DisplayName, permission,
            folder.CreatedAt, folder.UpdatedAt, folder.DeletedAt, null,
            fileSummary?.Bytes ?? 0, descendantIds.Count - 1, fileSummary?.Count ?? 0));
    }

    public async Task<IResult> FileProperties(Guid id, [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null)
        {
            return NotFound();
        }

        var file = await db.StoredDocuments.AsNoTracking().Include(x => x.OwnerUser)
            .SingleOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (file is null)
        {
            return NotFound();
        }

        var permission = file.DeletedAt is not null && file.OwnerUserId == actor.Id
            ? "owner" : await FilePermission(file, actor.Id, cancellationToken);
        if (permission is null)
        {
            return NotFound();
        }

        return Ok(new DocumentPropertiesDto("file", file.Id, file.Name,
            await FolderLocation(file.FolderId, actor.Id, file.OwnerUserId, cancellationToken),
            file.OwnerUser.UserName, file.OwnerUser.DisplayName, permission,
            file.CreatedAt, file.UpdatedAt, file.DeletedAt, file.ContentType,
            file.SizeBytes, null, null));
    }

    public async Task<IResult> Trash([FromQuery] string username, CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null)
        {
            return NotFound();
        }

        var folders = await db.DocumentFolders.AsNoTracking()
            .Where(x => x.OwnerUserId == actor.Id && x.DeletedAt != null)
            .OrderByDescending(x => x.DeletedAt).ToListAsync(cancellationToken);
        var files = await db.StoredDocuments.AsNoTracking()
            .Where(x => x.OwnerUserId == actor.Id && x.DeletedAt != null)
            .OrderByDescending(x => x.DeletedAt).ToListAsync(cancellationToken);
        return Ok(new DocumentListingDto(null, [], folders.Select(x => ToDto(x, "owner")).ToArray(),
            files.Select(x => ToDto(x, "owner")).ToArray()));
    }

    public async Task<IResult> RestoreFolder(Guid id, [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null)
        {
            return NotFound();
        }

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await LockLibrary(actor.Id, cancellationToken);
        var folder = await db.DocumentFolders.SingleOrDefaultAsync(x =>
            x.Id == id && x.OwnerUserId == actor.Id && x.DeletedAt != null, cancellationToken);
        if (folder is null)
        {
            return NotFound();
        }

        if (!await FolderExists(actor.Id, folder.ParentFolderId, cancellationToken))
        {
            return Conflict(new { message = "Restore the parent folder first." });
        }

        if (await HasFolderName(actor.Id, folder.ParentFolderId, folder.Name, id, cancellationToken))
        {
            folder.Name = await NextAvailableFolderName(actor.Id, folder.ParentFolderId,
                folder.Name, cancellationToken);
            folder.NormalizedName = Normalize(folder.Name);
        }
        folder.DeletedAt = null;
        folder.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Ok(ToDto(folder));
    }

    public async Task<IResult> RestoreFile(Guid id, [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null)
        {
            return NotFound();
        }

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await LockLibrary(actor.Id, cancellationToken);
        var file = await db.StoredDocuments.SingleOrDefaultAsync(x =>
            x.Id == id && x.OwnerUserId == actor.Id && x.DeletedAt != null, cancellationToken);
        if (file is null)
        {
            return NotFound();
        }

        if (!await FolderExists(actor.Id, file.FolderId, cancellationToken))
        {
            return Conflict(new { message = "Restore the parent folder first." });
        }

        if (await db.StoredDocuments.AnyAsync(x => x.OwnerUserId == actor.Id &&
            x.FolderId == file.FolderId && x.NormalizedName == file.NormalizedName &&
            x.DeletedAt == null, cancellationToken))
        {
            file.Name = await NextAvailableName(actor.Id, file.FolderId, file.Name, cancellationToken);
            file.NormalizedName = Normalize(file.Name);
        }
        file.DeletedAt = null;
        file.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Ok(ToDto(file));
    }

    public async Task<IResult> PurgeFile(Guid id, [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null)
        {
            return NotFound();
        }

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await LockLibrary(actor.Id, cancellationToken);
        var file = await db.StoredDocuments.SingleOrDefaultAsync(x => x.Id == id &&
            x.OwnerUserId == actor.Id && x.DeletedAt != null, cancellationToken);
        if (file is null)
        {
            return NotFound();
        }

        if (await db.SignatureRequests.AnyAsync(x => x.DocumentId == id, cancellationToken))
        {
            return Conflict(new { message = "Documents with signing requests cannot be permanently deleted." });
        }
        var keys = await db.DocumentVersions.Where(x => x.DocumentId == id)
            .Select(x => x.StorageKey).ToListAsync(cancellationToken);
        keys.Add(file.StorageKey);
        db.StoredDocuments.Remove(file);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        await DeleteObjects(keys);
        return NoContent();
    }

    public async Task<IResult> PurgeFolder(Guid id, [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null)
        {
            return NotFound();
        }

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await LockLibrary(actor.Id, cancellationToken);
        var folders = await db.DocumentFolders.AsNoTracking()
            .Where(x => x.OwnerUserId == actor.Id)
            .Select(x => new { x.Id, x.ParentFolderId, x.DeletedAt })
            .ToListAsync(cancellationToken);
        if (!folders.Any(x => x.Id == id && x.DeletedAt != null))
        {
            return NotFound();
        }

        var descendants = new List<Guid> { id };
        for (var index = 0; index < descendants.Count; index++)
        {
            descendants.AddRange(folders.Where(x => x.ParentFolderId == descendants[index])
                .Select(x => x.Id));
        }

        var files = await db.StoredDocuments.Where(x => x.OwnerUserId == actor.Id &&
            x.FolderId != null && descendants.Contains(x.FolderId.Value))
            .ToListAsync(cancellationToken);
        var fileIds = files.Select(x => x.Id).ToArray();
        if (await db.SignatureRequests.AnyAsync(x => fileIds.Contains(x.DocumentId), cancellationToken))
        {
            return Conflict(new { message = "This folder contains documents with signing requests and cannot be permanently deleted." });
        }
        var keys = await db.DocumentVersions.Where(x => fileIds.Contains(x.DocumentId))
            .Select(x => x.StorageKey).ToListAsync(cancellationToken);
        keys.AddRange(files.Select(x => x.StorageKey));
        db.StoredDocuments.RemoveRange(files);
        await db.SaveChangesAsync(cancellationToken);
        foreach (var folderId in descendants.AsEnumerable().Reverse())
        {
            await db.DocumentFolders.Where(x => x.Id == folderId && x.OwnerUserId == actor.Id)
                .ExecuteDeleteAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        await DeleteObjects(keys);
        return NoContent();
    }

    public async Task<IResult> Shared([FromQuery] string username, CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null)
        {
            return NotFound();
        }

        var shares = await db.DocumentShares.AsNoTracking()
            .Include(x => x.Folder).Include(x => x.File).Include(x => x.OwnerUser)
            .Where(x => x.GranteeUserId == actor.Id && x.OwnerUser.Status == "active")
            .ToListAsync(cancellationToken);
        var folders = new List<DocumentFolderDto>();
        var files = new List<StoredDocumentDto>();
        foreach (var share in shares)
        {
            if (share.Folder is { } folder && await FolderPermission(folder, actor.Id, cancellationToken) is { } folderPermission)
            {
                folders.Add(ToDto(folder, folderPermission, share.OwnerUser.UserName));
            }

            if (share.File is { } file && await FilePermission(file, actor.Id, cancellationToken) is { } filePermission)
            {
                files.Add(ToDto(file, filePermission, share.OwnerUser.UserName));
            }
        }
        return Ok(new DocumentListingDto(null, [], folders, files));
    }

    public async Task<IResult> SharedByMe([FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null)
        {
            return NotFound();
        }

        var peopleShares = await db.DocumentShares.AsNoTracking()
            .Where(x => x.OwnerUserId == actor.Id && x.GranteeUser.Status == "active")
            .Select(x => new { x.FolderId, x.FileId }).ToListAsync(cancellationToken);
        var publicLinks = await db.DocumentPublicLinks.AsNoTracking()
            .Where(x => x.OwnerUserId == actor.Id)
            .Select(x => new { x.FolderId, x.FileId, x.ExpiresAt })
            .ToListAsync(cancellationToken);
        var folderIds = peopleShares.Where(x => x.FolderId != null).Select(x => x.FolderId!.Value)
            .Concat(publicLinks.Where(x => x.FolderId != null).Select(x => x.FolderId!.Value))
            .Distinct().ToArray();
        var fileIds = peopleShares.Where(x => x.FileId != null).Select(x => x.FileId!.Value)
            .Concat(publicLinks.Where(x => x.FileId != null).Select(x => x.FileId!.Value))
            .Distinct().ToArray();
        var folderCandidates = await db.DocumentFolders.AsNoTracking()
            .Where(x => x.OwnerUserId == actor.Id && folderIds.Contains(x.Id) && x.DeletedAt == null)
            .ToListAsync(cancellationToken);
        var fileCandidates = await db.StoredDocuments.AsNoTracking()
            .Where(x => x.OwnerUserId == actor.Id && fileIds.Contains(x.Id) && x.DeletedAt == null)
            .ToListAsync(cancellationToken);
        var folders = new List<DocumentFolderDto>();
        var files = new List<StoredDocumentDto>();
        var summaries = new Dictionary<Guid, DocumentSharingSummaryDto>();
        foreach (var folder in folderCandidates)
        {
            if (await FolderPermission(folder, actor.Id, cancellationToken) is null)
            {
                continue;
            }

            folders.Add(ToDto(folder));
            var link = publicLinks.SingleOrDefault(x => x.FolderId == folder.Id);
            summaries[folder.Id] = new DocumentSharingSummaryDto(
                peopleShares.Count(x => x.FolderId == folder.Id), link is not null,
                link?.ExpiresAt is { } expiry && expiry <= DateTimeOffset.UtcNow);
        }
        foreach (var file in fileCandidates)
        {
            if (await FilePermission(file, actor.Id, cancellationToken) is null)
            {
                continue;
            }

            files.Add(ToDto(file));
            var link = publicLinks.SingleOrDefault(x => x.FileId == file.Id);
            summaries[file.Id] = new DocumentSharingSummaryDto(
                peopleShares.Count(x => x.FileId == file.Id), link is not null,
                link?.ExpiresAt is { } expiry && expiry <= DateTimeOffset.UtcNow);
        }
        return Ok(new DocumentListingDto(null, [], folders, files)
        {
            SharingSummaries = summaries,
        });
    }

    public async Task<IResult> GetShares([FromQuery] string username,
        [FromQuery] string kind, [FromQuery] Guid id, CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null)
        {
            return NotFound();
        }

        if (!await OwnsTarget(actor.Id, kind, id, cancellationToken))
        {
            return NotFound();
        }

        var shares = await db.DocumentShares.AsNoTracking().Include(x => x.GranteeUser)
            .Where(x => (kind == "folder" ? x.FolderId == id : x.FileId == id))
            .OrderBy(x => (((x.GranteeUser.FirstName ?? "") + " " + (x.GranteeUser.LastName ?? "")).Trim() == "" ? x.GranteeUser.UserName : ((x.GranteeUser.FirstName ?? "") + " " + (x.GranteeUser.LastName ?? "")).Trim()))
            .Select(x => new DocumentShareDto(x.Id, x.GranteeUser.UserName,
                (((x.GranteeUser.FirstName ?? "") + " " + (x.GranteeUser.LastName ?? "")).Trim() == "" ? x.GranteeUser.UserName : ((x.GranteeUser.FirstName ?? "") + " " + (x.GranteeUser.LastName ?? "")).Trim()), x.Permission))
            .ToListAsync(cancellationToken);
        return Ok(shares);
    }

    public async Task<IResult> PutShare([FromQuery] string username,
        DocumentShareRequest request, CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null)
        {
            return NotFound();
        }

        if (request.Permission is not ("viewer" or "editor") ||
            request.Kind is not ("folder" or "file"))
        {
            return BadRequest(new { message = "Choose Viewer or Editor." });
        }

        if (!await OwnsTarget(actor.Id, request.Kind, request.Id, cancellationToken))
        {
            return NotFound();
        }

        var grantee = await FindOwner(request.RecipientUsername, cancellationToken);
        if (grantee is null)
        {
            return BadRequest(new { message = "Choose an active person." });
        }

        if (grantee.Id == actor.Id)
        {
            return BadRequest(new { message = "You already own this item." });
        }

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await LockLibrary(actor.Id, cancellationToken);
        var share = await db.DocumentShares.SingleOrDefaultAsync(x =>
            x.GranteeUserId == grantee.Id && (request.Kind == "folder" ?
                x.FolderId == request.Id : x.FileId == request.Id), cancellationToken);
        if (share is null)
        {
            share = new DocumentShare
            {
                OwnerUserId = actor.Id,
                GranteeUserId = grantee.Id,
                FolderId = request.Kind == "folder" ? request.Id : null,
                FileId = request.Kind == "file" ? request.Id : null,
                Permission = request.Permission,
            };
            db.DocumentShares.Add(share);
            var targetTitle = request.Kind == "folder"
                ? await db.DocumentFolders.Where(x => x.Id == request.Id)
                    .Select(x => x.Name).SingleAsync(cancellationToken)
                : await db.StoredDocuments.Where(x => x.Id == request.Id)
                    .Select(x => x.Name).SingleAsync(cancellationToken);
            db.UserNotifications.Add(new UserNotification
            {
                UserId = grantee.Id,
                ActorUserId = actor.Id,
                Type = request.Kind == "folder" ? "document_folder_share" : "document_file_share",
                TargetId = request.Id,
                TargetTitle = targetTitle,
            });
        }
        else
        {
            share.Permission = request.Permission;
        }

        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Ok(new DocumentShareDto(share.Id, grantee.UserName, grantee.DisplayName, share.Permission));
    }

    public async Task<IResult> RemoveShare(Guid id, [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null)
        {
            return NotFound();
        }

        var share = await db.DocumentShares.SingleOrDefaultAsync(x =>
            x.Id == id && x.OwnerUserId == actor.Id, cancellationToken);
        if (share is null)
        {
            return NotFound();
        }

        db.DocumentShares.Remove(share);
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    public async Task<IResult> GetPublicLink([FromQuery] string username,
        [FromQuery] string kind, [FromQuery] Guid id, CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null || !await OwnsTarget(actor.Id, kind, id, cancellationToken))
        {
            return NotFound();
        }

        var link = await db.DocumentPublicLinks.AsNoTracking().SingleOrDefaultAsync(x =>
            x.OwnerUserId == actor.Id && (kind == "folder" ? x.FolderId == id : x.FileId == id), cancellationToken);
        return link is null ? NoContent() : Ok(new DocumentPublicLinkDto(link.Token, link.CreatedAt, link.ExpiresAt));
    }

    public async Task<IResult> PutPublicLink([FromQuery] string username,
        DocumentPublicLinkRequest request, CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null || !await OwnsTarget(actor.Id, request.Kind, request.Id, cancellationToken))
        {
            return NotFound();
        }

        if (request.ExpiresAt is { } expiresAt && expiresAt <= DateTimeOffset.UtcNow)
        {
            return BadRequest(new { message = "Choose an expiry date in the future." });
        }

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await LockLibrary(actor.Id, cancellationToken);
        var link = await db.DocumentPublicLinks.SingleOrDefaultAsync(x =>
            x.OwnerUserId == actor.Id && (request.Kind == "folder" ? x.FolderId == request.Id : x.FileId == request.Id), cancellationToken);
        if (link is null)
        {
            link = new DocumentPublicLink
            {
                OwnerUserId = actor.Id,
                FolderId = request.Kind == "folder" ? request.Id : null,
                FileId = request.Kind == "file" ? request.Id : null,
                Token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
                    .TrimEnd('=').Replace('+', '-').Replace('/', '_'),
                ExpiresAt = request.ExpiresAt,
            };
            db.DocumentPublicLinks.Add(link);
        }
        else
        {
            link.ExpiresAt = request.ExpiresAt;
        }

        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Ok(new DocumentPublicLinkDto(link.Token, link.CreatedAt, link.ExpiresAt));
    }

    public async Task<IResult> RemovePublicLink([FromQuery] string username,
        [FromQuery] string kind, [FromQuery] Guid id, CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null || !await OwnsTarget(actor.Id, kind, id, cancellationToken))
        {
            return NotFound();
        }

        await db.DocumentPublicLinks.Where(x => x.OwnerUserId == actor.Id &&
            (kind == "folder" ? x.FolderId == id : x.FileId == id)).ExecuteDeleteAsync(cancellationToken);
        return NoContent();
    }

    public async Task<IResult> PublicListing(HttpContext httpContext, string token, [FromQuery] Guid? folderId,
        CancellationToken cancellationToken)
    {
        var link = await ActivePublicLink(token, cancellationToken);
        if (link is null)
        {
            return NotFound();
        }

        httpContext.Response.Headers.CacheControl = "no-store";
        if (link.FileId is Guid fileId)
        {
            if (folderId is not null)
            {
                return NotFound();
            }

            var file = await db.StoredDocuments.AsNoTracking().SingleOrDefaultAsync(x => x.Id == fileId, cancellationToken);
            if (file is null || await FilePermission(file, link.OwnerUserId, cancellationToken) is null)
            {
                return NotFound();
            }

            return Ok(new PublicDocumentListingDto("file", file.Name, null, [], [], [ToDto(file)]));
        }
        var rootId = link.FolderId!.Value;
        var currentId = folderId ?? rootId;
        var path = await PublicFolderPath(currentId, rootId, link.OwnerUserId, cancellationToken);
        if (path is null)
        {
            return NotFound();
        }

        var folders = await db.DocumentFolders.AsNoTracking().Where(x =>
            x.OwnerUserId == link.OwnerUserId && x.ParentFolderId == currentId && x.DeletedAt == null)
            .OrderBy(x => x.Name).ToListAsync(cancellationToken);
        var files = await db.StoredDocuments.AsNoTracking().Where(x =>
            x.OwnerUserId == link.OwnerUserId && x.FolderId == currentId && x.DeletedAt == null)
            .OrderBy(x => x.Name).ToListAsync(cancellationToken);
        return Ok(new PublicDocumentListingDto("folder", path[0].Name, ToDto(path[^1]),
            path.Select(x => ToDto(x)).ToArray(), folders.Select(x => ToDto(x)).ToArray(),
            files.Select(x => ToDto(x)).ToArray()));
    }

    public async Task<IResult> PublicQrCode(HttpContext httpContext, string token, [FromQuery] string origin,
        CancellationToken cancellationToken)
    {
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var uiOrigin) ||
            uiOrigin.Scheme is not ("http" or "https"))
        {
            return BadRequest(new { message = "A valid HTTP or HTTPS UI origin is required." });
        }

        if (await ActivePublicLink(token, cancellationToken) is null)
        {
            return NotFound();
        }

        var publicUrl = new Uri(uiOrigin, $"/?publicDocument={Uri.EscapeDataString(token)}").AbsoluteUri;
        using var qrCodeData = QRCodeGenerator.GenerateQrCode(publicUrl, QRCodeGenerator.ECCLevel.Q);
        using var qrCode = new PngByteQRCode(qrCodeData);
        httpContext.Response.Headers.CacheControl = "no-store";
        return File(qrCode.GetGraphic(8), "image/png");
    }

    public async Task<IResult> PublicContent(HttpContext httpContext, string token, Guid id,
        [FromQuery] bool download = false, CancellationToken cancellationToken = default)
    {
        var link = await ActivePublicLink(token, cancellationToken);
        if (link is null)
        {
            return NotFound();
        }

        var file = await db.StoredDocuments.AsNoTracking().SingleOrDefaultAsync(x =>
            x.Id == id && x.OwnerUserId == link.OwnerUserId && x.DeletedAt == null, cancellationToken);
        if (file is null || await FilePermission(file, link.OwnerUserId, cancellationToken) is null)
        {
            return NotFound();
        }

        if (link.FileId is Guid sharedFileId)
        {
            if (sharedFileId != id)
            {
                return NotFound();
            }
        }
        else if (file.FolderId is not Guid folderId ||
            await PublicFolderPath(folderId, link.FolderId!.Value, link.OwnerUserId, cancellationToken) is null)
        {
            return NotFound();
        }

        var stream = await storage.OpenReadAsync(file.StorageKey, cancellationToken);
        if (stream is null)
        {
            return NotFound();
        }

        httpContext.Response.Headers.CacheControl = "no-store";
        httpContext.Response.Headers["X-Content-Type-Options"] = "nosniff";
        if (!download && IsPreviewable(file.ContentType))
        {
            return File(stream, file.ContentType, enableRangeProcessing: true);
        }

        return File(stream, "application/octet-stream", file.Name, enableRangeProcessing: true);
    }

    private async Task<DocumentPublicLink?> ActivePublicLink(string token, CancellationToken ct)
    {
        if (token.Length != 43)
        {
            return null;
        }

        var now = DateTimeOffset.UtcNow;
        return await db.DocumentPublicLinks.AsNoTracking().SingleOrDefaultAsync(x =>
            x.Token == token && x.OwnerUser.Status == "active" &&
            (x.ExpiresAt == null || x.ExpiresAt > now), ct);
    }

    private async Task<List<DocumentFolder>?> PublicFolderPath(Guid currentId, Guid rootId,
        Guid ownerId, CancellationToken ct)
    {
        var path = new List<DocumentFolder>();
        var visited = new HashSet<Guid>();
        while (visited.Add(currentId))
        {
            var folder = await db.DocumentFolders.AsNoTracking().SingleOrDefaultAsync(x =>
                x.Id == currentId && x.OwnerUserId == ownerId && x.DeletedAt == null, ct);
            if (folder is null)
            {
                return null;
            }

            path.Add(folder);
            if (currentId == rootId)
            {
                if (await FolderPermission(folder, ownerId, ct) is null)
                {
                    return null;
                }

                path.Reverse();
                return path;
            }
            if (folder.ParentFolderId is not Guid parentId)
            {
                return null;
            }

            currentId = parentId;
        }
        return null;
    }

    private async Task<ChatUser?> FindOwner(string username, CancellationToken ct) =>
        await db.Users.SingleOrDefaultAsync(x =>
            x.NormalizedUserName == Username.Normalize(username) && x.Status == "active", ct);

    private async Task<string> FolderLocation(Guid? folderId, Guid actorId,
        Guid ownerId, CancellationToken ct)
    {
        var names = new List<string>();
        var visited = new HashSet<Guid>();
        while (folderId is Guid id && visited.Add(id))
        {
            var folder = await db.DocumentFolders.AsNoTracking()
                .SingleOrDefaultAsync(x => x.Id == id && x.OwnerUserId == ownerId, ct);
            if (folder is null || actorId != ownerId &&
                await FolderPermission(folder, actorId, ct) is null)
            {
                break;
            }

            names.Add(folder.Name);
            folderId = folder.ParentFolderId;
        }
        names.Reverse();
        return string.Join(" / ", new[] { actorId == ownerId ? "My Documents" : "Shared with me" }
            .Concat(names));
    }

    private long DefaultStorageLimitBytes()
    {
        var configured = configuration.GetValue<long?>("Documents:DefaultStorageLimitBytes");
        return configured is > 0 ? configured.Value : DefaultStorageLimit;
    }

    private async Task<long> StorageLimitBytes(Guid ownerId, CancellationToken ct) =>
        await db.Users.Where(x => x.Id == ownerId)
            .Select(x => x.DocumentStorageLimitBytes)
            .SingleAsync(ct) ?? DefaultStorageLimitBytes();

    private async Task<long> UsedStorage(Guid ownerId, CancellationToken ct)
    {
        var currentBytes = await db.StoredDocuments.Where(x => x.OwnerUserId == ownerId)
            .SumAsync(x => (long?)x.SizeBytes, ct) ?? 0;
        var versionBytes = await db.DocumentVersions.Where(x => x.Document.OwnerUserId == ownerId)
            .SumAsync(x => (long?)x.SizeBytes, ct) ?? 0;
        var signingBytes = await db.SignatureRequests.Where(x => x.CreatedById == ownerId)
            .SumAsync(x => (long?)(x.OriginalSizeBytes + x.SignedSizeBytes), ct) ?? 0;
        return currentBytes + versionBytes + signingBytes + await ChatApp.Infrastructure.Storage.FormStorageUsage.UsedBytes(db, ownerId, ct);
    }

    private async Task<long> ReservedStorage(Guid ownerId, CancellationToken ct) =>
        await db.DocumentUploadSessions.Where(x => x.OwnerUserId == ownerId &&
            x.CompletedAt == null && x.ExpiresAt > DateTimeOffset.UtcNow)
            .SumAsync(x => (long?)x.SizeBytes, ct) ?? 0;

    private static DocumentVersion PreviousVersion(StoredDocument document) => new()
    {
        DocumentId = document.Id,
        Number = document.CurrentVersionNumber,
        StorageKey = document.StorageKey,
        ContentType = document.ContentType,
        SizeBytes = document.SizeBytes,
        CreatedAt = document.CurrentVersionCreatedAt ?? document.UpdatedAt,
    };

    private async Task<bool> FolderExists(Guid ownerId, Guid? folderId, CancellationToken ct)
    {
        if (folderId is null)
        {
            return true;
        }

        var folder = await db.DocumentFolders.AsNoTracking().SingleOrDefaultAsync(x =>
            x.Id == folderId && x.OwnerUserId == ownerId, ct);
        return folder is not null && await FolderPermission(folder, ownerId, ct) is not null;
    }

    private async Task<string?> FolderPermission(DocumentFolder folder, Guid actorId, CancellationToken ct)
    {
        var ancestorIds = new List<Guid>();
        var visited = new HashSet<Guid>();
        DocumentFolder? current = folder;
        while (current is not null)
        {
            if (current.DeletedAt is not null || !visited.Add(current.Id))
            {
                return null;
            }

            ancestorIds.Add(current.Id);
            current = current.ParentFolderId is Guid parentId
                ? await db.DocumentFolders.AsNoTracking().SingleOrDefaultAsync(x => x.Id == parentId, ct)
                : null;
            if (current is not null && current.OwnerUserId != folder.OwnerUserId)
            {
                return null;
            }
        }
        if (folder.OwnerUserId == actorId)
        {
            return "owner";
        }

        var permissions = await db.DocumentShares.AsNoTracking()
            .Where(x => x.GranteeUserId == actorId && x.FolderId != null &&
                ancestorIds.Contains(x.FolderId.Value))
            .Select(x => x.Permission).ToListAsync(ct);
        return permissions.Contains("editor") ? "editor" :
            permissions.Contains("viewer") ? "viewer" : null;
    }

    public async Task<bool> CanSignAsync(Guid id, Guid userId, CancellationToken ct)
    {
        var file = await db.StoredDocuments.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct);
        return file is not null && await FilePermission(file, userId, ct) is "owner" or "editor";
    }

    private async Task<string?> FilePermission(StoredDocument file, Guid actorId, CancellationToken ct)
    {
        if (file.DeletedAt is not null)
        {
            return null;
        }

        string? folderPermission = null;
        if (file.FolderId is Guid folderId)
        {
            var folder = await db.DocumentFolders.AsNoTracking()
                .SingleOrDefaultAsync(x => x.Id == folderId, ct);
            if (folder is null || await FolderPermission(folder, file.OwnerUserId, ct) is null)
            {
                return null;
            }

            folderPermission = await FolderPermission(folder, actorId, ct);
            if (file.OwnerUserId == actorId && folderPermission is null)
            {
                return null;
            }
        }
        if (file.OwnerUserId == actorId)
        {
            return "owner";
        }

        var permissions = await db.DocumentShares.AsNoTracking()
            .Where(x => x.GranteeUserId == actorId && x.FileId == file.Id)
            .Select(x => x.Permission).ToListAsync(ct);
        return folderPermission == "editor" || permissions.Contains("editor") ? "editor" :
            folderPermission == "viewer" || permissions.Contains("viewer") ? "viewer" : null;
    }

    private async Task<bool> OwnsTarget(Guid ownerId, string kind, Guid id, CancellationToken ct)
    {
        if (kind == "folder")
        {
            var folder = await db.DocumentFolders.AsNoTracking().SingleOrDefaultAsync(x =>
                x.Id == id && x.OwnerUserId == ownerId, ct);
            return folder is not null && await FolderPermission(folder, ownerId, ct) == "owner";
        }
        if (kind == "file")
        {
            var file = await db.StoredDocuments.AsNoTracking().SingleOrDefaultAsync(x =>
                x.Id == id && x.OwnerUserId == ownerId, ct);
            return file is not null && await FilePermission(file, ownerId, ct) == "owner";
        }
        return false;
    }

    private Task<bool> HasFolderName(Guid ownerId, Guid? parentId,
        string name, Guid? exceptId, CancellationToken ct) =>
        db.DocumentFolders.AnyAsync(x => x.OwnerUserId == ownerId &&
            x.ParentFolderId == parentId && x.NormalizedName == Normalize(name) &&
            x.DeletedAt == null && x.Id != exceptId, ct);

    private async Task<string> NextAvailableName(Guid ownerId, Guid? folderId,
        string name, CancellationToken ct)
    {
        var extension = Path.GetExtension(name);
        var stem = name[..^extension.Length];
        for (var index = 2; index <= 10000; index++)
        {
            var suffix = $" ({index})";
            var shortened = stem[..Math.Min(stem.Length, 255 - extension.Length - suffix.Length)];
            var candidate = $"{shortened}{suffix}{extension}";
            if (!await db.StoredDocuments.AnyAsync(x => x.OwnerUserId == ownerId &&
                x.FolderId == folderId && x.DeletedAt == null &&
                x.NormalizedName == Normalize(candidate), ct))
            {
                return candidate;
            }
        }
        throw new InvalidOperationException("No available file name was found.");
    }

    private async Task<string> NextAvailableFolderName(Guid ownerId, Guid? parentId,
        string name, CancellationToken ct)
    {
        for (var index = 2; index <= 10000; index++)
        {
            var suffix = $" ({index})";
            var candidate = $"{name[..Math.Min(name.Length, 255 - suffix.Length)]}{suffix}";
            if (!await HasFolderName(ownerId, parentId, candidate, null, ct))
            {
                return candidate;
            }
        }
        throw new InvalidOperationException("No available folder name was found.");
    }

    private async Task LockLibrary(Guid ownerId, CancellationToken ct)
    {
        await using var command = db.Database.GetDbConnection().CreateCommand();
        command.Transaction = db.Database.CurrentTransaction!.GetDbTransaction();
        command.CommandText = "DECLARE @result int; EXEC @result = sp_getapplock " +
            "@Resource = @resource, @LockMode = 'Exclusive', " +
            "@LockOwner = 'Transaction', @LockTimeout = 15000; SELECT @result;";
        var parameter = command.CreateParameter();
        parameter.ParameterName = "@resource";
        parameter.Value = $"user-documents:{ownerId:N}";
        command.Parameters.Add(parameter);
        if (Convert.ToInt32(await command.ExecuteScalarAsync(ct)) < 0)
        {
            throw new TimeoutException("Could not lock the document library.");
        }
    }

    private async Task DeleteObjects(IEnumerable<string> keys)
    {
        foreach (var key in keys)
        {
            try
            {
                await storage.DeleteAsync(key, CancellationToken.None);
            }
            catch (Exception error)
            {
                logger.LogWarning(error, "Could not remove document object {StorageKey}", key);
            }
        }
    }

    private static string? CleanName(string? value)
    {
        var name = value?.Trim();
        if (string.IsNullOrWhiteSpace(name) || name.Length > 255 ||
            name is "." or ".." || name.EndsWith('.') ||
            name.Any(c => char.IsControl(c) || "\\/:*?\"<>|".Contains(c)))
        {
            return null;
        }

        return name;
    }

    private static string Normalize(string name) => name.ToUpperInvariant();
    private static string CleanContentType(string? value)
    {
        var contentType = value?.Split(';', 2)[0].Trim().ToLowerInvariant();
        return string.IsNullOrEmpty(contentType) || contentType.Length > 255
            ? "application/octet-stream" : contentType;
    }
    private static bool IsPreviewable(string contentType) => contentType is
        "application/pdf" or "image/jpeg" or "image/png" or "image/webp" or "image/gif";
    private static DocumentFolderDto ToDto(DocumentFolder folder,
        string permission = "owner", string? ownerUsername = null) =>
        new(folder.Id, folder.ParentFolderId, folder.Name, folder.CreatedAt,
            folder.UpdatedAt, folder.DeletedAt, permission, ownerUsername);
    private static StoredDocumentDto ToDto(StoredDocument file,
        string permission = "owner", string? ownerUsername = null) =>
        new(file.Id, file.FolderId, file.Name, file.ContentType, file.SizeBytes,
            file.CreatedAt, file.UpdatedAt, file.DeletedAt, permission, ownerUsername);
}

public sealed record FolderRequest(Guid? ParentFolderId, string? Name);
public sealed record RenameDocumentRequest(string? Name);
public sealed record DocumentFolderDto(Guid Id, Guid? ParentFolderId, string Name,
    DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, DateTimeOffset? DeletedAt,
    string Permission, string? OwnerUsername);
public sealed record StoredDocumentDto(Guid Id, Guid? FolderId, string Name,
    string ContentType, long SizeBytes, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
    DateTimeOffset? DeletedAt, string Permission, string? OwnerUsername);
public sealed record DocumentShareRequest(string Kind, Guid Id, string RecipientUsername,
    string Permission);
public sealed record DocumentShareDto(Guid Id, string Username, string DisplayName,
    string Permission);
public sealed record DocumentPublicLinkRequest(string Kind, Guid Id, DateTimeOffset? ExpiresAt);
public sealed record DocumentPublicLinkDto(string Token, DateTimeOffset CreatedAt,
    DateTimeOffset? ExpiresAt);
public sealed record DocumentVersionDto(Guid? Id, int Number, string ContentType,
    long SizeBytes, DateTimeOffset CreatedAt, bool IsCurrent);
public sealed record PublicDocumentListingDto(string Kind, string Name,
    DocumentFolderDto? CurrentFolder, IReadOnlyList<DocumentFolderDto> Breadcrumbs,
    IReadOnlyList<DocumentFolderDto> Folders, IReadOnlyList<StoredDocumentDto> Files);
public sealed record DocumentPropertiesDto(string Kind, Guid Id, string Name,
    string Location, string OwnerUsername, string OwnerDisplayName, string Permission,
    DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, DateTimeOffset? DeletedAt,
    string? ContentType, long SizeBytes, int? FolderCount, int? FileCount);
public sealed record DocumentListingDto(DocumentFolderDto? CurrentFolder,
    IReadOnlyList<DocumentFolderDto> Breadcrumbs,
    IReadOnlyList<DocumentFolderDto> Folders,
    IReadOnlyList<StoredDocumentDto> Files)
{
    public IReadOnlyDictionary<Guid, DocumentSharingSummaryDto>? SharingSummaries { get; init; }
    public IReadOnlyDictionary<Guid, string>? Locations { get; init; }
}
public sealed record DocumentSharingSummaryDto(int PeopleCount, bool HasPublicLink,
    bool PublicLinkExpired);
