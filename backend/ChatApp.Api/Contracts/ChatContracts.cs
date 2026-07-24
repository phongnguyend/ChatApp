namespace ChatApp.Api.Contracts;

public sealed record LoginRequest(string Username);

public sealed record UserDto(Guid Id, string Username, string DisplayName);

public sealed record ConversationDto(
    Guid Id,
    string Type,
    string? Title,
    string? LastMessage,
    Guid? LastMessageSenderUserId,
    string? LastMessageSenderName,
    DateTimeOffset? LastMessageAt,
    int UnreadCount,
    int MemberCount);

public sealed record CreateConversationRequest(
    string Title,
    IReadOnlyList<string>? Usernames);

public sealed record CreateDirectConversationRequest(string Username);

public sealed record AddConversationMembersRequest(IReadOnlyList<string>? Usernames);

public sealed record UpdateConversationTitleRequest(string Title);

public sealed record ConversationRenamedDto(Guid ConversationId, string Title);

public sealed record ConversationRemovedDto(Guid ConversationId);

public sealed record ConversationMemberDto(
    Guid Id,
    string Username,
    string DisplayName,
    string Role,
    bool IsOnline);

public sealed record MembersChangedDto(Guid ConversationId, int MemberCount);

public sealed record MessageDto(
    Guid Id,
    Guid ConversationId,
    Guid? SenderUserId,
    string? Username,
    string? Content,
    string MessageType,
    string? ClientMessageId,
    long SequenceNumber,
    Guid? ReplyToMessageId,
    DateTimeOffset CreatedAt,
    DateTimeOffset? EditedAt,
    DateTimeOffset? DeletedAt);

public sealed record SendMessageRequest(
    Guid ConversationId,
    string Content,
    string ClientMessageId,
    Guid? ReplyToMessageId = null);

public sealed record TypingDto(Guid ConversationId, string Username, bool IsTyping);
