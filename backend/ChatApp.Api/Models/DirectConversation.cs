namespace ChatApp.Api.Models;

public sealed class DirectConversation
{
    public Guid ConversationId { get; set; }
    public required Conversation Conversation { get; set; }
    public Guid UserLowId { get; set; }
    public required ChatUser UserLow { get; set; }
    public Guid UserHighId { get; set; }
    public required ChatUser UserHigh { get; set; }
}
