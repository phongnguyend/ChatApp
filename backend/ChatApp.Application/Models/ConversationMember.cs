namespace ChatApp.Application.Models;

public sealed class ConversationMember
{
    public Guid ConversationId { get; set; }
    public required Conversation Conversation { get; set; }
    public Guid UserId { get; set; }
    public required ChatUser User { get; set; }
    public string Role { get; set; } = "member";
    public DateTimeOffset JoinedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? LeftAt { get; set; }
    public Guid? LastReadMessageId { get; set; }
    public ChatMessage? LastReadMessage { get; set; }
    public DateTimeOffset? LastReadAt { get; set; }
    public long LastReadSequence { get; set; }
    public int UnreadCount { get; set; }
    public DateTimeOffset? MutedUntil { get; set; }
    public bool IsArchived { get; set; }
}
