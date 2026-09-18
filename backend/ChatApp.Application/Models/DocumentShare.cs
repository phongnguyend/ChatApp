namespace ChatApp.Application.Models;

public sealed class DocumentShare
{
    public Guid Id { get; set; }
    public Guid OwnerUserId { get; set; }
    public ChatUser OwnerUser { get; set; } = null!;
    public Guid GranteeUserId { get; set; }
    public ChatUser GranteeUser { get; set; } = null!;
    public Guid? FolderId { get; set; }
    public DocumentFolder? Folder { get; set; }
    public Guid? FileId { get; set; }
    public StoredDocument? File { get; set; }
    public required string Permission { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
