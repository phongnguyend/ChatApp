namespace ChatApp.Domain.Models;

public sealed class DocumentUploadSession
{
    public Guid Id { get; set; }
    public Guid ActorUserId { get; set; }
    public Guid OwnerUserId { get; set; }
    public Guid? FolderId { get; set; }
    public Guid? ReplaceFileId { get; set; }
    public required string Name { get; set; }
    public required string NormalizedName { get; set; }
    public required string ContentType { get; set; }
    public required string Fingerprint { get; set; }
    public long SizeBytes { get; set; }
    public int ChunkSize { get; set; }
    public int ChunkCount { get; set; }
    public Guid? CompletedFileId { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public ICollection<DocumentUploadChunk> Chunks { get; set; } = [];
}
