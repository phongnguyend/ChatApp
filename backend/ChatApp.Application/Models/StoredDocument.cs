namespace ChatApp.Application.Models;

public sealed class StoredDocument
{
    public Guid Id { get; set; }
    public Guid OwnerUserId { get; set; }
    public ChatUser OwnerUser { get; set; } = null!;
    public Guid? FolderId { get; set; }
    public DocumentFolder? Folder { get; set; }
    public required string Name { get; set; }
    public required string NormalizedName { get; set; }
    public required string StorageKey { get; set; }
    public required string ContentType { get; set; }
    public long SizeBytes { get; set; }
    public int CurrentVersionNumber { get; set; } = 1;
    public DateTimeOffset? CurrentVersionCreatedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? DeletedAt { get; set; }
}
