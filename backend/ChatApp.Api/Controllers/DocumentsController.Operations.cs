using ChatApp.Domain.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Controllers;

public sealed partial class DocumentsController
{
    [HttpGet("search")]
    public async Task<IActionResult> Search([FromQuery] string username,
        [FromQuery] string query, CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null) return NotFound();
        var term = query?.Trim();
        if (string.IsNullOrEmpty(term) || term.Length > 100)
            return BadRequest(new { message = "Enter a search term of 1–100 characters." });
        var ownerIds = await db.DocumentShares.AsNoTracking()
            .Where(x => x.GranteeUserId == actor.Id && x.OwnerUser.Status == "active")
            .Select(x => x.OwnerUserId).Distinct().ToListAsync(cancellationToken);
        ownerIds.Add(actor.Id);
        var normalized = term.ToUpperInvariant();
        var folderCandidates = await db.DocumentFolders.AsNoTracking().Include(x => x.OwnerUser)
            .Where(x => ownerIds.Contains(x.OwnerUserId) && x.DeletedAt == null &&
                x.NormalizedName.Contains(normalized))
            .OrderByDescending(x => x.UpdatedAt).ToListAsync(cancellationToken);
        var fileCandidates = await db.StoredDocuments.AsNoTracking().Include(x => x.OwnerUser)
            .Where(x => ownerIds.Contains(x.OwnerUserId) && x.DeletedAt == null &&
                x.NormalizedName.Contains(normalized))
            .OrderByDescending(x => x.UpdatedAt).ToListAsync(cancellationToken);
        var folders = new List<DocumentFolderDto>();
        var files = new List<StoredDocumentDto>();
        var locations = new Dictionary<Guid, string>();
        foreach (var folder in folderCandidates)
        {
            var permission = await FolderPermission(folder, actor.Id, cancellationToken);
            if (permission is null) continue;
            folders.Add(ToDto(folder, permission,
                folder.OwnerUserId == actor.Id ? null : folder.OwnerUser.Username));
            locations[folder.Id] = await FolderLocation(folder.ParentFolderId, actor.Id,
                folder.OwnerUserId, cancellationToken);
        }
        foreach (var file in fileCandidates)
        {
            var permission = await FilePermission(file, actor.Id, cancellationToken);
            if (permission is null) continue;
            files.Add(ToDto(file, permission,
                file.OwnerUserId == actor.Id ? null : file.OwnerUser.Username));
            locations[file.Id] = await FolderLocation(file.FolderId, actor.Id,
                file.OwnerUserId, cancellationToken);
        }
        return Ok(new DocumentListingDto(null, [], folders, files) { Locations = locations });
    }

    [HttpPost("bulk")]
    public async Task<IActionResult> Bulk([FromQuery] string username,
        DocumentBulkRequest request, CancellationToken cancellationToken)
    {
        var actor = await FindOwner(username, cancellationToken);
        if (actor is null) return NotFound();
        if (request.Action is not ("move" or "copy" or "trash") ||
            request.Items is null or { Count: < 1 or > 100 } ||
            request.Items.Any(x => x.Kind is not ("file" or "folder")) ||
            request.Items.Select(x => (x.Kind, x.Id)).Distinct().Count() != request.Items.Count)
            return BadRequest(new { message = "Select 1–100 distinct files or folders and a valid action." });
        if (request.Action == "trash" && request.DestinationFolderId is not null)
            return BadRequest(new { message = "Trash does not use a destination folder." });

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await LockLibrary(actor.Id, cancellationToken);
        if (request.Action != "trash" && !await FolderExists(actor.Id,
                request.DestinationFolderId, cancellationToken))
            return NotFound(new { message = "The destination folder was not found." });

        var folderIds = request.Items.Where(x => x.Kind == "folder").Select(x => x.Id).ToArray();
        var fileIds = request.Items.Where(x => x.Kind == "file").Select(x => x.Id).ToArray();
        var selectedFolders = await db.DocumentFolders.Where(x =>
            x.OwnerUserId == actor.Id && x.DeletedAt == null && folderIds.Contains(x.Id))
            .ToListAsync(cancellationToken);
        var selectedFiles = await db.StoredDocuments.Where(x =>
            x.OwnerUserId == actor.Id && x.DeletedAt == null && fileIds.Contains(x.Id))
            .ToListAsync(cancellationToken);
        if (selectedFolders.Count != folderIds.Length || selectedFiles.Count != fileIds.Length)
            return NotFound(new { message = "One or more selected items are unavailable." });
        foreach (var folder in selectedFolders)
            if (await FolderPermission(folder, actor.Id, cancellationToken) != "owner") return NotFound();
        foreach (var file in selectedFiles)
            if (await FilePermission(file, actor.Id, cancellationToken) != "owner") return NotFound();

        var allFolders = await db.DocumentFolders.AsNoTracking().Where(x =>
            x.OwnerUserId == actor.Id && x.DeletedAt == null).ToListAsync(cancellationToken);
        var byId = allFolders.ToDictionary(x => x.Id);
        selectedFolders = selectedFolders.Where(x => !HasSelectedAncestor(x.ParentFolderId,
            folderIds, byId)).ToList();
        selectedFiles = selectedFiles.Where(x => !HasSelectedAncestor(x.FolderId,
            folderIds, byId)).ToList();
        var selectedCount = selectedFolders.Count + selectedFiles.Count;

        if (request.Action == "trash")
        {
            var now = DateTimeOffset.UtcNow;
            foreach (var folder in selectedFolders) folder.DeletedAt = folder.UpdatedAt = now;
            foreach (var file in selectedFiles) file.DeletedAt = file.UpdatedAt = now;
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return Ok(new { count = selectedCount });
        }

        var destination = request.DestinationFolderId;
        if (selectedFolders.Any(x => IsAncestorOrSelf(x.Id, destination, byId)))
            return Conflict(new { message = "A folder cannot be placed inside itself." });
        var isMove = request.Action == "move";
        var folderNames = await db.DocumentFolders.AsNoTracking().Where(x =>
            x.OwnerUserId == actor.Id && x.ParentFolderId == destination && x.DeletedAt == null &&
            (!isMove || !folderIds.Contains(x.Id))).Select(x => x.NormalizedName).ToListAsync(cancellationToken);
        var fileNames = await db.StoredDocuments.AsNoTracking().Where(x =>
            x.OwnerUserId == actor.Id && x.FolderId == destination && x.DeletedAt == null &&
            (!isMove || !fileIds.Contains(x.Id))).Select(x => x.NormalizedName).ToListAsync(cancellationToken);
        var usedFolderNames = folderNames.ToHashSet(StringComparer.Ordinal);
        var usedFileNames = fileNames.ToHashSet(StringComparer.Ordinal);

        if (request.Action == "move")
        {
            if (selectedFolders.Any(x => !usedFolderNames.Add(x.NormalizedName)) ||
                selectedFiles.Any(x => !usedFileNames.Add(x.NormalizedName)))
                return Conflict(new { message = "An item with the same name already exists in the destination." });
            var now = DateTimeOffset.UtcNow;
            foreach (var folder in selectedFolders) { folder.ParentFolderId = destination; folder.UpdatedAt = now; }
            foreach (var file in selectedFiles) { file.FolderId = destination; file.UpdatedAt = now; }
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return Ok(new { count = selectedCount });
        }

        var children = allFolders.Where(x => x.ParentFolderId != null)
            .GroupBy(x => x.ParentFolderId!.Value)
            .ToDictionary(x => x.Key, x => x.ToArray());
        var folderCopies = new List<(DocumentFolder Source, Guid? Destination, bool TopLevel)>();
        foreach (var root in selectedFolders)
        {
            var queue = new Queue<(DocumentFolder Source, Guid? Destination, bool TopLevel)>();
            queue.Enqueue((root, destination, true));
            while (queue.Count > 0)
            {
                var current = queue.Dequeue();
                folderCopies.Add(current);
                if (children.TryGetValue(current.Source.Id, out var nested))
                    foreach (var child in nested) queue.Enqueue((child, current.Source.Id, false));
            }
        }
        var includedFolderIds = folderCopies.Select(x => x.Source.Id).ToArray();
        var descendantFiles = await db.StoredDocuments.AsNoTracking().Where(x =>
            x.OwnerUserId == actor.Id && x.DeletedAt == null && x.FolderId != null &&
            includedFolderIds.Contains(x.FolderId.Value)).ToListAsync(cancellationToken);
        var filesToCopy = selectedFiles.Concat(descendantFiles).DistinctBy(x => x.Id).ToArray();
        var copyBytes = filesToCopy.Sum(x => x.SizeBytes);
        var reservedBytes = await db.DocumentUploadSessions.Where(x => x.OwnerUserId == actor.Id &&
            x.CompletedAt == null && x.ExpiresAt > DateTimeOffset.UtcNow)
            .SumAsync(x => (long?)x.SizeBytes, cancellationToken) ?? 0;
        if (await UsedStorage(actor.Id, cancellationToken) + reservedBytes + copyBytes > await StorageLimitBytes(actor.Id, cancellationToken))
            return StatusCode(StatusCodes.Status413PayloadTooLarge,
                new { code = "storage_limit", message = "These copies would exceed your storage limit." });

        var newKeys = new List<string>();
        try
        {
            var copiedFolders = new Dictionary<Guid, DocumentFolder>();
            foreach (var (source, parent, topLevel) in folderCopies)
            {
                var name = topLevel ? AvailableFolderName(source.Name, usedFolderNames) : source.Name;
                var copy = new DocumentFolder
                {
                    OwnerUserId = actor.Id,
                    ParentFolderId = topLevel ? parent : null,
                    ParentFolder = topLevel ? null : copiedFolders[parent!.Value],
                    Name = name,
                    NormalizedName = Normalize(name),
                };
                db.DocumentFolders.Add(copy);
                copiedFolders[source.Id] = copy;
            }
            foreach (var source in filesToCopy)
            {
                var topLevel = selectedFiles.Any(x => x.Id == source.Id);
                var name = topLevel
                    ? source.FolderId == destination
                        ? AvailableFileCopyName(source.Name, usedFileNames)
                        : AvailableFileName(source.Name, usedFileNames)
                    : source.Name;
                var key = $"documents/{actor.Id:N}/{Guid.NewGuid():N}";
                await using var content = await storage.OpenReadAsync(source.StorageKey, cancellationToken);
                if (content is null) throw new IOException("A source file is unavailable.");
                await storage.WriteAsync(key, content, cancellationToken);
                newKeys.Add(key);
                db.StoredDocuments.Add(new StoredDocument
                {
                    OwnerUserId = actor.Id,
                    FolderId = topLevel ? destination : null,
                    Folder = topLevel ? null : copiedFolders[source.FolderId!.Value],
                    Name = name,
                    NormalizedName = Normalize(name),
                    StorageKey = key,
                    ContentType = source.ContentType,
                    SizeBytes = source.SizeBytes,
                    CurrentVersionCreatedAt = DateTimeOffset.UtcNow,
                });
            }
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return Ok(new { count = selectedCount });
        }
        catch
        {
            await DeleteObjects(newKeys);
            throw;
        }
    }

    private static bool HasSelectedAncestor(Guid? parentId, Guid[] selectedFolderIds,
        Dictionary<Guid, DocumentFolder> folders)
    {
        var visited = new HashSet<Guid>();
        while (parentId is Guid id && visited.Add(id) && folders.TryGetValue(id, out var parent))
        {
            if (selectedFolderIds.Contains(id)) return true;
            parentId = parent.ParentFolderId;
        }
        return false;
    }

    private static bool IsAncestorOrSelf(Guid folderId, Guid? descendantId,
        Dictionary<Guid, DocumentFolder> folders)
    {
        var visited = new HashSet<Guid>();
        while (descendantId is Guid id && visited.Add(id) && folders.TryGetValue(id, out var folder))
        {
            if (id == folderId) return true;
            descendantId = folder.ParentFolderId;
        }
        return false;
    }

    private static string AvailableFolderName(string original, HashSet<string> used)
    {
        if (used.Add(Normalize(original))) return original;
        for (var number = 2; number <= 10000; number++)
        {
            var suffix = $" ({number})";
            var candidate = $"{original[..Math.Min(original.Length, 255 - suffix.Length)]}{suffix}";
            if (used.Add(Normalize(candidate))) return candidate;
        }
        throw new InvalidOperationException("No available folder name was found.");
    }

    private static string AvailableFileName(string original, HashSet<string> used)
    {
        if (used.Add(Normalize(original))) return original;
        var extension = Path.GetExtension(original);
        var stem = original[..^extension.Length];
        for (var number = 2; number <= 10000; number++)
        {
            var suffix = $" ({number})";
            var candidate = $"{stem[..Math.Min(stem.Length, 255 - suffix.Length - extension.Length)]}{suffix}{extension}";
            if (used.Add(Normalize(candidate))) return candidate;
        }
        throw new InvalidOperationException("No available file name was found.");
    }

    private static string AvailableFileCopyName(string original, HashSet<string> used)
    {
        var extension = Path.GetExtension(original);
        var stem = original[..^extension.Length];
        for (var number = 1; number <= 10000; number++)
        {
            var suffix = number == 1 ? " - Copy" : $" - Copy ({number})";
            var copyExtension = extension.Length + suffix.Length >= 255 ? "" : extension;
            var copyStem = copyExtension.Length == 0 ? original : stem;
            var candidate = $"{copyStem[..Math.Min(copyStem.Length, 255 - suffix.Length - copyExtension.Length)]}{suffix}{copyExtension}";
            if (used.Add(Normalize(candidate))) return candidate;
        }
        throw new InvalidOperationException("No available file copy name was found.");
    }
}

public sealed record DocumentSelection(string Kind, Guid Id);
public sealed record DocumentBulkRequest(string Action, IReadOnlyList<DocumentSelection> Items,
    Guid? DestinationFolderId);
