namespace ChatApp.Api.Models;

public sealed class CallingProviderIdentity
{
    public Guid UserId { get; set; }
    public required ChatUser User { get; set; }
    public required string Provider { get; set; }
    public required string ExternalIdentity { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
