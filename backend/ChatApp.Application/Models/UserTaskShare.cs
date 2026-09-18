namespace ChatApp.Application.Models;

public sealed class UserTaskShare
{
    public Guid Id { get; set; }
    public Guid TaskId { get; set; }
    public UserTask Task { get; set; } = null!;
    public Guid GranteeUserId { get; set; }
    public ChatUser GranteeUser { get; set; } = null!;
    public required string Permission { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
