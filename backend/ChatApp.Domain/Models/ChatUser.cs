using Microsoft.AspNetCore.Identity;

namespace ChatApp.Domain.Models;

public sealed class ChatUser : IdentityUser<Guid>
{
    [System.Diagnostics.CodeAnalysis.AllowNull]
    public override string UserName { get; set => field = value ?? string.Empty; } = string.Empty;
    [System.Diagnostics.CodeAnalysis.AllowNull]
    public override string NormalizedUserName { get; set => field = value ?? string.Empty; } = string.Empty;
    public string DisplayName => string.IsNullOrWhiteSpace((FirstName ?? "") + (LastName ?? "")) ? UserName : ((FirstName ?? "") + " " + (LastName ?? "")).Trim();
    public bool IsEnabled { get; set; } = true;
    public bool AllowPasswordAuthentication { get; set; }
    public string? FirstName { get; set; }
    public string? LastName { get; set; }
    public string? AvatarUrl { get; set; }
    public string Status { get; set; } = "active";
    public long? DocumentStorageLimitBytes { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? LastSeenAt { get; set; }
    public ICollection<ChatMessage> Messages { get; set; } = [];
    public ICollection<ConversationMember> ConversationMemberships { get; set; } = [];
}
