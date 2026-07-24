namespace ChatApp.Api.Models;

public sealed class MessageReceipt
{
    public Guid MessageId { get; set; }
    public required ChatMessage Message { get; set; }
    public Guid UserId { get; set; }
    public required ChatUser User { get; set; }
    public DateTimeOffset? DeliveredAt { get; set; }
    public DateTimeOffset? ReadAt { get; set; }
}
