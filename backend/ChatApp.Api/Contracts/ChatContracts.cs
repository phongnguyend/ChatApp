namespace ChatApp.Api.Contracts;

public sealed record LoginRequest(string Username);

public sealed record UserDto(
    Guid Id,
    string Username,
    string DisplayName,
    string? AvatarUrl);

public sealed record ConversationDto(
    Guid Id,
    string Type,
    string? Title,
    string? AvatarUrl,
    string? LastMessage,
    Guid? LastMessageSenderUserId,
    string? LastMessageSenderName,
    DateTimeOffset? LastMessageAt,
    int UnreadCount,
    int MemberCount,
    bool IsMuted = false);

public sealed record CreateConversationRequest(
    string Title,
    IReadOnlyList<string>? Usernames);

public sealed record CreateDirectConversationRequest(string Username);

public sealed record AddConversationMembersRequest(IReadOnlyList<string>? Usernames);

public sealed record UpdateConversationMemberRoleRequest(string Role);

public sealed record UpdateConversationMuteRequest(bool IsMuted);

public sealed record ConversationMuteChangedDto(
    Guid ConversationId,
    bool IsMuted);

public sealed record UpdateConversationTitleRequest(string Title);

public sealed record ConversationRenamedDto(Guid ConversationId, string Title);

public sealed record ConversationRemovedDto(Guid ConversationId);

public sealed record UserAvatarUpdatedDto(Guid UserId, string AvatarUrl);

public sealed record UpdateDisplayNameRequest(string DisplayName);

public sealed record UserDisplayNameUpdatedDto(Guid UserId, string DisplayName);

public sealed record UserBlockChangedDto(string Username, bool IsBlocked);

public sealed record ConversationAvatarUpdatedDto(
    Guid ConversationId,
    string AvatarUrl);

public sealed record ConversationMemberDto(
    Guid Id,
    string Username,
    string DisplayName,
    string? AvatarUrl,
    string Role,
    bool IsOnline);

public sealed record MembersChangedDto(Guid ConversationId, int MemberCount);

public sealed record MessageAttachmentDto(
    Guid Id,
    string FileName,
    string ContentType,
    long FileSize,
    int? Width,
    int? Height);

public sealed record MessageReactionDto(
    string Reaction,
    int Count,
    bool IsOwn,
    IReadOnlyList<MessageReactionUserDto> Users);

public sealed record MessageReactionUserDto(
    Guid Id,
    string DisplayName,
    string? AvatarUrl);

public sealed record MessageDto(
    Guid Id,
    Guid ConversationId,
    Guid? SenderUserId,
    string? Username,
    string? SenderAvatarUrl,
    string? Content,
    string MessageType,
    string? ClientMessageId,
    long SequenceNumber,
    Guid? ReplyToMessageId,
    DateTimeOffset CreatedAt,
    DateTimeOffset? EditedAt,
    DateTimeOffset? DeletedAt,
    IReadOnlyList<MessageAttachmentDto>? Attachments = null,
    IReadOnlyList<MessageReactionDto>? Reactions = null);

public sealed record UpdateMessageRequest(string Content);

public sealed record ToggleMessageReactionRequest(string Reaction);

public sealed record MessageChangedDto(
    Guid MessageId,
    Guid ConversationId,
    string? Content,
    DateTimeOffset? EditedAt,
    DateTimeOffset? DeletedAt);

public sealed record MessageReactionChangedDto(
    Guid MessageId,
    Guid ConversationId,
    Guid UserId,
    string DisplayName,
    string? AvatarUrl,
    string Reaction,
    bool IsAdded);

public sealed record SendMessageRequest(
    Guid ConversationId,
    string Content,
    string ClientMessageId,
    Guid? ReplyToMessageId = null,
    string MessageType = "text");

public sealed record TypingDto(Guid ConversationId, string Username, bool IsTyping);
