namespace ChatApp.Domain.Models;

public sealed class UserNote
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public ChatUser User { get; set; } = null!;
    public required string Title { get; set; }
    public string Content { get; set; } = "";
    public bool IsPinned { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public ICollection<UserNoteShare> Shares { get; set; } = [];
}
