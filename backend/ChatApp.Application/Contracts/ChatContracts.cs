namespace ChatApp.Application.Contracts;

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
    bool IsMuted = false,
    Guid? DirectUserId = null,
    string? DirectUsername = null);

public sealed record CreateConversationRequest(
    string Title,
    IReadOnlyList<string>? Usernames);

public sealed record CreateLiveStreamRequest(string Title);

public sealed record LiveStreamSessionPresenceRequest(Guid SessionId);

public sealed record LiveStreamDto(
    Guid ConversationId,
    string Title,
    Guid HostUserId,
    string HostDisplayName,
    string? HostAvatarUrl,
    bool IsHost,
    bool IsJoined,
    Guid? SessionId,
    string? ProviderCallId,
    DateTimeOffset? StartedAt,
    DateTimeOffset? EndedAt,
    int MemberCount,
    bool IsActive,
    string? HostCommunicationUserId = null);

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
    int? Height,
    long? DurationMs);

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
    IReadOnlyList<MessageReactionDto>? Reactions = null,
    decimal? LocationLatitude = null,
    decimal? LocationLongitude = null,
    LiveLocationDto? LiveLocation = null);

public sealed record LiveLocationDto(
    Guid MessageId,
    Guid ConversationId,
    Guid UserId,
    decimal Latitude,
    decimal Longitude,
    decimal? AccuracyMeters,
    DateTimeOffset StartedAt,
    DateTimeOffset UpdatedAt,
    DateTimeOffset ExpiresAt,
    DateTimeOffset? StoppedAt,
    bool IsActive);

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
    string? Content,
    string ClientMessageId,
    Guid? ReplyToMessageId = null,
    string MessageType = "text",
    decimal? LocationLatitude = null,
    decimal? LocationLongitude = null);

public sealed record StartLiveLocationRequest(
    Guid ConversationId,
    string ClientMessageId,
    decimal Latitude,
    decimal Longitude,
    decimal? AccuracyMeters,
    int DurationMinutes = 60,
    Guid? ReplyToMessageId = null);

public sealed record UpdateLiveLocationRequest(
    Guid MessageId,
    decimal Latitude,
    decimal Longitude,
    decimal? AccuracyMeters);

public sealed record LiveLocationStoppedDto(
    Guid MessageId,
    Guid ConversationId,
    DateTimeOffset StoppedAt);

public sealed record TypingDto(Guid ConversationId, string Username, bool IsTyping);

public sealed record StartCallRequest(
    Guid CallId,
    Guid ConversationId,
    Guid TargetUserId,
    bool HasVideo);

public sealed record RespondToCallRequest(
    Guid CallId,
    Guid ConversationId,
    Guid InitiatorUserId,
    bool Accepted);

public sealed record EndCallRequest(
    Guid CallId,
    Guid ConversationId,
    Guid TargetUserId,
    string Reason);

public sealed record IncomingCallDto(
    Guid CallId,
    Guid ConversationId,
    Guid InitiatorUserId,
    string InitiatorUsername,
    string InitiatorDisplayName,
    string? InitiatorAvatarUrl,
    bool HasVideo);

public sealed record CallResponseDto(
    Guid CallId,
    Guid ConversationId,
    Guid UserId,
    string DisplayName,
    bool Accepted);

public sealed record CallEndedDto(
    Guid CallId,
    Guid ConversationId,
    Guid UserId,
    string Reason);

public sealed record CallScreenShareRequest(
    Guid CallId,
    Guid ConversationId,
    Guid TargetUserId);

public sealed record CallScreenShareChangedDto(
    Guid CallId,
    Guid ConversationId,
    Guid UserId,
    bool IsSharing);

public sealed record CallScreenShareTakenOverDto(
    Guid CallId,
    Guid ConversationId,
    Guid NewOwnerUserId);

public sealed record CallMicrophoneStateRequest(
    Guid CallId,
    Guid ConversationId,
    Guid TargetUserId,
    bool IsMuted);

public sealed record CallMicrophoneStateDto(
    Guid CallId,
    Guid ConversationId,
    Guid UserId,
    bool IsMuted);

public sealed record GroupMeetingParticipantDto(
    Guid UserId,
    string DisplayName,
    string? AvatarUrl,
    DateTimeOffset JoinedAt,
    bool IsMuted);

public sealed record GroupMeetingDto(
    Guid MeetingId,
    Guid ConversationId,
    Guid StartedByUserId,
    string StartedByDisplayName,
    DateTimeOffset StartedAt,
    Guid? ScreenSharingUserId,
    IReadOnlyList<GroupMeetingParticipantDto> Participants);

public sealed record GroupMeetingChangedDto(
    Guid ConversationId,
    GroupMeetingDto? Meeting);

public sealed record GroupMeetingMicrophoneStateRequest(
    Guid MeetingId,
    Guid ConversationId,
    bool IsMuted);

public sealed record GroupMeetingScreenShareRequest(
    Guid MeetingId,
    Guid ConversationId);

public sealed record GroupMeetingScreenShareTakenOverDto(
    Guid MeetingId,
    Guid ConversationId,
    Guid NewOwnerUserId);

public sealed record CreateRecordingRequest(
    Guid ConversationId,
    Guid SessionId,
    string SessionType);

public sealed record RecordingConsentResponseRequest(
    Guid RecordingId,
    bool Accepted);

public sealed record RecordingStateDto(
    Guid RecordingId,
    Guid ConversationId,
    Guid SessionId,
    Guid StartedByUserId,
    string StartedByDisplayName,
    DateTimeOffset StartedAt,
    string Status);

public sealed record SessionRecordingListItemDto(
    Guid Id,
    Guid ConversationId,
    Guid SessionId,
    Guid StartedByUserId,
    string StartedByDisplayName,
    string? StartedByAvatarUrl,
    string SessionType,
    string Provider,
    string Status,
    DateTimeOffset StartedAt,
    DateTimeOffset? CompletedAt,
    long? DurationMilliseconds,
    MessageAttachmentDto? Attachment,
    bool CanCheckProviderStatus);

public sealed record RecordingProviderStatusDto(
    Guid RecordingId,
    string Status,
    string ProviderStatus,
    DateTimeOffset CheckedAt);

public sealed record RecordingConsentRequestedDto(
    RecordingStateDto Recording,
    bool IsNewParticipant);

public sealed record ActiveRecordingDto(
    RecordingStateDto Recording,
    bool RequiresConsent);

public sealed record RecordingCompletedNotificationRequest(Guid RecordingId);
