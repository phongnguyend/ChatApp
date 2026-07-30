namespace ChatApp.Api.Services;

public sealed class CallStateTracker
{
    private readonly Lock _sync = new();
    private readonly Dictionary<Guid, ScreenShareSession> _screenShares = [];

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
            _screenShares.Remove(callId);
        }
    }

    public IReadOnlyList<ScreenShareSession> EndCallsForUser(Guid userId)
    {
        lock (_sync)
        {
            var removed = _screenShares.Values
                .Where(x => x.OwnerUserId == userId || x.PeerUserId == userId)
                .ToArray();
            foreach (var share in removed)
            {
                _screenShares.Remove(share.CallId);
            }

            return removed;
        }
    }

    public sealed record ScreenShareSession(
        Guid CallId,
        Guid ConversationId,
        Guid OwnerUserId,
        Guid PeerUserId);
}
