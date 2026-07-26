using System.Collections.Concurrent;

namespace ChatApp.Api.Services;

public sealed class PresenceTracker
{
    private readonly ConcurrentDictionary<string, Session> _connections = new();

    public void Connect(
        string connectionId,
        Guid userId,
        string username,
        string displayName,
        string? avatarUrl) =>
        _connections[connectionId] =
            new Session(userId, username, displayName, avatarUrl);

    public void UpdateAvatar(Guid userId, string avatarUrl)
    {
        foreach (var connection in _connections.Where(x => x.Value.UserId == userId))
        {
            _connections.TryUpdate(
                connection.Key,
                connection.Value with { AvatarUrl = avatarUrl },
                connection.Value);
        }
    }

    public void UpdateDisplayName(Guid userId, string displayName)
    {
        foreach (var connection in _connections.Where(x => x.Value.UserId == userId))
        {
            _connections.TryUpdate(
                connection.Key,
                connection.Value with { DisplayName = displayName },
                connection.Value);
        }
    }

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

    public IReadOnlyList<OnlineUser> OnlineUsers() =>
        _connections.Values
            .GroupBy(x => x.UserId)
            .Select(group => group.First())
            .OrderBy(x => x.DisplayName, StringComparer.OrdinalIgnoreCase)
            .Select(x => new OnlineUser(
                x.UserId,
                x.Username,
                x.DisplayName,
                x.AvatarUrl))
            .ToArray();

    public IReadOnlyList<string> ConnectionIdsForUser(Guid userId) =>
        _connections
            .Where(x => x.Value.UserId == userId)
            .Select(x => x.Key)
            .ToArray();

    public sealed record Session(
        Guid UserId,
        string Username,
        string DisplayName,
        string? AvatarUrl);

    public sealed record OnlineUser(
        Guid Id,
        string Username,
        string DisplayName,
        string? AvatarUrl);
}
