namespace ChatApp.Api.Services;

public sealed class RecordingStateTracker
{
    private readonly Lock _sync = new();
    private readonly Dictionary<Guid, RecordingSession> _recordings = [];
    private readonly Dictionary<Guid, Guid> _recordingBySession = [];

    public RecordingSnapshot Begin(
        Guid recordingId,
        Guid conversationId,
        Guid sessionId,
        string sessionType,
        Guid recorderUserId,
        string recorderDisplayName,
        IReadOnlyCollection<Guid> participantUserIds)
    {
        lock (_sync)
        {
            if (_recordingBySession.ContainsKey(sessionId))
            {
                throw new InvalidOperationException(
                    "A recording is already active for this call.");
            }

            var participants = participantUserIds.ToHashSet();
            if (!participants.Contains(recorderUserId) || participants.Count == 0)
            {
                throw new InvalidOperationException(
                    "The recorder must be an active call participant.");
            }

            var session = new RecordingSession(
                recordingId,
                conversationId,
                sessionId,
                sessionType,
                recorderUserId,
                recorderDisplayName,
                DateTimeOffset.UtcNow,
                participants);
            _recordings[recordingId] = session;
            _recordingBySession[sessionId] = recordingId;
            return Snapshot(session);
        }
    }

    public ConsentChange Respond(
        Guid recordingId,
        Guid userId,
        bool accepted)
    {
        lock (_sync)
        {
            if (!_recordings.TryGetValue(recordingId, out var session) ||
                !session.RequiredConsentUserIds.Contains(userId))
            {
                throw new InvalidOperationException(
                    "This recording consent request is no longer active.");
            }

            if (!accepted)
            {
                if (session.Status == "recording")
                {
                    return new ConsentChange(
                        Snapshot(session),
                        false,
                        false,
                        true);
                }
                Remove(session);
                return new ConsentChange(
                    Snapshot(session),
                    false,
                    true,
                    false);
            }

            session.AcceptedUserIds.Add(userId);
            var started =
                session.AcceptedUserIds.SetEquals(session.RequiredConsentUserIds);
            if (started)
            {
                session.Status = "recording";
            }
            return new ConsentChange(
                Snapshot(session),
                started,
                false,
                false);
        }
    }

    public RecordingSnapshot? GetForSession(Guid sessionId)
    {
        lock (_sync)
        {
            return _recordingBySession.TryGetValue(sessionId, out var id) &&
                _recordings.TryGetValue(id, out var session)
                    ? Snapshot(session)
                    : null;
        }
    }

    public bool HasConsent(Guid sessionId, Guid userId)
    {
        lock (_sync)
        {
            return !_recordingBySession.TryGetValue(sessionId, out var id) ||
                !_recordings.TryGetValue(id, out var session) ||
                session.AcceptedUserIds.Contains(userId);
        }
    }

    public RecordingSnapshot? AddParticipant(Guid sessionId, Guid userId)
    {
        lock (_sync)
        {
            if (!_recordingBySession.TryGetValue(sessionId, out var id) ||
                !_recordings.TryGetValue(id, out var session) ||
                session.RequiredConsentUserIds.Contains(userId))
            {
                return null;
            }

            session.RequiredConsentUserIds.Add(userId);
            return Snapshot(session);
        }
    }

    public RecordingSnapshot? Stop(Guid recordingId)
    {
        lock (_sync)
        {
            if (!_recordings.TryGetValue(recordingId, out var session))
            {
                return null;
            }
            Remove(session);
            return Snapshot(session);
        }
    }

    public IReadOnlyList<RecordingSnapshot> Disconnect(Guid userId)
    {
        lock (_sync)
        {
            var stopped = _recordings.Values
                .Where(recording => recording.RecorderUserId == userId)
                .Select(Snapshot)
                .ToArray();
            foreach (var recording in stopped)
            {
                if (_recordings.TryGetValue(recording.RecordingId, out var session))
                {
                    Remove(session);
                }
            }
            return stopped;
        }
    }

    private void Remove(RecordingSession session)
    {
        _recordings.Remove(session.RecordingId);
        _recordingBySession.Remove(session.SessionId);
    }

    private static RecordingSnapshot Snapshot(RecordingSession session) =>
        new(
            session.RecordingId,
            session.ConversationId,
            session.SessionId,
            session.SessionType,
            session.RecorderUserId,
            session.RecorderDisplayName,
            session.StartedAt,
            session.Status,
            session.RequiredConsentUserIds.ToArray(),
            session.AcceptedUserIds.ToArray());

    private sealed class RecordingSession(
        Guid recordingId,
        Guid conversationId,
        Guid sessionId,
        string sessionType,
        Guid recorderUserId,
        string recorderDisplayName,
        DateTimeOffset startedAt,
        HashSet<Guid> requiredConsentUserIds)
    {
        public Guid RecordingId { get; } = recordingId;
        public Guid ConversationId { get; } = conversationId;
        public Guid SessionId { get; } = sessionId;
        public string SessionType { get; } = sessionType;
        public Guid RecorderUserId { get; } = recorderUserId;
        public string RecorderDisplayName { get; } = recorderDisplayName;
        public DateTimeOffset StartedAt { get; } = startedAt;
        public string Status { get; set; } = "requesting-consent";
        public HashSet<Guid> RequiredConsentUserIds { get; } =
            requiredConsentUserIds;
        public HashSet<Guid> AcceptedUserIds { get; } = [recorderUserId];
    }

    public sealed record RecordingSnapshot(
        Guid RecordingId,
        Guid ConversationId,
        Guid SessionId,
        string SessionType,
        Guid RecorderUserId,
        string RecorderDisplayName,
        DateTimeOffset StartedAt,
        string Status,
        IReadOnlyList<Guid> RequiredConsentUserIds,
        IReadOnlyList<Guid> AcceptedUserIds);

    public sealed record ConsentChange(
        RecordingSnapshot Recording,
        bool Started,
        bool Declined,
        bool ParticipantDeclined);
}
