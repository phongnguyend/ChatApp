using System.Threading.Channels;

namespace ChatApp.Api.Services;

public sealed record CallingProviderRecordingFile(
    string ProviderRecordingId,
    IReadOnlyList<Uri> ContentLocations,
    long DurationMilliseconds);

public sealed class CallingProviderRecordingFinalizationQueue
{
    private readonly Channel<CallingProviderRecordingFile> queue =
        Channel.CreateUnbounded<CallingProviderRecordingFile>(
            new UnboundedChannelOptions
            {
                SingleReader = true,
                SingleWriter = false
            });

    public ValueTask EnqueueAsync(
        CallingProviderRecordingFile recording,
        CancellationToken cancellationToken) =>
        queue.Writer.WriteAsync(recording, cancellationToken);

    public IAsyncEnumerable<CallingProviderRecordingFile> ReadAllAsync(
        CancellationToken cancellationToken) =>
        queue.Reader.ReadAllAsync(cancellationToken);
}
