namespace ChatApp.Application.Models;

public sealed class DocumentPublicLink
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OwnerUserId { get; set; }
    public ChatUser OwnerUser { get; set; } = null!;
    public Guid? FolderId { get; set; }
    public DocumentFolder? Folder { get; set; }
    public Guid? FileId { get; set; }
    public StoredDocument? File { get; set; }
    public required string Token { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? ExpiresAt { get; set; }
}
