namespace ChatApp.Api.Services;

public sealed class GroupMeetingStateTracker
{
    private readonly object _gate = new();
    private readonly Dictionary<Guid, MeetingSession> _meetings = [];

    public MeetingStartChange Start(
        Guid conversationId,
        Guid userId,
        string displayName,
        string? avatarUrl)
    {
        lock (_gate)
        {
            if (_meetings.TryGetValue(conversationId, out var existing))
            {
                return new MeetingStartChange(Snapshot(existing), false);
            }

            var now = DateTimeOffset.UtcNow;
            var meeting = new MeetingSession(
                Guid.NewGuid(),
                conversationId,
                userId,
                displayName,
                now);
            meeting.Participants[userId] =
                new MeetingParticipant(userId, displayName, avatarUrl, now);
            _meetings[conversationId] = meeting;
            return new MeetingStartChange(Snapshot(meeting), true);
        }
    }

    public MeetingSnapshot? Get(Guid conversationId)
    {
        lock (_gate)
        {
            return _meetings.TryGetValue(conversationId, out var meeting)
                ? Snapshot(meeting)
                : null;
        }
    }

    public bool HasParticipant(
        Guid conversationId,
        Guid meetingId,
        Guid userId)
    {
        lock (_gate)
        {
            return _meetings.TryGetValue(conversationId, out var meeting) &&
                meeting.MeetingId == meetingId &&
                meeting.Participants.ContainsKey(userId);
        }
    }

    public MeetingParticipantChange Join(
        Guid conversationId,
        Guid userId,
        string displayName,
        string? avatarUrl)
    {
        lock (_gate)
        {
            if (!_meetings.TryGetValue(conversationId, out var meeting))
            {
                throw new InvalidOperationException("The meeting has ended.");
            }

            var changed = meeting.Participants.TryAdd(
                userId,
                new MeetingParticipant(
                    userId,
                    displayName,
                    avatarUrl,
                    DateTimeOffset.UtcNow));
            return new MeetingParticipantChange(
                Snapshot(meeting),
                changed,
                false);
        }
    }

    public MeetingParticipantChange Leave(Guid conversationId, Guid userId)
    {
        lock (_gate)
        {
            if (!_meetings.TryGetValue(conversationId, out var meeting))
            {
                return new MeetingParticipantChange(null, false, false);
            }

            var changed = meeting.Participants.Remove(userId);
            if (!changed)
            {
                return new MeetingParticipantChange(
                    Snapshot(meeting),
                    false,
                    false);
            }
            if (meeting.ScreenSharingUserId == userId)
            {
                meeting.ScreenSharingUserId = null;
            }
            if (meeting.Participants.Count == 0)
            {
                _meetings.Remove(conversationId);
                return new MeetingParticipantChange(null, true, true);
            }
            return new MeetingParticipantChange(
                Snapshot(meeting),
                true,
                false);
        }
    }

    public MeetingSnapshot SetMicrophoneState(
        Guid conversationId,
        Guid meetingId,
        Guid userId,
        bool isMuted)
    {
        lock (_gate)
        {
            if (!_meetings.TryGetValue(conversationId, out var meeting) ||
                meeting.MeetingId != meetingId ||
                !meeting.Participants.TryGetValue(userId, out var participant))
            {
                throw new InvalidOperationException(
                    "You are not in this meeting.");
            }

            meeting.Participants[userId] =
                participant with { IsMuted = isMuted };
            return Snapshot(meeting);
        }
    }

    public ScreenShareChange StartScreenShare(
        Guid conversationId,
        Guid meetingId,
        Guid userId)
    {
        lock (_gate)
        {
            if (!_meetings.TryGetValue(conversationId, out var meeting) ||
                meeting.MeetingId != meetingId ||
                !meeting.Participants.ContainsKey(userId))
            {
                throw new InvalidOperationException(
                    "You are not in this meeting.");
            }

            var previousOwnerUserId = meeting.ScreenSharingUserId;
            meeting.ScreenSharingUserId = userId;
            return new ScreenShareChange(
                previousOwnerUserId == userId ? null : previousOwnerUserId,
                Snapshot(meeting));
        }
    }

    public MeetingSnapshot StopScreenShare(
        Guid conversationId,
        Guid meetingId,
        Guid userId)
    {
        lock (_gate)
        {
            if (!_meetings.TryGetValue(conversationId, out var meeting) ||
                meeting.MeetingId != meetingId)
            {
                throw new InvalidOperationException("The meeting has ended.");
            }
            if (meeting.ScreenSharingUserId == userId)
            {
                meeting.ScreenSharingUserId = null;
            }
            return Snapshot(meeting);
        }
    }

    public bool Stop(Guid conversationId, Guid userId)
    {
        lock (_gate)
        {
            if (!_meetings.TryGetValue(conversationId, out var meeting))
            {
                return false;
            }
            if (meeting.StartedByUserId != userId)
            {
                throw new InvalidOperationException(
                    "Only the meeting starter can stop this meeting.");
            }

            return _meetings.Remove(conversationId);
        }
    }

    public IReadOnlyList<MeetingChange> Disconnect(Guid userId)
    {
        lock (_gate)
        {
            var changes = new List<MeetingChange>();
            foreach (var meeting in _meetings.Values.ToArray())
            {
                if (meeting.Participants.Remove(userId))
                {
                    if (meeting.ScreenSharingUserId == userId)
                    {
                        meeting.ScreenSharingUserId = null;
                    }
                    if (meeting.Participants.Count == 0)
                    {
                        _meetings.Remove(meeting.ConversationId);
                        changes.Add(
                            new MeetingChange(
                                meeting.ConversationId,
                                null,
                                true));
                        continue;
                    }
                    changes.Add(
                        new MeetingChange(
                            meeting.ConversationId,
                            Snapshot(meeting),
                            false));
                }
            }
            return changes;
        }
    }

    private static MeetingSnapshot Snapshot(MeetingSession meeting) =>
        new(
            meeting.MeetingId,
            meeting.ConversationId,
            meeting.StartedByUserId,
            meeting.StartedByDisplayName,
            meeting.StartedAt,
            meeting.ScreenSharingUserId,
            meeting.Participants.Values
                .OrderBy(participant => participant.JoinedAt)
                .ToArray());

    private sealed class MeetingSession(
        Guid meetingId,
        Guid conversationId,
        Guid startedByUserId,
        string startedByDisplayName,
        DateTimeOffset startedAt)
    {
        public Guid MeetingId { get; } = meetingId;
        public Guid ConversationId { get; } = conversationId;
        public Guid StartedByUserId { get; } = startedByUserId;
        public string StartedByDisplayName { get; } = startedByDisplayName;
        public DateTimeOffset StartedAt { get; } = startedAt;
        public Guid? ScreenSharingUserId { get; set; }
        public Dictionary<Guid, MeetingParticipant> Participants { get; } = [];
    }

    public sealed record MeetingParticipant(
        Guid UserId,
        string DisplayName,
        string? AvatarUrl,
        DateTimeOffset JoinedAt,
        bool IsMuted = false);

    public sealed record MeetingSnapshot(
        Guid MeetingId,
        Guid ConversationId,
        Guid StartedByUserId,
        string StartedByDisplayName,
        DateTimeOffset StartedAt,
        Guid? ScreenSharingUserId,
        IReadOnlyList<MeetingParticipant> Participants);

    public sealed record ScreenShareChange(
        Guid? PreviousOwnerUserId,
        MeetingSnapshot Meeting);

    public sealed record MeetingStartChange(
        MeetingSnapshot Meeting,
        bool Created);

    public sealed record MeetingParticipantChange(
        MeetingSnapshot? Meeting,
        bool Changed,
        bool AutoStopped);

    public sealed record MeetingChange(
        Guid ConversationId,
        MeetingSnapshot? Meeting,
        bool AutoStopped);
}
