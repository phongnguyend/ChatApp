namespace ChatApp.Application.Models;

public sealed class MessageReaction
{
    public Guid MessageId { get; set; }
    public required ChatMessage Message { get; set; }
    public Guid UserId { get; set; }
    public required ChatUser User { get; set; }
    public required string Reaction { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
