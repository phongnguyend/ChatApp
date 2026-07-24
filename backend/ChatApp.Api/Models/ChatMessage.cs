namespace ChatApp.Api.Models;

public sealed class ChatMessage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ConversationId { get; set; }
    public required Conversation Conversation { get; set; }
    public Guid? SenderUserId { get; set; }
    public ChatUser? Sender { get; set; }
    public Guid? ReplyToMessageId { get; set; }
    public ChatMessage? ReplyToMessage { get; set; }
    public string MessageType { get; set; } = "text";
    public string? Content { get; set; }
    public string? ClientMessageId { get; set; }
    public long SequenceNumber { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? EditedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
    public ICollection<MessageAttachment> Attachments { get; set; } = [];
    public ICollection<MessageReaction> Reactions { get; set; } = [];
    public ICollection<MessageReceipt> Receipts { get; set; } = [];
}
