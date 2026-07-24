using System.Collections.Concurrent;

namespace ChatApp.Api.Services;

public sealed class PresenceTracker
{
    private readonly ConcurrentDictionary<string, Session> _connections = new();

    public void Connect(string connectionId, Guid userId, string username) =>
        _connections[connectionId] = new Session(userId, username);

    public Session? Disconnect(string connectionId) =>
        _connections.TryRemove(connectionId, out var session) ? session : null;

    public Session? Get(string connectionId) =>
        _connections.TryGetValue(connectionId, out var session) ? session : null;

    public IReadOnlyList<string> OnlineUsernames() =>
        _connections.Values
            .Select(x => x.Username)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Order(StringComparer.OrdinalIgnoreCase)
            .ToArray();

    public IReadOnlyList<string> ConnectionIdsForUser(Guid userId) =>
        _connections
            .Where(x => x.Value.UserId == userId)
            .Select(x => x.Key)
            .ToArray();

    public sealed record Session(Guid UserId, string Username);
}
