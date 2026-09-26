using ChatApp.Domain.Models;

namespace ChatApp.Application.Abstractions;

public interface IRecordingRepository
{
    Task<SessionRecording?> FindByProviderIdAsync(string providerRecordingId, CancellationToken cancellationToken);
    Task SaveChangesAsync(CancellationToken cancellationToken);
    Task CompleteAsync(
        SessionRecording recording,
        IReadOnlyCollection<MessageAttachment> attachments,
        long durationMilliseconds,
        CancellationToken cancellationToken);
}
