namespace ChatApp.Application.Models;

public sealed class DocumentFolder
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OwnerUserId { get; set; }
    public ChatUser OwnerUser { get; set; } = null!;
    public Guid? ParentFolderId { get; set; }
    public DocumentFolder? ParentFolder { get; set; }
    public required string Name { get; set; }
    public required string NormalizedName { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? DeletedAt { get; set; }
}
