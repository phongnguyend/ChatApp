namespace ChatApp.Application.Models;

public sealed class SessionRecording
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ConversationId { get; set; }
    public required Conversation Conversation { get; set; }
    public Guid SessionId { get; set; }
    public Guid StartedByUserId { get; set; }
    public required ChatUser StartedByUser { get; set; }
    public string SessionType { get; set; } = "direct";
    public string Provider { get; set; } = "peer-to-peer";
    public string? ProviderCallLocator { get; set; }
    public string? ProviderRecordingId { get; set; }
    public string? ProviderContentLocationsJson { get; set; }
    public string Status { get; set; } = "requesting-consent";
    public string? StorageObjectName { get; set; }
    public DateTimeOffset StartedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? CompletedAt { get; set; }
    public long? DurationMilliseconds { get; set; }
}
