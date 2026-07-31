namespace ChatApp.Api.Models;

public sealed class SessionRecordingChunk
{
    public Guid RecordingId { get; set; }
    public required SessionRecording Recording { get; set; }
    public int Sequence { get; set; }
    public required string StorageObjectName { get; set; }
    public long FileSize { get; set; }
    public DateTimeOffset UploadedAt { get; set; } = DateTimeOffset.UtcNow;
}
