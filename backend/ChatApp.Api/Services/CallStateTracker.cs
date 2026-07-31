namespace ChatApp.Api.Services;

public sealed class CallStateTracker
{
    private readonly Lock _sync = new();
    private readonly Dictionary<Guid, CallSession> _calls = [];
    private readonly Dictionary<Guid, ScreenShareSession> _screenShares = [];

    public void StartCall(
        Guid callId,
        Guid conversationId,
        Guid initiatorUserId,
        Guid peerUserId)
    {
        lock (_sync)
        {
            _calls[callId] = new CallSession(
                callId,
                conversationId,
                initiatorUserId,
                peerUserId,
                false);
        }
    }

    public void Respond(Guid callId, Guid userId, bool accepted)
    {
        lock (_sync)
        {
            if (!_calls.TryGetValue(callId, out var call) ||
                call.PeerUserId != userId)
            {
                throw new InvalidOperationException("The call is no longer active.");
            }
            if (!accepted)
            {
                _calls.Remove(callId);
                _screenShares.Remove(callId);
                return;
            }
            _calls[callId] = call with { Accepted = true };
        }
    }

    public CallSession? Get(Guid callId)
    {
        lock (_sync)
        {
            return _calls.TryGetValue(callId, out var call) && call.Accepted
                ? call
                : null;
        }
    }

    public bool HasActiveCallForUser(Guid userId)
    {
        lock (_sync)
        {
            return _calls.Values.Any(call =>
                call.InitiatorUserId == userId || call.PeerUserId == userId);
        }
    }

    public ScreenShareSession? StartScreenShare(
        Guid callId,
        Guid conversationId,
        Guid ownerUserId,
        Guid peerUserId)
    {
        lock (_sync)
        {
            _screenShares.TryGetValue(callId, out var previous);
            _screenShares[callId] = new ScreenShareSession(
                callId,
                conversationId,
                ownerUserId,
                peerUserId);
            return previous?.OwnerUserId == ownerUserId ? null : previous;
        }
    }

    public bool StopScreenShare(Guid callId, Guid ownerUserId)
    {
        lock (_sync)
        {
            if (!_screenShares.TryGetValue(callId, out var share) ||
                share.OwnerUserId != ownerUserId)
            {
                return false;
            }

            return _screenShares.Remove(callId);
        }
    }

    public void EndCall(Guid callId)
    {
        lock (_sync)
        {
            _calls.Remove(callId);
            _screenShares.Remove(callId);
        }
    }

    public IReadOnlyList<CallSession> EndCallsForUser(Guid userId)
    {
        lock (_sync)
        {
            var removed = _calls.Values
                .Where(x =>
                    x.InitiatorUserId == userId || x.PeerUserId == userId)
                .ToArray();
            foreach (var call in removed)
            {
                _calls.Remove(call.CallId);
                _screenShares.Remove(call.CallId);
            }

            return removed;
        }
    }

    public sealed record CallSession(
        Guid CallId,
        Guid ConversationId,
        Guid InitiatorUserId,
        Guid PeerUserId,
        bool Accepted);

    public sealed record ScreenShareSession(
        Guid CallId,
        Guid ConversationId,
        Guid OwnerUserId,
        Guid PeerUserId);
}
