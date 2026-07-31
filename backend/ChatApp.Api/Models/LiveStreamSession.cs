namespace ChatApp.Api.Models;

public sealed class LiveStreamSession
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ConversationId { get; set; }
    public required Conversation Conversation { get; set; }
    public Guid HostUserId { get; set; }
    public required ChatUser HostUser { get; set; }
    public string Provider { get; set; } = "azure-communication-services";
    public string ProviderCallId { get; set; } = Guid.NewGuid().ToString();
    public DateTimeOffset StartedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? EndedAt { get; set; }
}
