namespace ChatApp.Api.Models;

public sealed class Conversation
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Type { get; set; } = "group";
    public string? Title { get; set; }
    public string? AvatarUrl { get; set; }
    public Guid? CreatedByUserId { get; set; }
    public ChatUser? CreatedByUser { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public Guid? LastMessageId { get; set; }
    public ChatMessage? LastMessage { get; set; }
    public DateTimeOffset? LastMessageAt { get; set; }
    public bool IsArchived { get; set; }
    public ICollection<ConversationMember> Members { get; set; } = [];
    public ICollection<ChatMessage> Messages { get; set; } = [];
}
