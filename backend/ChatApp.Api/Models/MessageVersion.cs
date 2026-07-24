namespace ChatApp.Api.Models;

public sealed class MessageVersion
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid MessageId { get; set; }
    public required ChatMessage Message { get; set; }
    public string? Content { get; set; }
    public Guid? EditedBy { get; set; }
    public ChatUser? Editor { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
