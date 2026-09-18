namespace ChatApp.Application.Models;

public sealed class UserReminder
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public ChatUser User { get; set; } = null!;
    public required string Title { get; set; }
    public string? Description { get; set; }
    public DateOnly ReminderDate { get; set; }
    public TimeOnly? ReminderTime { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
