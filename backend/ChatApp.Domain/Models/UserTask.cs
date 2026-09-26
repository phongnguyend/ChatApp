namespace ChatApp.Domain.Models;

public sealed class UserTask
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public ChatUser User { get; set; } = null!;
    public ICollection<UserTaskShare> Shares { get; set; } = [];
    public Guid? AssigneeUserId { get; set; }
    public ChatUser? AssigneeUser { get; set; }
    public required string Title { get; set; }
    public string? Description { get; set; }
    public DateOnly? DueDate { get; set; }
    public string Priority { get; set; } = "normal";
    public bool IsCompleted { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
