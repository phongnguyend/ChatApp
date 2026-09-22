namespace ChatApp.Application.Models;

public sealed class MessagePoll
{
    public Guid MessageId { get; set; }
    public ChatMessage Message { get; set; } = null!;
    public required string Question { get; set; }
    public bool IsMultiple { get; set; }
    public DateTimeOffset? ExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public ICollection<MessagePollOption> Options { get; set; } = [];
    public ICollection<MessagePollVote> Votes { get; set; } = [];
}

public sealed class MessagePollOption
{
    public Guid Id { get; set; }
    public Guid PollMessageId { get; set; }
    public MessagePoll Poll { get; set; } = null!;
    public required string Text { get; set; }
    public int SortOrder { get; set; }
    public ICollection<MessagePollVote> Votes { get; set; } = [];
}

public sealed class MessagePollVote
{
    public Guid PollMessageId { get; set; }
    public MessagePoll Poll { get; set; } = null!;
    public Guid UserId { get; set; }
    public ChatUser User { get; set; } = null!;
    public Guid OptionId { get; set; }
    public MessagePollOption Option { get; set; } = null!;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
