namespace ChatApp.Application.Models;

public sealed class UserNotification
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public ChatUser User { get; set; } = null!;
    public Guid ActorUserId { get; set; }
    public ChatUser ActorUser { get; set; } = null!;
    public required string Type { get; set; }
    public Guid TargetId { get; set; }
    public required string TargetTitle { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? ReadAt { get; set; }
}
