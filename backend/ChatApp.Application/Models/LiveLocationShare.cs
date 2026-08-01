namespace ChatApp.Application.Models;

public sealed class LiveLocationShare
{
    public Guid MessageId { get; set; }
    public required ChatMessage Message { get; set; }
    public Guid ConversationId { get; set; }
    public required Conversation Conversation { get; set; }
    public Guid UserId { get; set; }
    public required ChatUser User { get; set; }
    public decimal Latitude { get; set; }
    public decimal Longitude { get; set; }
    public decimal? AccuracyMeters { get; set; }
    public DateTimeOffset StartedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? StoppedAt { get; set; }
    public bool IsActive { get; set; } = true;
}
