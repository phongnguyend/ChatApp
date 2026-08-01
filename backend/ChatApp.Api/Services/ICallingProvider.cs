using ChatApp.Api.Models;

namespace ChatApp.Api.Services;

public sealed record CallingAccessCredential(
    string Provider,
    bool ManagedMedia,
    bool ManagedRecording,
    string? UserIdentity,
    string? Token,
    DateTimeOffset? ExpiresOn);

public interface ICallingProvider
{
    string Name { get; }
    bool ManagesMedia { get; }
    bool ManagesRecording { get; }

    Task<CallingAccessCredential> GetAccessCredentialAsync(
        ChatUser user,
        CancellationToken cancellationToken);

    Task<string> StartRecordingAsync(
        string callLocator,
        CancellationToken cancellationToken);

    Task StopRecordingAsync(
        string providerRecordingId,
        CancellationToken cancellationToken);

}
