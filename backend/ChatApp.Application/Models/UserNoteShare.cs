namespace ChatApp.Application.Models;

public sealed class UserNoteShare
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid NoteId { get; set; }
    public UserNote Note { get; set; } = null!;
    public Guid GranteeUserId { get; set; }
    public ChatUser GranteeUser { get; set; } = null!;
    public required string Permission { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
