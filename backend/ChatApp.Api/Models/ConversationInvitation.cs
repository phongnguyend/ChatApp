namespace ChatApp.Api.Models;

public sealed class ConversationInvitation
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ConversationId { get; set; }
    public required Conversation Conversation { get; set; }
    public Guid InvitedUserId { get; set; }
    public required ChatUser InvitedUser { get; set; }
    public Guid InvitedByUserId { get; set; }
    public required ChatUser InvitedByUser { get; set; }
    public string Status { get; set; } = "pending";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? RespondedAt { get; set; }
}
