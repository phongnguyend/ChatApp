namespace ChatApp.Application.Models;

public sealed class UserBlock
{
    public Guid BlockerUserId { get; set; }
    public required ChatUser BlockerUser { get; set; }
    public Guid BlockedUserId { get; set; }
    public required ChatUser BlockedUser { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
