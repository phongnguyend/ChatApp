namespace ChatApp.Application.Models;

public sealed class DocumentUploadChunk
{
    public Guid SessionId { get; set; }
    public DocumentUploadSession Session { get; set; } = null!;
    public int Index { get; set; }
    public required string StorageKey { get; set; }
    public required string Sha256 { get; set; }
    public int SizeBytes { get; set; }
}
